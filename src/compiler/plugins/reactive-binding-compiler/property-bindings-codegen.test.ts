import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so writes and templates can be asserted directly.

const componentApp = (markup: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const on = signal(false);
  const name = signal('alice');
  const maybe = signal(null);
  return {
    template: html\`<div>${markup}</div>\`,
  };
});
mount(App);
`;

const rowApp = (row: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, label: 'A', on: false, note: null }]);
  return {
    template: html\`<ul>\${repeat(rows(), (item) => html\`${row}\`, null, (item) => item.id)}</ul>\`,
  };
});
mount(App);
`;

const componentTemplate = (js: string): string => js.match(/__tpl = _T\(`([^`]*)`\)/)?.[1] ?? '';
const rowTemplate = (js: string): string => js.match(/__tpl_b\d+ = _T\(`([^`]*)`\)/)?.[1] ?? '';

describe('Form attributes are written as DOM properties and left out of the static template', () => {
  test('checked, disabled, value and readonly at component level', async () => {
    const js = await buildAndReadJs(
      componentApp(
        '<input type="checkbox" checked=${on()} /><button disabled=${on()}>b</button><input value=${name()} /><textarea readonly=${on()}></textarea>',
      ),
    );
    expect(js).toMatch(/\.checked = on\(\)/);
    expect(js).toMatch(/\.disabled = on\(\)/);
    expect(js).toMatch(/\.value = name\(\)/);
    expect(js).toMatch(/\.readOnly = on\(\)/);
    expect(js).not.toMatch(/setAttribute\("(checked|disabled|value|readonly)"/);
    const tpl = componentTemplate(js);
    expect(tpl).not.toMatch(/checked=|disabled=|value=|readonly=/);
    expect(tpl).toMatch(/<input id="b\d+" type="checkbox" \/>/);
  });

  test('inside rows the first write is not skipped and the row template carries no attribute', async () => {
    const js = await buildAndReadJs(
      rowApp(
        '<li><input type="checkbox" checked=${item.on} /><button disabled=${!item.on}>${item.label}</button></li>',
      ),
    );
    expect(js).toMatch(/_e\d+\.checked = _p\d+ = item\.on;/);
    expect(js).toMatch(/_e\d+\.disabled = _p\d+ = !item\.on;/);
    expect(js).not.toMatch(/!== ""\) _e\d+\.(checked|disabled)/);
    expect(rowTemplate(js)).toBe('<li><input type="checkbox" /><button></button></li>');
  });

  test('class keeps className and its empty-static optimisation; svg keeps setAttribute', async () => {
    const js = await buildAndReadJs(componentApp('<p class=${name()}>x</p><svg><a disabled=${on()}></a></svg>'));
    expect(js).toMatch(/\.className = name\(\)/);
    expect(js).toMatch(/setAttribute\("disabled", on\(\)\)/);
    expect(componentTemplate(js)).toMatch(/<p id="b\d+" class="alice">x<\/p>/);
  });
});

describe('null and undefined render as empty text', () => {
  test('component text bindings coalesce the value', async () => {
    const js = await buildAndReadJs(componentApp('<p>${maybe()}</p><p>[${maybe()}]</p>'));
    expect(js).toMatch(/\.nextSibling\.data = maybe\(\) \?\? ""/);
  });

  test('row text bindings coalesce on fill and on update', async () => {
    const js = await buildAndReadJs(rowApp('<li><b>${item.note}</b>${item.label}</li>'));
    expect(js).toMatch(/textContent = \(_p\d+ = item\.note\) \?\? ""/);
    expect(js).toMatch(/nodeValue = _m\.p\d+ \?\? ""/);
    expect(js).toMatch(/\.data = \(_m\.p\d+\) \?\? ""|\.data = \(_p\d+ = item\.label\) \?\? ""/);
  });
});
