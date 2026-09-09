import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so the emitted row factory can be asserted directly.

const app = (row: string, extra = ''): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, label: 'A' }]);
  const flag = signal(true);
  const pick = (id) => console.log(id);
  return {
    template: html\`
      <ul>
        \${repeat(rows(), (item) => html\`${row}\`, null, (item) => item.id)}
      </ul>
      ${extra}
    \`,
  };
});
mount(App);
`;

describe('Rows without cleanups are bound by a standalone function and created in batches', () => {
  test('a row with text, attribute and delegated event bindings', async () => {
    const js = await buildAndReadJs(
      app('<li data-id=${item.id}><button @click=${() => pick(item.id)}>${item.label}</button></li>'),
    );
    // The row binder takes an already-cloned element
    expect(js).toMatch(/const _bind_b\d+ = \(_el, item, _idx\) => \{/);
    // The single-row factory clones, binds and inserts
    expect(js).toMatch(
      /\(item, _idx, _ref\) => \{\s*const _el = _cloneNode\.call\(_tc_b\d+, true\);\s*const _m = _bind_b\d+\(_el, item, _idx\);\s*_insertBefore\.call\(_ct_b\d+, _el, _ref\);\s*return _m;\s*\}/,
    );
    // The reconciler gets the batch configuration built on the same template node
    expect(js).toMatch(/"id",\s*\{ size: 16, row: _tc_b\d+, bind: _bind_b\d+ \}/);
  });

  test('a row with a nested when() keeps the inline factory and no batching', async () => {
    const js = await buildAndReadJs(app('<li>${item.label}${when(flag(), html`<em>on</em>`)}</li>'));
    expect(js).not.toMatch(/_bind_b\d+/);
    expect(js).not.toMatch(/size: 16/);
    expect(js).toMatch(/\(item, _idx, _ref\) => \{\s*const _el = _cloneNode\.call/);
  });
});
