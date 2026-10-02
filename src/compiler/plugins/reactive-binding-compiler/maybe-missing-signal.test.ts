/**
 * A signal that may be missing (`const found = items().find(…)`, a `Signal | undefined`): read as `found?.()` in a
 * binding, it is a build error (THANE018), since the binding would subscribe to it when it is not there and the
 * component would throw as it mounts. `when(found, (s) => …)` shows a branch that reads it only while there is
 * one: the condition reads no signal, and the branch subscribes to it when it shows.
 */
import { describe, expect, test } from 'bun:test';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;
const compile = (template: string, declarations = 'const found = all().find((p) => p().id === 2);'): string => {
  const out = transformDefineComponentSource(
    `import { defineComponent, html, when, signal } from 'thane';
import { shared } from './store.js';
const all = signal([signal({ id: 1, title: 't' })]);
export const Page = defineComponent(() => {
  ${declarations}
  const count = signal(0);
  return html\`${template}\`;
});
`,
    `/virtual/maybe-${fileId++}.ts`,
  );
  if (out === null) throw new Error('not compiled');
  return out;
};

describe('found?.() in a binding (THANE018)', () => {
  const MESSAGE =
    'THANE018: found?.() reads a signal that may be missing, and a binding cannot follow a signal that is not ' +
    'there. Show what reads it inside when(found, (s) => html`…${s()}…`), which binds the branch only while there is one.';

  test('in text, an attribute, a condition, and a narrowed branch', () => {
    expect(() => compile('<p>${found?.().title}</p>')).toThrow(MESSAGE);
    expect(() => compile('<p title=${found?.().title}></p>')).toThrow(MESSAGE);
    expect(() => compile('<p ${when(found?.())}>x</p>')).toThrow(MESSAGE);
    // The parameter stands for the condition, found?.(), in the branch
    expect(() => compile('${when(found?.(), (p) => html`<b>${p.title}</b>`)}')).toThrow(MESSAGE);
  });

  test("a declared signal's, or an imported one's, binds as a read", () => {
    expect(compile('<p>${count?.()} ${shared?.()}</p>')).toContain('count.subscribe(');
  });
});

test('when(found, (s) => …) subscribes to it inside the branch, which shows only while there is one', () => {
  const out = compile('${when(found, (p) => html`<b>${p().title}</b>`, html`<i>missing</i>`)}');
  expect(out).toContain('__bindIfExpr(_ws_b0, _wm_b0, [], () => found,');
  expect(out).toContain('__bindIfExpr(_wm_b0, _we_b0, [], () => !(found),');
  // The one subscription is the branch's, set up when it shows
  expect(out.match(/found\.subscribe\(/g)).toHaveLength(1);
  expect(out.indexOf('found.subscribe(')).toBeGreaterThan(out.indexOf('() => found,'));
});
