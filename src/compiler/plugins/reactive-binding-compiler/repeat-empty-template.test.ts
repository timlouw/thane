/**
 * repeat()'s third argument is its options, `{ key, empty }`, written in the call. Every form the compiler
 * takes builds, pinned by what it emits: no options, a key as a property name or a function, an empty template
 * as an html template or a plain template literal. Anything else in the third argument, an option repeat() does
 * not have, and a fourth argument are build errors (THANE010).
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

const DEV = { config: { strictTypeCheck: false } };
const ROW = '(it) => html`<li>${it.label}</li>`';

/** A component whose template is `<ul>${list}</ul>`, over items `{ id, label, kids }`. */
const app = (list: string): string => `
import { defineComponent, signal, mount } from 'thane';
export const H54App = defineComponent('h54-empty-template-app', () => {
  const items = signal([{ id: 1, label: 'A', kids: [{ id: 2, n: 'k' }] }]);
  return { template: html\`<ul>\${${list}}</ul>\` };
});
mount(H54App, { target: document.getElementById('app')! });
`;

const build = (list: string): Promise<string> => buildAndReadJs(app(list), DEV);

/** The markup of the list's empty template, or undefined when it has none. */
const emptyTemplateOf = (js: string): string | undefined => /_empty_b\d+ \?\?= __T\(`([^`]*)`\)/.exec(js)?.[1];

/** How the list keys its rows: by index, or by the property a key function reads. */
const keyOf = (js: string): string | undefined =>
  /\n\s*\(_, i\) => i,?\n/.test(js) ? 'index' : /\n\s*"(\w+)",?\n/.exec(js.slice(js.indexOf('_ct_b0,')))?.[1];

const TIMEOUT = 60_000;

describe("repeat()'s options", () => {
  for (const [what, list, empty, key] of [
    ['no options', `repeat(items(), ${ROW})`, undefined, 'index'],
    ['empty options', `repeat(items(), ${ROW}, {})`, undefined, 'index'],
    ['a key property', `repeat(items(), ${ROW}, { key: "id" })`, undefined, 'id'],
    ['a key function', `repeat(items(), ${ROW}, { key: (it) => it.id })`, undefined, 'id'],
    ['an html template', `repeat(items(), ${ROW}, { empty: html\`<li>none</li>\` })`, '<li>none</li>', 'index'],
    [
      'an html template and a key function',
      `repeat(items(), ${ROW}, { key: "id", empty: html\`<li>none</li>\` })`,
      '<li>none</li>',
      'id',
    ],
    ['a plain template literal', `repeat(items(), ${ROW}, { empty: \`<li>none</li>\` })`, '<li>none</li>', 'index'],
  ] as const) {
    test(
      `${what} builds`,
      async () => {
        const js = await build(list);
        expect(emptyTemplateOf(js)).toBe(empty);
        expect(keyOf(js)).toBe(key);
      },
      TIMEOUT,
    );
  }

  for (const [what, list, message] of [
    [
      'a key function as the third argument',
      `repeat(items(), ${ROW}, (it) => it.id)`,
      /THANE010: the third argument, \(it\) => it\.id, is not an object of options[\s\S]*repeat\(items, row, \{ key: 'id', empty: html`<li>None<\/li>` \}\)/,
    ],
    [
      'null as the third argument',
      `repeat(items(), ${ROW}, null)`,
      /THANE010: the third argument, null, is not an object/,
    ],
    [
      'an empty template as the third argument',
      `repeat(items(), ${ROW}, html\`<li>none</li>\`)`,
      /THANE010: the third argument, html`<li>none<\/li>`, is not an object/,
    ],
    ['options in a variable', `repeat(items(), ${ROW}, opts)`, /THANE010: the third argument, opts, is not an object/],
    [
      'an option repeat() does not have',
      `repeat(items(), ${ROW}, { trackBy: (it) => it.id })`,
      /THANE010: 'trackBy' is not an option of repeat\(\): its options are key and empty/,
    ],
    ['a spread of options', `repeat(items(), ${ROW}, { ...opts })`, /THANE010: '\.\.\.opts' is not an option/],
    [
      'a function as the empty template',
      `repeat(items(), ${ROW}, { empty: (it) => it.id })`,
      /THANE010: the empty template, \(it\) => it\.id, is not a template/,
    ],
    [
      'a key that is neither a name nor a function',
      `repeat(items(), ${ROW}, { key: 1 })`,
      /THANE010: the key, 1, is neither/,
    ],
    [
      'a fourth argument',
      `repeat(items(), ${ROW}, null, (it) => it.id)`,
      /THANE010: repeat\(\) takes the items, the row and its options/,
    ],
    [
      "the old form in a row's nested repeat()",
      'repeat(items(), (it) => html`<li><ol>${repeat(it.kids, (k) => html`<li>${k.n}</li>`, (k) => k.id)}</ol></li>`)',
      /THANE010: the third argument, \(k\) => k\.id, is not an object/,
    ],
  ] as const) {
    test(`${what} is a build error`, () => expect(build(list)).rejects.toThrow(message), TIMEOUT);
  }

  test(
    'a key that is not an identifier is read as a property',
    async () => expect(await build(`repeat(items(), ${ROW}, { key: 'data-id' })`)).toContain('(_k) => _k["data-id"]'),
    TIMEOUT,
  );
});

describe('THANE011 the empty template is one static element', () => {
  // It is inserted as one element while the list is empty: only a first element ever showed, text
  // alone threw when the list emptied, and a ${…} showed as written
  for (const [what, empty, markup] of [
    ['a void element', 'html`<hr>`', '<hr>'],
    ['one element with whitespace around it', 'html`  <li class="none">none</li>  `', '<li class="none">none</li>'],
  ] as const) {
    test(
      `${what} builds`,
      async () => expect(emptyTemplateOf(await build(`repeat(items(), ${ROW}, { empty: ${empty} })`))).toBe(markup),
      TIMEOUT,
    );
  }

  for (const [what, empty, message] of [
    ['two elements', 'html`<li>no</li><li>items</li>`', /THANE011: repeat\(\)'s empty template must be one element/],
    ['text alone', 'html`No items`', /THANE011: repeat\(\)'s empty template must be one element/],
    ['text next to an element', 'html`No <b>items</b>`', /THANE011: repeat\(\)'s empty template must be one element/],
    ['a binding', 'html`<li>${items().length} items</li>`', /THANE011: repeat\(\)'s empty template is static/],
  ] as const) {
    test(
      `${what} is a build error`,
      () => expect(build(`repeat(items(), ${ROW}, { empty: ${empty} })`)).rejects.toThrow(message),
      TIMEOUT,
    );
  }
});
