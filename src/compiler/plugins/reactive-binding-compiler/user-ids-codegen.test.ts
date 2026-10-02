import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so element lookups and writes can be asserted directly.

const app = (markup: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const kind = signal('on');
  const show = signal(true);
  const rows = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`<div>${markup}</div>\`,
  };
});
mount(App);
`;

const componentTemplate = (js: string): string => js.match(/__tpl = __T\(`([^`]*)`\)/)?.[1] ?? '';

// A bound element is reached by its position in the template (`_ns[i]`, the template's
// elements in document order); its developer id stays on it and is not used to find it.
describe('Developer ids are kept on bound elements and not used to find them', () => {
  test('an attribute-bound element keeps its id and is reached by position', async () => {
    const js = await buildAndReadJs(app('<p id="panel" title=${kind()}>x</p>'));
    expect(componentTemplate(js)).toMatch(/<p id="panel" title="[^"]*">x<\/p>/);
    expect(componentTemplate(js)).not.toMatch(/id="b\d+"|data-thane-ref/);
    // <div> is element 0, <p> element 1
    expect(js).toMatch(/const (_b\d+) = _ns\[1\];\s+\1\.setAttribute\("title", /);
    expect(js).not.toMatch(/querySelector\("#|_gid|_u_panel/);
  });

  test('an id that is not a JavaScript identifier is left alone', async () => {
    const js = await buildAndReadJs(app('<p id="my-box" style="color: ${kind()}">x</p>'));
    expect(componentTemplate(js)).toMatch(/<p id="my-box" style="[^"]*">x<\/p>/);
    expect(js).toMatch(/const (_b\d+) = _ns\[1\];\s+\1\.style\.color = /);
  });

  test('an id equal to a component variable does not shadow it', async () => {
    const js = await buildAndReadJs(app('<p id="kind" title=${kind()}>x</p>'));
    expect(js).not.toMatch(/const kind = _ns/);
    expect(js).toMatch(/kind\.subscribe\(/);
  });

  test('a form control keeps its id so a label can target it', async () => {
    const js = await buildAndReadJs(app('<label for="name">N</label><input id="name" value=${kind()} />'));
    // `value` is written as a property, so the static template ships no attribute for it
    expect(componentTemplate(js)).toMatch(/<input id="name" \/?>/);
    expect(js).toMatch(/const (_b\d+) = _ns\[2\];\s+\1\.value = /);
  });

  test('an empty id attribute is left alone and does not break the lookup', async () => {
    const js = await buildAndReadJs(app('<button id="" @click=${() => kind("x")}>b</button>'));
    expect(componentTemplate(js)).toMatch(/<button id="">b<\/button>/);
    expect(js).toMatch(/_ns\[1\]\.addEventListener\("click", /);
    expect(js).not.toMatch(/querySelector\("#/);
  });

  test('when() branch roots keep their ids; the directive does not use them', async () => {
    const js = await buildAndReadJs(
      app('${when(show(), html`<div id="on-panel">${kind()}</div>`, html`<div id="off-panel">off</div>`)}'),
    );
    // `show` is statically true: the then-branch is pre-rendered between the first two anchors, and
    // the else-branch leaves nothing between the last two
    expect(componentTemplate(js)).toMatch(
      /^<div><!----><div id="on-panel"><!---->on<!----><\/div><!----><!----><\/div>$/,
    );
    expect(js).toMatch(/__bindIfExpr\(_ws_(b\d+), _wm_\1, \[show\], \(\) => show\(\), `<div id="on-panel">/);
    expect(js).toMatch(
      /__bindIfExpr\(_wm_(b\d+), _we_\1, \[show\], \(\) => !show\(\), `<div id="off-panel">off<\/div>`/,
    );
  });

  test('an id of the compiler form is a developer id like any other (THANE406 is retired)', async () => {
    const js = await buildAndReadJs(app('<p id="b0" title=${kind()}>x</p><i id="b1">${kind()}</i>'));
    expect(componentTemplate(js)).toMatch(/^<div><p id="b0" title="on">x<\/p><i id="b1"><!---->on<!----><\/i><\/div>$/);
    expect(js).toMatch(/\.setAttribute\("title", /);
  });

  test("a comment written in the form of the compiler's markers is reported, not taken for one", async () => {
    // Ids count from 0 in every file, so the first text binding's marker is <!--b0--> too
    await expect(buildAndReadJs(app('<!--b0--><p>${kind()}</p>'))).rejects.toThrow(
      /THANE009: a comment in this template/,
    );
  });

  test('a when() inside a row keeps branch-root ids in its branch templates', async () => {
    const js = await buildAndReadJs(
      app(
        '<ul>${repeat(rows(), (item) => html`<li>${when(show(), html`<b id="row-on">${item.label}</b>`, html`<i id="row-off">off</i>`)}</li>`, { key: "id" })}</ul>',
      ),
    );
    expect(js).toMatch(/`<b id="row-on">/);
    expect(js).toMatch(/`<i id="row-off">off<\/i>`/);
    expect(js).not.toMatch(/_u_row|querySelector\("#row/);
  });
});
