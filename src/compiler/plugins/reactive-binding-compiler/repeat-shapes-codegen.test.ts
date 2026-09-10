import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so row templates and helper calls can be asserted directly.

const app = (body: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, label: 'A' }]);
  const show = signal(true);
  const kind = signal('on');
  const pick = (id) => { kind(String(id)); };
  return {
    template: html\`<div>${body}</div>\`,
  };
});
mount(App);
`;

describe('Every repeat() list uses the keyed row path', () => {
  test('a row template with more than one root element is a build error', async () => {
    await expect(
      buildAndReadJs(
        app(
          '<ul>${repeat(rows(), (item) => html`<li>${item.label}</li><li>${item.id}</li>`, null, (item) => item.id)}</ul>',
        ),
      ),
    ).rejects.toThrow(/THANE007.*one root element/);
  });

  test('a row that is only a whenElse() is a build error that names the directive', async () => {
    await expect(
      buildAndReadJs(
        app(
          '<ul>${repeat(rows(), (item) => html`${whenElse(item.id > 1, html`<li>big</li>`, html`<li>small</li>`)}`, null, (item) => item.id)}</ul>',
        ),
      ),
    ).rejects.toThrow(/THANE007.*whenElse\(\)/);
  });

  test('a row template without an element is a build error', async () => {
    await expect(buildAndReadJs(app('<ul>${repeat(rows(), (item) => html`${item.label}`)}</ul>'))).rejects.toThrow(
      /THANE007/,
    );
  });

  test('rows with no bindings are cloned from a static template', async () => {
    const js = await buildAndReadJs(app('<ul>${repeat(rows(), (_item) => html`<li class="dot">-</li>`)}</ul>'));
    expect(js).toMatch(/__tpl_b\d+ = _T\(`<li class="dot">-<\/li>`\)/);
    expect(js).toMatch(/createKeyedReconciler\(/);
    expect(js).not.toMatch(/_w?ri_b\d+ = /);
  });

  test('a row element bound only to a component signal is still bound', async () => {
    const js = await buildAndReadJs(
      app('<ul>${repeat(rows(), (item) => html`<li class=${kind()}>x</li>`, null, (item) => item.id)}</ul>'),
    );
    expect(js).toMatch(/\.className = /);
    expect(js).toMatch(/kind\.subscribe\(/);
    expect(js).not.toMatch(/_w?ri_b\d+ = /);
  });

  test('a list inside a whenElse() branch uses the keyed row path with delegated events', async () => {
    const js = await buildAndReadJs(
      app(
        '${whenElse(show(), html`<ul>${repeat(rows(), (item) => html`<li @click=${() => pick(item.id)}>${item.label}</li>`, html`<li>none</li>`, (item) => item.id)}</ul>`, html`<p>off</p>`)}',
      ),
    );
    expect(js).toMatch(/__tpl_b\d+ = _T\(`<li><\/li>`\)/);
    expect(js).toMatch(/createKeyedReconciler\(/);
    // the branch initializer owns the list's subscriptions and returns their teardown
    expect(js).toMatch(/const _rsubs_b\d+ = \[\]/);
    expect(js).not.toMatch(/_w?ri_b\d+ = /);
  });

  test('a list inside when() content uses the keyed row path', async () => {
    const js = await buildAndReadJs(
      app(
        '<ul ${when(show())}>${repeat(rows(), (item) => html`<li>${item.label}</li>`, null, (item) => item.id)}</ul>',
      ),
    );
    expect(js).toMatch(/__tpl_b\d+ = _T\(`<li><\/li>`\)/);
    expect(js).toMatch(/const _rsubs_b\d+ = \[\]/);
    expect(js).not.toMatch(/_w?ri_b\d+ = /);
  });

  // A component-call row (`(item) => Card({ item })`) has no markup and is not subject to the
  // single-root rule; text-binding-codegen.test.ts builds that shape through the real pipeline.
});
