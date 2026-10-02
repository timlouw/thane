import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';
import { quoteEmptiedValues } from './template-utils.js';

// Development builds keep identifiers, so the emitted row factory can be asserted directly.

const app = (row: string, params = '(item)'): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, url: '/a', label: 'A' }]);
  const selected = signal(0);
  return {
    template: html\`
      <ul>
        \${repeat(rows(), ${params} => html\`${row}\`, { key: "id" })}
      </ul>
    \`,
  };
});
mount(App);
`;

/** The static row template the optimised path clones, or null when the list uses the fallback renderer. */
const rowTemplate = (js: string): string | null => js.match(/__tpl_b\d+ = __T\(`([^`]*)`\)/)?.[1] ?? null;

describe('Item attribute bindings in repeat() rows use the optimised row path', () => {
  test('an attribute on the row root (the documented `data-id` example)', async () => {
    const js = await buildAndReadJs(app('<li data-id=${item.id}><span>${item.label}</span></li>'));
    expect(rowTemplate(js)).toBe('<li data-id=""><span></span></li>');
    expect(js).toMatch(/const _e0 = _el;/);
    expect(js).toMatch(/const _e1 = _e0\.firstElementChild;/);
    expect(js).toMatch(/_e0\.setAttribute\("data-id", _p\d+\)/);
    expect(js).toMatch(/_e1\.textContent = \(_p\d+ = item\.label\) \?\? ""/);
  });

  test('an attribute as the only binding in the row', async () => {
    const js = await buildAndReadJs(app('<li data-id=${item.id}>static</li>'));
    expect(rowTemplate(js)).toBe('<li data-id="">static</li>');
    expect(js).toMatch(/_e0\.setAttribute\("data-id", _p\d+\)/);
  });

  test('an attribute on an element below the row root, sharing the element with a text binding', async () => {
    const js = await buildAndReadJs(app('<li><a href=${item.url}>${item.label}</a></li>'));
    expect(rowTemplate(js)).toBe('<li><a href=""></a></li>');
    // One navigation for the element, used by both bindings
    expect(js).toMatch(/const _e0 = _el\.firstElementChild;/);
    expect(js).not.toMatch(/const _e1 = /);
    expect(js).toMatch(/_e0\.setAttribute\("href", _p\d+\)/);
    expect(js).toMatch(/_e0\.textContent = \(_p\d+ = item\.label\) \?\? ""/);
  });

  test('several attributes across several elements, with sibling navigation', async () => {
    const js = await buildAndReadJs(
      app('<li><a href=${item.url} title=${item.label}>x</a><span data-id=${item.id}>${item.label}</span></li>'),
    );
    expect(rowTemplate(js)).toBe('<li><a href="" title="">x</a><span data-id=""></span></li>');
    expect(js).toMatch(/const _e0 = _el\.firstElementChild;/);
    expect(js).toMatch(/const _e1 = _e0\.nextElementSibling;/);
    expect(js).toMatch(/_e0\.setAttribute\("href", _p\d+\)/);
    expect(js).toMatch(/_e0\.setAttribute\("title", _p\d+\)/);
    expect(js).toMatch(/_e1\.setAttribute\("data-id", _p\d+\)/);
  });

  test('an attribute next to a delegated event handler on the same element', async () => {
    const js = await buildAndReadJs(
      app('<li><a href=${item.url} @click=${() => console.log(item.id)}>${item.label}</a></li>'),
    );
    expect(rowTemplate(js)).toBe('<li><a href=""></a></li>');
    expect(js).toMatch(/_e0\.setAttribute\("href", _p\d+\)/);
  });

  test('an index-variable attribute', async () => {
    const js = await buildAndReadJs(app('<li data-index=${idx}>${item.label}</li>', '(item, idx)'));
    expect(rowTemplate(js)).toBe('<li data-index=""></li>');
    expect(js).toMatch(/_e0\.setAttribute\("data-index", _p\d+\)/);
  });

  test('a lifted selection binding below the row root navigates to its own element', async () => {
    const js = await buildAndReadJs(app("<li><a class=${selected() === item.id ? 'on' : ''}>${item.label}</a></li>"));
    expect(rowTemplate(js)).toBe('<li><a class=""></a></li>');
    // The list-level subscription rewrites the <a>, not the row element
    expect(js).toMatch(/_o\.el\.firstElementChild\.className = ""/);
    expect(js).toMatch(/_n\.el\.firstElementChild\.className = "on"/);
    expect(js).not.toMatch(/_o\.el\.className/);
  });
});

describe('Developer ids on bound row elements', () => {
  test('are kept, and the element is still located for an attribute binding', async () => {
    const js = await buildAndReadJs(app('<li><a id="link" href=${item.url}>${item.label}</a></li>'));
    expect(rowTemplate(js)).toBe('<li><a id="link" href=""></a></li>');
    expect(js).toMatch(/_e0\.setAttribute\("href", _p\d+\)/);
  });

  test('are kept for an event handler and for a sole-content text binding', async () => {
    const withEvent = await buildAndReadJs(
      app('<li><a id="link" @click=${() => console.log(item.id)}>${item.label}</a></li>'),
    );
    expect(rowTemplate(withEvent)).toBe('<li><a id="link"></a></li>');
    const onRoot = await buildAndReadJs(app('<li id="row">${item.label}</li>'));
    expect(rowTemplate(onRoot)).toBe('<li id="row"></li>');
    expect(onRoot).toMatch(/_e0\.textContent = \(_p\d+ = item\.label\) \?\? ""/);
  });
});

describe('Row attributes that read a signal of the component', () => {
  /** A list of two constant rows in a component with the signals off, note and tone */
  const signalRows = (row: string): string => `
import { defineComponent, signal, mount, html, repeat } from 'thane';
export const App = defineComponent('test-app', () => {
  const off = signal(false);
  const note = signal('n');
  const tone = signal('calm');
  return html\`\${repeat(['a', 'b'], (label) => html\`${row}\`)}\`;
});
mount(App);
`;

  test('a boolean attribute and a property leave the row template, and are written as properties', async () => {
    const js = await buildAndReadJs(
      signalRows('<label><input type="checkbox" disabled=${off()} /><input value="${note()}" />${label}</label>'),
    );
    // A disabled= left in the template, with or without a value, would disable every row's input
    expect(rowTemplate(js)).toMatch(/^<label><input type="checkbox" \/><input \/>/);
    expect(js).toMatch(/_s\d+\.disabled = off\(\);/);
    expect(js).toMatch(/_s\d+\.value = note\(\);/);
    expect(js).not.toMatch(/setAttribute\("(disabled|value)"/);
  });

  test('an unquoted value the row template is left without is written as "", so it keeps the next attribute', async () => {
    const js = await buildAndReadJs(
      signalRows('<label><input class=${tone()} type="checkbox" title="a= b" /><a href=/about>${label}</a></label>'),
    );
    expect(rowTemplate(js)).toMatch(/^<label><input class="" type="checkbox" title="a= b" \/><a href=\/about>/);
    expect(js).toMatch(/_s\d+\.className = tone\(\);/);
  });
});

describe('quoteEmptiedValues', () => {
  test('an empty unquoted value before another attribute, the end of the tag or a self-close', () => {
    expect(quoteEmptiedValues('<input class= type="checkbox"><b title=>x</b><i id= />')).toBe(
      '<input class="" type="checkbox"><b title="">x</b><i id="" />',
    );
  });

  test("a developer's unquoted value, quoted values, text and comments are left as they are", () => {
    const html = '<a href=/about title="a= b" data-x=\'c= d\'>x = y</a><!-- a= b --><p>=</p>';
    expect(quoteEmptiedValues(html)).toBe(html);
  });
});
