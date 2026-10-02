/**
 * The compiled binding function declares variables of its own and closes over the setup's scope. Every one
 * of them starts with `_`, so any other name (`r`, `ctx`, `items`, `i`, `v`, `b0`, `e`, `item`) is the
 * developer's, and a template that reads one of the compiler's names (`_subs`) is a build error (THANE012)
 * instead of reading the compiler's value.
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

const DEV = { config: { strictTypeCheck: false } };

const app = (setup: string, template: string): string => `
import { defineComponent, signal, mount } from 'thane';
export const App = defineComponent('names-app', (ctx) => {
${setup}
  return { template: html\`${template}\` };
});
mount({ component: App, target: document.getElementById('app')! });
`;

const build = (setup: string, template: string): Promise<string> => buildAndReadJs(app(setup, template), DEV);

describe('names in templates and the compiled bindings', () => {
  test('setup variables named r, ctx, items, i and v are read as the setup declares them', async () => {
    const js = await build(
      "  const r = signal('R'); const items = signal([{ id: 1 }]); const i = signal(2); const v = signal('V');",
      '<p>${r()}</p><p>${ctx.props.x ?? i()}</p><p>${v()}</p><ul>${repeat(items(), (it) => html`<li>${it.id}</li>`)}</ul>',
    );
    // The component root is the compiler's `_r`, the binding function's context `_ctx`
    expect(js).toMatch(/__b: \(_ctx, _ns\) =>/);
    expect(js).toMatch(/\.data = r\(\) \?\? ""/);
    expect(js).toMatch(/_pv_b\d+_0 = ctx\.props\.x \?\? i\(\)/);
    expect(js).not.toMatch(/\bconst r = \w*ctx\.root/);
  });

  test("a row whose item is named e keeps the name for the developer's handlers", async () => {
    const js = await build(
      '  const rows = signal([{ id: 1 }]); const pick = (id: number) => id;',
      '<ul>${repeat(rows(), (e) => html`<li @click=${() => pick(e.id)}>${e.id}</li>`, null, (e) => e.id)}</ul>',
    );
    expect(js).toContain('pick(');
  });

  test('a setup variable named like a bound element, b0, is read as the setup declares it', async () => {
    const js = await build('  const b0 = signal(1);', '<p title=${b0()}>${b0()}</p>');
    expect(js).toMatch(/\.data = b0\(\) \?\? ""/);
    expect(js).toMatch(/_b\d+\.setAttribute\("title", b0\(\)\)/);
  });

  test("setup variables named e and item, read in row handlers, are the setup's", async () => {
    const js = await build(
      '  const rows = signal([{ id: 1 }]); const e = signal(0); const item = signal(5); const pick = (id: number) => id;',
      '<ul>${repeat(rows(), (row) => html`<li @click=${() => pick(e() + item() + row.id)}>${row.id}</li>`, null, (row) => row.id)}</ul>',
    );
    expect(js).toMatch(/pick\(e\(\) \+ item\(\) \+ row\.id\)/);
    expect(js).toMatch(/addEventListener\("click", \(_e\) =>/);
  });

  for (const [what, setup, template, name] of [
    ['a setup variable named _subs', '  const _subs = signal(1);', '<p>${_subs()}</p>', '_subs'],
    ['a setup variable named like a bound element, _b0', '  const _b0 = signal(1);', '<p title=${_b0()}>x</p>', '_b0'],
  ] as const) {
    test(`${what} is a build error`, () =>
      expect(build(setup, template)).rejects.toThrow(
        new RegExp(`THANE012: this component's template reads "${name}"`),
      ));
  }
});
