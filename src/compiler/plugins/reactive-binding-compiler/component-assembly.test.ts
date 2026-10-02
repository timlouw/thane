/**
 * transformDefineComponentSource assembles the compiled file from edits positioned on one parse
 * of the source. Text that only mentions `defineComponent(` (a comment, a string,
 * template text) is left alone, and the call itself is renamed however it is written.
 */
import { describe, expect, spyOn, test } from 'bun:test';
import ts from 'typescript';
import { sourceCache } from '../../utils/index.js';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;

const compile = (source: string): string => {
  const out = transformDefineComponentSource(source, `/virtual/assembly-${fileId++}.ts`);
  if (out === null) throw new Error('not compiled');
  return out;
};

/** The one registration call, from its name to the start of the setup function. */
const registrationHead = (out: string): string =>
  /__registerComponent(?:Lean)?\([^)]*?(?=\(|function)/.exec(out)?.[0] ?? '';

describe('component assembly', () => {
  test('a doc comment mentioning defineComponent() above the call is left alone', () => {
    const out = compile(`import { defineComponent } from 'thane';
/** Built with defineComponent() like every component. */
export const Cmt = defineComponent(() => ({ template: html\`<p>a</p>\` }));
`);
    expect(out).toContain('/** Built with defineComponent() like every component. */');
    expect(out).toContain("export const Cmt = __registerComponentLean('cmt', () => ({ }), __tpl);");
  });

  test('template text and a string mentioning defineComponent( stay as written', () => {
    const out = compile(`import { defineComponent } from 'thane';
const hint = 'call defineComponent(setup) once per file';
export const Doc = defineComponent(() => ({ template: html\`<code>defineComponent(() => …)</code>\` }));
`);
    expect(out).toContain("const hint = 'call defineComponent(setup) once per file';");
    expect(out).toContain('__T(`<code>defineComponent(() => …)</code>`)');
    expect(out).toContain("export const Doc = __registerComponentLean('doc', () => ({ }), __tpl);");
  });

  test('type arguments containing parentheses are renamed with the call', () => {
    // A call signature in the props type: the textual rename stopped at its `(`, so the call
    // stayed `defineComponent<…>(…)`, which the compiled file no longer imports
    const out = compile(`import { defineComponent } from 'thane';
export const Grid = defineComponent<{ rows: { (): number[] }; pick: (n: number) => void }>(({ props }) => ({
  template: html\`<p>\${props.rows().length}</p>\`,
}));
`);
    expect(out).not.toMatch(/\bdefineComponent\s*[<(]/);
    expect(registrationHead(out)).toBe("__registerComponentLean('grid', ");
  });

  test('an explicit selector keeps its place; type arguments and comments before the ( go', () => {
    const out = compile(`import { defineComponent } from 'thane';
export const Tagged = defineComponent /* setup below */ <{ n: number }>('x-tagged', ({ props }) => ({
  template: html\`<p>\${props.n}</p>\`,
}));
`);
    expect(registrationHead(out)).toBe("__registerComponentLean('x-tagged', ");
  });

  test('the binding function is inserted before a stripped first property at the same position', () => {
    const out = compile(`import { defineComponent, signal } from 'thane';
export const Count = defineComponent(() => {
  const n = signal(1);
  return {
    template: html\`<p>\${n()}</p>\`,
    onMount: () => {},
  };
});
`);
    expect(out).toContain('  return {\n  __b: (_ctx, _ns) => {\n  const _subs = [];\n');
    expect(out).toMatch(/_subs\[i\]\(\); \};\n {2}\},\n {2}\};\n\}, __tpl\);/);
  });
});

describe("child placeholders come from the file's one parse", () => {
  const NAMES = {
    components: new Map([['Card', { selector: 'x-card' }]]),
    fragments: new Map([
      ['Spinner', { staticText: '<i class="spin"></i>' }],
      ['Badge', { staticText: null }],
    ]),
  };
  const source = [
    "import { defineComponent, html, signal, when } from 'thane';",
    'export const App = defineComponent(() => {',
    '  const open = signal(false);',
    '  const unused = html`<p>${Card({ n: 2 })}</p>`;',
    '  return {',
    '    template: html`<div>${Card({ n: 1 })}${Spinner}${Badge}${when(open(), Card({ n: 3 }), Spinner)}</div>`,',
    '  };',
    '});',
    '',
  ].join('\n');

  test('a parse given with the source is the only one: the file is not parsed again', () => {
    const parse = spyOn(sourceCache, 'parse');
    try {
      const parsed = ts.createSourceFile(
        '/virtual/one-parse.ts',
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const out = transformDefineComponentSource(source, '/virtual/one-parse.ts', NAMES, {}, parsed)!;
      expect(out).toContain('Card.__f(');
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  test('a child call and an imported fragment are mounted as a whole ${} and where a directive takes a template', () => {
    const out = transformDefineComponentSource(source, '/virtual/placeholders.ts', NAMES)!;
    // The children's hosts are in the template; the static fragment is written out; Badge is mounted
    // (the when() starts on its else-branch, pre-rendered between its anchors)
    expect(out).toContain(
      '<div><x-card></x-card><i class="spin"></i><!----><!----><!----><i class="spin"></i><!----></div>',
    );
    expect(out).toMatch(/__dc\(Card\.__f\([\w$\[\]]+, \{ n: 1 \}\)\)/);
    expect(out).toMatch(/__mf\([\w$]+, Badge\)/);
    // The when() then-branch is a template of Card's host, the else-branch Spinner's markup
    expect(out).toMatch(/__bindIfExpr\([^)]*\[open\], \(\) => open\(\), `<x-card><\/x-card>`/);
    expect(out).toContain('() => !(open()), `<i class="spin"></i>`');
    expect(out).toMatch(/__dc\(Card\.__f\([\w$]+, \{ n: 3 \}\)\)/);
  });

  test('a template the compiler does not compile is empty at run time, so a child call in it never runs', () => {
    const out = transformDefineComponentSource(source, '/virtual/unused.ts', NAMES)!;
    expect(out).toContain('const unused = ``;');
    expect(out).not.toContain('{ n: 2 }');
  });
});
