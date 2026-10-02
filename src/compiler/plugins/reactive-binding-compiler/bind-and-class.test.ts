/**
 * Two-way bindings and class toggles. `bind:value=${name}` is the `value` property's binding and an `input`
 * listener that writes the signal (`change` on a `<select>`); `bind:checked=${on}` is the `checked` property's and
 * a `change` listener. `class:name=${condition}` toggles one class. Neither is an attribute of the static template.
 * Any other `bind:`, and a `class:` without a condition, are build errors (THANE017). The browser tests are in
 * e2e/tests/hardening.spec.ts ("bind: and class:").
 */
import { describe, expect, test } from 'bun:test';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;

const compile = (template: string): string => {
  const source = `import { defineComponent, signal, html, repeat } from 'thane';
export const App = defineComponent(() => {
  const name = signal('a');
  const agree = signal(false);
  const items = signal([{ id: 1, on: true, label: signal('x') }]);
  return { template: html\`${template}\` };
});
`;
  const out = transformDefineComponentSource(source, `/virtual/bind-${fileId++}.ts`, {
    components: new Map(),
    fragments: new Map(),
  });
  if (out === null) throw new Error('not compiled');
  return out;
};

describe('bind:value and bind:checked', () => {
  test("an input's value: the property follows the signal, and input events write it", () => {
    const out = compile('<input bind:value=${name} />');
    expect(out).toContain('const __tpl = __T(`<input />`);');
    expect(out).toContain('_b0.value = name();');
    expect(out).toContain("addEventListener('input', (_e) => name(_e.target.value));");
  });

  test("a checkbox's checked, and a select's value, are written on change; a quoted value is the same", () => {
    const out = compile(
      '<input type="checkbox" bind:checked="${agree}" /><select bind:value=${name}><option>a</option></select>',
    );
    expect(out).toContain("addEventListener('change', (_e) => agree(_e.target.checked));");
    expect(out).toContain("addEventListener('change', (_e) => name(_e.target.value));");
    expect(out).toContain('`<input type="checkbox" /><select><option>a</option></select>`');
  });

  test('a textarea, and a signal of a row (the Signal<Signal<T>[]> pattern)', () => {
    expect(compile('<textarea bind:value=${name}></textarea>')).toContain(
      "addEventListener('input', (_e) => name(_e.target.value));",
    );
    const row = compile('<ul>${repeat(items(), (it) => html`<li><input bind:value=${it.label} /></li>`)}</ul>');
    expect(row).toMatch(/it\.label\(_e\.target\.value\)/);
  });

  test('any other bind: is THANE017', () => {
    expect(() => compile('<input bind:text=${name} />')).toThrow(
      'THANE017: bind:text on <input> — the two-way bindings are bind:value=${signal} and bind:checked=${signal}.',
    );
  });
});

describe('class:name', () => {
  test('toggles its class as the condition changes, next to the static classes', () => {
    const out = compile('<p class="field" class:invalid=${name() === ""} class:on=${agree()}>x</p>');
    expect(out).toContain('const __tpl = __T(`<p class="field">x</p>`);');
    expect(out).toContain("classList.toggle('on', !!(agree()))");
    expect(out).toMatch(/classList\.toggle\('invalid', !!\(_pv_\w+\)\)/);
  });

  test('in a row', () => {
    const out = compile(
      '<ul>${repeat(items(), (it) => html`<li class:on=${it.on}>${it.id}</li>`, { key: "id" })}</ul>',
    );
    expect(out).toContain('const __tpl_b0 = __T(`<li></li>`);');
    expect(out).toMatch(/classList\.toggle\('on', !!\(/);
  });

  test('without a condition, THANE017', () => {
    expect(() => compile('<p class:on>x</p>')).toThrow(
      'THANE017: class:on on <p> — class:name takes a condition: class:on=${condition}.',
    );
  });
});
