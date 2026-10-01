/**
 * A compiled component imports exactly the runtime helpers its code calls: every
 * helper used in transformDefineComponentSource's output is imported from 'thane/runtime',
 * and nothing else is. Checked before esbuild, which would drop an unused import and hide a
 * missing one until the code runs (a when() that showed child-component rows failed with
 * `__dc is not defined`).
 */
import { describe, expect, test } from 'bun:test';
import { RUNTIME_HELPER } from '../../../contracts/index.js';
import type { ChildMountInfo } from '../component-precompiler/component-precompiler.js';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;

const compile = (setupBody: string, childMounts?: ChildMountInfo[]) => {
  const source = `import { defineComponent, signal } from 'thane';
export const App = defineComponent(() => {
  const show = signal(false);
  const items = signal([{ id: 1, n: 'a' }]);
  const n = signal(1);
  ${setupBody}
});
`;
  const out = transformDefineComponentSource(source, `/virtual/helper-imports-${fileId++}.ts`, childMounts);
  if (out === null) throw new Error('not compiled');
  const importLine = out.split('\n').find((line) => line.includes("from 'thane/runtime'")) ?? '';
  const imported = (/\{([^}]*)\}/.exec(importLine)?.[1] ?? '').split(',').map((s) => s.trim());
  const code = out.replace(importLine, '');
  // Called, or referenced as a value (the rows' shared `__nc`)
  const called = Object.values(RUNTIME_HELPER).filter((name) => new RegExp(`\\b${name}\\b`).test(code));
  return { out, imported: [...imported].sort(), called: [...called].sort() };
};

const card = (anchorId: string): ChildMountInfo => ({
  componentName: 'Card',
  selector: 'x-card',
  propsExpression: '{ n: 1 }',
  anchorId,
});

describe('runtime helper imports follow the emitted code', () => {
  test('child-component rows inside a when() import __dc', () => {
    const r = compile(
      'return { template: html`<div ${when(show())}><ul>${repeat(items(), (i) => Card({ label: i.n }))}</ul></div>` };',
    );
    expect(r.called).toContain(RUNTIME_HELPER.DESTROY_CHILD);
    expect(r.imported).toEqual(r.called);
  });

  test('child-component rows inside a whenElse() branch import __dc', () => {
    const r = compile(
      'return { template: html`<div>${whenElse(show(), html`<ul>${repeat(items(), (i) => Card({ label: i.n }))}</ul>`, html`<p>none</p>`)}</div>` };',
    );
    expect(r.called).toContain(RUNTIME_HELPER.DESTROY_CHILD);
    expect(r.imported).toEqual(r.called);
  });

  const shapes: Array<[string, string, ChildMountInfo[]?]> = [
    ['no bindings: the registration only', 'return { template: html`<p>a</p>` };'],
    ['a when() over a bare signal read', 'return { template: html`<p ${when(show())}>a</p>` };'],
    ['a when() over an expression', 'return { template: html`<p ${when(!show())}>a</p>` };'],
    [
      'a list whose rows are created in batches',
      'return { template: html`<ul>${repeat(items(), (it) => html`<li>${it.n}</li>`)}</ul>` };',
    ],
    ['a whenElse()', 'return { template: html`<div>${whenElse(show(), html`<b>y</b>`, html`<i>n</i>`)}</div>` };'],
    [
      'a list with a row directive (row signals)',
      'return { template: html`<ul>${repeat(items(), (it) => html`<li><b ${when(it.id > n())}>${it.n}</b></li>`)}</ul>` };',
    ],
    [
      'child-component rows at the top level',
      'return { template: html`<ul>${repeat(items(), (i) => Card({ i }))}</ul>` };',
    ],
    ['a top-level child mount', 'return { template: html`<div><!--b0.--></div>` };', [card('b0')]],
    [
      'a child mount inside a when()',
      'return { template: html`<div ${when(show())}><!--b0.--></div>` };',
      [card('b0')],
    ],
    ['styles', 'return { template: html`<p>${n()}</p>`, styles: css`p { color: red; }` };'],
  ];
  for (const [label, body, mounts] of shapes) {
    test(label, () => {
      const r = compile(body, mounts);
      expect(r.imported).toEqual(r.called);
    });
  }
});
