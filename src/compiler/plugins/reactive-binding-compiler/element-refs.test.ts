/**
 * Element refs: `const input = ref<HTMLInputElement>()` and `<input ${input}>`. The compiled template assigns the
 * element to the ref's `el` from the path it reaches it by, with no query; a ref in a `when()` branch is set when
 * the branch shows and cleared when it hides. Any other `${…}` alone in a tag, and a ref in a list row, are build
 * errors (THANE016). The browser tests are in e2e/tests/hardening.spec.ts ("element refs").
 */
import { describe, expect, test } from 'bun:test';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;
const NAMES = { components: new Map(), fragments: new Map() };

const compile = (template: string): string => {
  const source = `import { defineComponent, signal, html, when, repeat, ref } from 'thane';
export const App = defineComponent(() => {
  const input = ref<HTMLInputElement>();
  const show = signal(true);
  const items = signal([{ id: 1 }]);
  const go = () => {};
  return { template: html\`${template}\` };
});
`;
  const out = transformDefineComponentSource(source, `/virtual/element-refs-${fileId++}.ts`, NAMES);
  if (out === null) throw new Error('not compiled');
  return out;
};

describe('a ref in a tag is assigned its element', () => {
  test('at component level: from the path to the element, and the ref is not in the static template', () => {
    const out = compile('<p>a</p><input ${input} class="x" />');
    expect(out).toContain('const __tpl = __T(`<p>a</p><input class="x" />`);');
    expect(out).toMatch(/input\.el = _ns\[\d+\];/);
    expect(out).not.toContain('querySelector');
  });

  test('next to an event on the same element', () => {
    const out = compile('<input ${input} @input=${go} />');
    expect(out).toMatch(
      /const (_\w+) = _ns\[0\];[\s\S]*\1\.addEventListener\('input', go\);[\s\S]*input\.el = \1;|input\.el = _ns\[0\];/,
    );
    expect(out).toContain("addEventListener('input', go)");
  });

  test('in a when() branch: set when it shows, cleared when it hides', () => {
    const out = compile('<div ${when(show())}><input ${input} /></div>');
    expect(out).toMatch(/__bindIf\([^)]*\(_c\) => \{[^}]*input\.el = _\w+;[\s\S]*\(\) => \{ input\.el = null; \}/);
  });

  test('on the when() element itself', () => {
    const out = compile('<input ${when(show())} ${input} />');
    expect(out).toMatch(/__bindIf\(.*`<input \/>`, \(_c\) => \{\s*const (_b\d+) = _c;\s*input\.el = \1;/s);
  });

  test('the component keeps the lean factory: ref() owns nothing', () => {
    expect(compile('<input ${input} />')).toContain("__registerComponentLean('app'");
  });
});

describe('THANE016', () => {
  test('a value alone in a tag that is not a when() or a ref', () => {
    expect(() => compile('<input ${show} />')).toThrow(
      'THANE016: ${show} in <input> — a ${…} alone in a tag is when(condition) or an element ref the component declares (const input = ref()). For an attribute, write name=${…}.',
    );
    expect(() => compile('<input ${go()} />')).toThrow('THANE016: ${go()} in <input>');
  });

  test('a ref in a list row, or in a branch of one: each row has its own element', () => {
    const message = 'THANE016: ${input} in a list row — a ref names one element, and each row has one of its own.';
    expect(() => compile('<ul>${repeat(items(), (i) => html`<li ${input}>${i.id}</li>`)}</ul>')).toThrow(message);
    expect(() =>
      compile('<ul>${repeat(items(), (i) => html`<li>${when(show(), html`<b ${input}>x</b>`)}</li>`)}</ul>'),
    ).toThrow(message);
  });
});
