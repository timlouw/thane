/**
 * JavaScript's control flow in a template compiles to the directive it means: a ternary of templates and
 * `cond && html\`…\`` to when(), a chain of ternaries to nested when()s, `items.map((item) => html\`…\`)` to an
 * index-keyed repeat(). And when()'s narrowing form, `when(user(), (u) => html\`…\`)`, reads the value again
 * wherever the branch reads its parameter. Each case is pinned against the directive it stands for: both compile
 * to the same code.
 */
import { describe, expect, test } from 'bun:test';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;
const NAMES = { components: new Map([['Card', { selector: 'x-card' }]]), fragments: new Map() };

const compile = (template: string): string => {
  const source = `import { defineComponent, html, signal, when, repeat } from 'thane';
type User = { id: number; name: string; tags: string[] };
const spinner = html\`<i class="spin"></i>\`;
export const App = defineComponent(() => {
  const open = signal(false);
  const ready = signal(true);
  const n = signal(1);
  const items = signal(['a', 'b']);
  const user = signal<User | null>(null);
  const users = signal<User[]>([]);
  const pick = (id: number) => id;
  return { template: html\`${template}\` };
});
`;
  const out = transformDefineComponentSource(source, `/virtual/control-flow-${fileId++}.ts`, NAMES);
  if (out === null) throw new Error('not compiled');
  // The file name and ids differ between two compiles of the same code
  return out.replace(/control-flow-\d+/g, '');
};

/** The two templates compile to the same code */
const same = (written: string, means: string) => expect(compile(written)).toBe(compile(means));

describe('control flow in content compiles to the directive it means', () => {
  test('a ternary of templates is when() with an else-branch', () =>
    same(
      '<div>${open() ? html`<p>on</p>` : html`<p>off</p>`}</div>',
      '<div>${when(open(), html`<p>on</p>`, html`<p>off</p>`)}</div>',
    ));

  test('a ternary with null on one side is a when() with one branch, negated when the template is the else', () => {
    same('<div>${open() ? html`<p>on</p>` : null}</div>', '<div>${when(open(), html`<p>on</p>`)}</div>');
    same("<div>${open() ? '' : html`<p>off</p>`}</div>", '<div>${when(!(open()), html`<p>off</p>`)}</div>');
  });

  test('cond && template is a when() with one branch', () =>
    same('<div>${open() && html`<p>on</p>`}</div>', '<div>${when(open(), html`<p>on</p>`)}</div>'));

  test('a chain of ternaries is one when() in the else-branch of another', () =>
    same(
      '<div>${n() > 2 ? html`<b>many</b>` : n() > 0 ? html`<i>some</i>` : html`<u>none</u>`}</div>',
      '<div>${when(n() > 2, html`<b>many</b>`, html`${when(n() > 0, html`<i>some</i>`, html`<u>none</u>`)}`)}</div>',
    ));

  test('fragments and child calls are branches', () =>
    same('<div>${ready() ? Card({ n: 1 }) : spinner}</div>', '<div>${when(ready(), Card({ n: 1 }), spinner)}</div>'));

  test('.map() of a template is an index-keyed repeat()', () => {
    same(
      '<ul>${items().map((item, i) => html`<li>${i}: ${item}</li>`)}</ul>',
      '<ul>${repeat(items(), (item, i) => html`<li>${i}: ${item}</li>`)}</ul>',
    );
    expect(compile('<ul>${items().map((item) => html`<li>${item}</li>`)}</ul>')).toContain('(_, i) => i');
  });

  test('.map() whose row is a child call mounts the component for each item', () =>
    same('<ul>${users().map((u) => Card({ n: u.id }))}</ul>', '<ul>${repeat(users(), (u) => Card({ n: u.id }))}</ul>'));

  test('control flow nests in branches and rows', () =>
    same(
      '<ul>${users().map((u) => html`<li>${u.tags.length ? html`<b>${u.name}</b>` : null}</li>`)}</ul>',
      '<ul>${repeat(users(), (u) => html`<li>${when(u.tags.length, html`<b>${u.name}</b>`)}</li>`)}</ul>',
    ));

  test('a ternary of text is a text binding, in content and in attributes', () => {
    const out = compile('<p class=${open() ? "on" : "off"}>${open() ? \'yes\' : \'no\'}</p>');
    expect(out).not.toContain('__bindIf');
    expect(out).toContain('open() ? "on" : "off"');
    expect(out).toContain("open() ? 'yes' : 'no'");
  });

  test('a ternary of a template and text is THANE404', () =>
    expect(() => compile("<div>${open() ? html`<p>on</p>` : 'off'}</div>")).toThrow(
      /THANE404: one branch of open\(\) \? html`<p>on<\/p>` : 'off' is a template and the other is not: 'off'/,
    ));

  test('.map() of text is a text binding', () =>
    expect(compile("<p>${items().map((item) => item.toUpperCase()).join(', ')}</p>")).not.toContain(
      'createKeyedReconciler',
    ));
});

describe("when()'s narrowing form", () => {
  test('the branch reads the value again where it reads the parameter', () =>
    same(
      '<div>${when(user(), (u) => html`<p title=${u.name}>${u.name} #${u.id}</p>`, html`<p>none</p>`)}</div>',
      '<div>${when(user(), html`<p title=${user().name}>${user().name} #${user().id}</p>`, html`<p>none</p>`)}</div>',
    ));

  test('a call is read as written; an expression that is not a name, call, member or element, in parentheses', () => {
    same(
      '<div>${when(users().find((x) => x.id === n()), (u) => html`<p>${u.name}</p>`)}</div>',
      '<div>${when(users().find((x) => x.id === n()), html`<p>${users().find((x) => x.id === n()).name}</p>`)}</div>',
    );
    same(
      '<div>${when(open() && user(), (u) => html`<p>${u.name}</p>`)}</div>',
      '<div>${when(open() && user(), html`<p>${(open() && user()).name}</p>`)}</div>',
    );
  });

  test("handlers, a child's props, nested templates and shorthand properties read it too", () =>
    same(
      '<div>${when(user(), (u) => html`<button @click=${() => pick(u.id)}>${Card({ n: u.id })}</button>${repeat(u.tags, (t) => html`<i>${u.name}:${t}</i>`)}`)}</div>',
      '<div>${when(user(), html`<button @click=${() => pick(user().id)}>${Card({ n: user().id })}</button>${repeat(user().tags, (t) => html`<i>${user().name}:${t}</i>`)}`)}</div>',
    ));

  test('a function inside the branch that declares the same name keeps its own', () =>
    same(
      '<div>${when(user(), (u) => html`<i>${u.tags.map((u) => u.toUpperCase()).join()}</i>`)}</div>',
      '<div>${when(user(), html`<i>${user().tags.map((u) => u.toUpperCase()).join()}</i>`)}</div>',
    ));

  test('in a row, the condition may read the row item', () =>
    same(
      '<ul>${repeat(users(), (row) => html`<li>${when(row.tags[0], (tag) => html`<b>${tag}</b>`)}</li>`)}</ul>',
      '<ul>${repeat(users(), (row) => html`<li>${when(row.tags[0], html`<b>${row.tags[0]}</b>`)}</li>`)}</ul>',
    ));

  test('a function that does not take one named parameter, or whose body is not a template, is THANE014', () => {
    expect(() => compile('<div>${when(user(), (u, v) => html`<p>${u.name}</p>`)}</div>')).toThrow(
      /THANE014: when\(\)'s then-branch is a function of the condition's value that takes one parameter, a name/,
    );
    expect(() => compile('<div>${when(user(), ({ name }) => html`<p>${name}</p>`)}</div>')).toThrow(/THANE014/);
    expect(() => compile('<div>${when(user(), (u) => { return html`<p>${u.name}</p>`; })}</div>')).toThrow(
      /THANE014: when\(\)'s then-branch is a function of the condition's value whose body is an html template/,
    );
  });
});
