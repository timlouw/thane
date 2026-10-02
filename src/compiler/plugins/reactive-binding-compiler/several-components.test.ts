/**
 * Several components in one file. Each is compiled on its own: its template (`__tpl`, `__tpl1`…), its
 * binding code, its registration call, and the initial values of its own signals. The file's components,
 * exported or not, mount one another like imported ones.
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';
import { transformDefineComponentSource } from './index.js';

const DEV = { strictTypeCheck: false };

const MAIN =
  "import { mount } from 'thane';\nimport { ScoreBoard } from './board.js';\nmount({ component: ScoreBoard });\n";

/** src/board.ts: a private ScoreBadge with styles, Tally with its own selector, and ScoreBoard, which mounts both */
const BOARD = [
  "import { defineComponent, signal, html, css, repeat } from 'thane';",
  '',
  'const ScoreBadge = defineComponent<{ label: string }>(({ props }) => {',
  '  const count = signal(2);',
  '  return {',
  '    template: html`<b>${props.label}</b><s>${count()}</s>`,',
  '    styles: css`b { color: green; }`,',
  '  };',
  '});',
  '',
  "export const Tally = defineComponent('x-tally', () => {",
  '  const count = signal(3);',
  '  return { template: html`<i>${count()}</i>` };',
  '});',
  '',
  'export const ScoreBoard = defineComponent(() => {',
  '  const count = signal(1);',
  "  const items = signal([{ id: 1, label: 'a' }]);",
  '  return {',
  '    template: html`<div><p>${count()}</p>${ScoreBadge({ label: "top" })}${Tally({})}<ul>${repeat(',
  '      items(),',
  '      (item) => html`<li>${ScoreBadge({ label: item.label })}</li>`,',
  "      { key: 'id' },",
  '    )}</ul></div>`,',
  '  };',
  '});',
  '',
].join('\n');

/** The compiled board.ts of a development build, or a production bundle */
const build = (mode: 'dev' | 'prod' = 'dev'): Promise<string> =>
  buildAndReadJs(MAIN, {
    extraFiles: { 'src/board.ts': BOARD },
    config: { ...DEV, isProd: mode === 'prod' },
  }).then((js) => (mode === 'dev' ? js.slice(js.indexOf('src/board.ts'), js.indexOf('src/main.ts')) : js));

describe('several components in one file', () => {
  test('each is registered under its own selector, with its own template', async () => {
    const js = await build();
    expect(js).toMatch(/var ScoreBadge = __registerComponent\("score-badge", [\s\S]*?\n\}, __tpl\);/);
    expect(js).toMatch(/var Tally = __registerComponentLean\("x-tally", [\s\S]*?\n\}, __tpl1\);/);
    expect(js).toMatch(/var ScoreBoard = __registerComponentLean\("score-board", [\s\S]*?\n\}, __tpl2\);/);
    // Each template is declared before its component, and holds its own signal's initial value
    expect(js.indexOf('var __tpl = __T(`<b>')).toBeLessThan(js.indexOf('var ScoreBadge'));
    expect(js).toContain('var __tpl = __T(`<b><!----> <!----></b><s><!---->2<!----></s>`);');
    expect(js).toContain('var __tpl1 = __T(`<i><!---->3<!----></i>`);');
    expect(js).toContain('var __tpl2 = __T(`<div><p><!---->1<!----></p><score-badge></score-badge><x-tally></x-tally>');
  });

  test('a component mounts the ones its file declares, at the top level and in its rows', async () => {
    const js = await build();
    const board = js.slice(js.indexOf('var ScoreBoard'));
    expect(board).toMatch(/__rc\(ScoreBadge, _cm\d+, \{ label: item\.label \}\)/);
    expect(board).toContain('__dc(ScoreBadge.__f(_ns[2], { label: "top" }))');
    expect(board).toContain('__dc(Tally.__f(_ns[3], {}))');
    // Only ScoreBoard has children and a list; the others bind their own text only
    expect(js.slice(0, js.indexOf('var ScoreBoard'))).not.toMatch(/__f\(|createKeyedReconciler/);
  });

  test('the styles are switched on once for the file', async () => {
    const js = await build();
    expect(js.match(/__enableComponentStyles\(\);/g)).toHaveLength(1);
  });

  test('a production build compiles and renames every selector of the file', async () => {
    const js = await build('prod');
    expect(js).not.toMatch(/score-badge|x-tally|score-board/);
    expect(js.match(/<b><!----> <!----><\/b><s><!---->2<!----><\/s>/g)).toHaveLength(1);
  });
});

test('two components of a build with one selector are reported (THANE013)', async () => {
  const privateRow = (name: string, text: string): string =>
    "import { defineComponent } from 'thane';\n" +
    `const Row = defineComponent(() => ({ template: html\`<i>${text}</i>\` }));\n` +
    `export const ${name} = defineComponent(() => ({ template: html\`<p>\${Row({})}</p>\` }));\n`;
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await buildAndReadJs(
      "import { mount } from 'thane';\nimport { Lists } from './lists.js';\nmount({ component: Lists });\n",
      {
        extraFiles: {
          'src/lists.ts':
            "import { defineComponent } from 'thane';\nimport { First } from './first.js';\nimport { Second } from './second.js';\n" +
            'export const Lists = defineComponent(() => ({ template: html`${First({})}${Second({})}` }));\n',
          'src/first.ts': privateRow('First', 'a'),
          'src/second.ts': privateRow('Second', 'b'),
        },
        config: DEV,
      },
    );
    const reports = warn.mock.calls.map((call) => String(call[0])).filter((text) => text.includes('THANE013'));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatch(/Row has the selector 'row', and so does Row \(.*(first|second)\.ts\)/);
  } finally {
    warn.mockRestore();
  }
});

describe('several components compiled by transformDefineComponentSource', () => {
  /** A file of two components with a list each, importing the runtime by a path of its own */
  const TWO_LISTS = [
    "import { defineComponent, signal } from '../runtime/index.js';",
    'const One = defineComponent(() => {',
    '  const rows = signal([1]);',
    '  return { template: html`<ul>${repeat(rows(), (r) => html`<li>${r}</li>`)}</ul>` };',
    '});',
    'export const Two = defineComponent(() => {',
    '  const rows = signal([2]);',
    '  return { template: html`<ol>${repeat(rows(), (r) => html`<li>${r}</li>`)}</ol>` };',
    '});',
    '',
  ].join('\n');

  test("Node's cloneNode and insertBefore are declared once, before the first component", () => {
    const out = transformDefineComponentSource(TWO_LISTS, '/virtual/two-lists.ts')!;
    const declaration = 'const { cloneNode: _cloneNode, insertBefore: _insertBefore } = Node.prototype;';
    expect(out.split(declaration)).toHaveLength(2);
    expect(out.indexOf(declaration)).toBeLessThan(out.indexOf('const One'));
    // The lists' ids are the file's: the second component's list does not reuse the first's
    const rowTemplates = [...out.matchAll(/const (__tpl_\w+) = /g)].map((m) => m[1]);
    expect(rowTemplates).toHaveLength(2);
    expect(new Set(rowTemplates).size).toBe(2);
  });

  test('the file imports the helpers of all its components once', () => {
    const out = transformDefineComponentSource(TWO_LISTS, '/virtual/two-lists-imports.ts')!;
    const imports = out.split('\n').filter((line) => line.startsWith('import '));
    expect(imports).toEqual([
      "import { signal } from '../runtime/index.js'",
      "import { __registerComponentLean, createKeyedReconciler, __T, __nc, __batchRows } from '../runtime/index.js'",
    ]);
  });

  test("a component declared in another component's setup is compiled too", () => {
    const out = transformDefineComponentSource(
      [
        "import { defineComponent } from 'thane';",
        'export const Outer = defineComponent(() => {',
        '  const Inner = defineComponent(() => ({ template: html`<em>in</em>` }));',
        '  return { template: html`<p>out</p>` };',
        '});',
        '',
      ].join('\n'),
      '/virtual/nested-components.ts',
    )!;
    expect(out).toContain("__registerComponentLean('outer', () => {");
    expect(out).toContain("const Inner = __registerComponentLean('inner', () => ({ }), __tpl1);");
    expect(out).toContain('const __tpl1 = __T(`<em>in</em>`);');
  });
});
