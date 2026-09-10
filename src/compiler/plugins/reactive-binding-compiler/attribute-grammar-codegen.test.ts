import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so writes and templates can be asserted directly.

const componentApp = (markup: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const kind = signal('primary');
  const size = signal('lg');
  const css = signal('color: red');
  const url = signal('/a.png');
  return {
    template: html\`<div>${markup}</div>\`,
  };
});
mount(App);
`;

const rowApp = (row: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, kind: 'a', color: 'red', label: 'A' }]);
  return {
    template: html\`<ul>\${repeat(rows(), (item) => html\`${row}\`, null, (item) => item.id)}</ul>\`,
  };
});
mount(App);
`;

const componentTemplate = (js: string): string => js.match(/__tpl = _T\(`([^`]*)`\)/)?.[1] ?? '';
const rowTemplate = (js: string): string => js.match(/__tpl_b\d+ = _T\(`([^`]*)`\)/)?.[1] ?? '';

describe('One attribute grammar', () => {
  test('static text around an expression is kept, at component level', async () => {
    const js = await buildAndReadJs(componentApp('<p class="btn ${kind()} ${size()}">x</p>'));
    expect(js).toMatch(/\(_pv_b\d+_0 = `btn \$\{kind\(\)\} \$\{size\(\)\}`\)\) b\d+\.className = _pv_b\d+_0/);
    // both signals drive the one binding
    expect(js).toMatch(/kind\.subscribe\(/);
    expect(js).toMatch(/size\.subscribe\(/);
    expect(componentTemplate(js)).toMatch(/<p id="b\d+" class="">x<\/p>/);
  });

  test('style=${expr} writes cssText; style="prop: ${expr}" binds the property', async () => {
    const js = await buildAndReadJs(componentApp('<p style=${css()}>x</p><i style="color: ${kind()}">y</i>'));
    expect(js).toMatch(/\.style\.cssText = css\(\)/);
    expect(js).toMatch(/\.style\.color = kind\(\)/);
  });

  test('inside rows a mixed class and a style with static text are one binding each', async () => {
    const js = await buildAndReadJs(
      rowApp('<li class="row ${item.kind}" style="color: ${item.color}"><b style=${item.color}>${item.label}</b></li>'),
    );
    expect(js).toMatch(/\.className = _p\d+ = `row \$\{item\.kind\}`/);
    expect(js).toMatch(/\.style\.cssText = _p\d+ = `color: \$\{item\.color\}`/);
    expect(js).toMatch(/\.style\.cssText = _p\d+ = item\.color/);
    expect(rowTemplate(js)).toBe('<li class=""><b></b></li>');
  });

  test('a ":"-prefixed attribute is rejected at build time', async () => {
    await expect(buildAndReadJs(componentApp('<img :src=${url()} />'))).rejects.toThrow(/THANE006/);
  });
});
