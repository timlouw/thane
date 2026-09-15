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

const componentTemplate = (js: string): string => js.match(/__tpl = _T\(`([^`]*)`\)/)?.[1] ?? '';

describe('Developer ids are kept on bound elements', () => {
  test('an attribute-bound element keeps its id and is looked up by it', async () => {
    const js = await buildAndReadJs(app('<p id="panel" title=${kind()}>x</p>'));
    expect(componentTemplate(js)).toMatch(/<p id="panel" title="[^"]*">x<\/p>/);
    expect(componentTemplate(js)).not.toMatch(/id="b\d+"/);
    expect(js).toMatch(/const _u_panel = _gid\("panel"\)/);
    expect(js).toMatch(/_u_panel\.setAttribute\("title", /);
  });

  test('an id that is not a JavaScript identifier still works', async () => {
    const js = await buildAndReadJs(app('<p id="my-box" style="color: ${kind()}">x</p>'));
    expect(componentTemplate(js)).toMatch(/<p id="my-box" style="[^"]*">x<\/p>/);
    expect(js).toMatch(/const _u_my\$2dbox = _gid\("my-box"\)/);
    expect(js).toMatch(/_u_my\$2dbox\.style\.color = /);
  });

  test('an id equal to a component variable does not shadow it', async () => {
    const js = await buildAndReadJs(app('<p id="kind" title=${kind()}>x</p>'));
    expect(js).toMatch(/const _u_kind = _gid\("kind"\)/);
    expect(js).not.toMatch(/const kind = _gid/);
    expect(js).toMatch(/kind\.subscribe\(/);
  });

  test('a form control keeps its id so a label can target it', async () => {
    const js = await buildAndReadJs(app('<label for="name">N</label><input id="name" value=${kind()} />'));
    // `value` is written as a property, so the static template ships no attribute for it
    expect(componentTemplate(js)).toMatch(/<input id="name" \/?>/);
    expect(js).toMatch(/_u_name\.value = /);
  });

  test('whenElse() branch roots keep their ids and the directive uses them', async () => {
    const js = await buildAndReadJs(
      app('${whenElse(show(), html`<div id="on-panel">${kind()}</div>`, html`<div id="off-panel">off</div>`)}'),
    );
    // `show` is statically true: the then-branch is pre-rendered with its id, the else-branch deferred
    expect(componentTemplate(js)).toMatch(/<div id="on-panel">/);
    expect(componentTemplate(js)).toMatch(/<template id="off-panel"><\/template>/);
    expect(componentTemplate(js)).not.toMatch(/id="b\d+"/);
    expect(js).toMatch(/__bindIfExpr\(r, \[show\], \(\) => show\(\), "on-panel", /);
    expect(js).toMatch(/__bindIfExpr\(r, \[show\], \(\) => !show\(\), "off-panel", /);
  });

  test('a whenElse() inside a row keeps branch-root ids', async () => {
    const js = await buildAndReadJs(
      app(
        '<ul>${repeat(rows(), (item) => html`<li>${whenElse(show(), html`<b id="row-on">${item.label}</b>`, html`<i id="row-off">off</i>`)}</li>`, null, (item) => item.id)}</ul>',
      ),
    );
    expect(js).toMatch(/"row-on"/);
    expect(js).toMatch(/"row-off"/);
    expect(js).toMatch(/_cond_(_u_)?row\$2don/);
  });
});
