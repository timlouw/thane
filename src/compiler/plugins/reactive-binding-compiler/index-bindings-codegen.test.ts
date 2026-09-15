import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so the reconciler call can be asserted directly.

const app = (list: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, label: 'A' }]);
  const show = signal(true);
  return {
    template: html\`<ul>${list}</ul>\`,
  };
});
mount(App);
`;

describe('Lists whose bindings read the index ask the reconciler to refresh moved rows', () => {
  test('a lean list with an index binding passes trackIndex', async () => {
    const js = await buildAndReadJs(
      app('${repeat(rows(), (item, index) => html`<li data-i=${index}>${item.label}</li>`, null, (item) => item.id)}'),
    );
    expect(js).toMatch(/createKeyedReconciler\([\s\S]*?update: _update_b\d+ \},\s*true\s*\)/);
  });

  test('a list without an index binding does not', async () => {
    const js = await buildAndReadJs(
      app('${repeat(rows(), (item, index) => html`<li>${item.label}</li>`, null, (item) => item.id)}'),
    );
    expect(js).toMatch(/update: _update_b\d+ \}\s*\)/);
    expect(js).not.toMatch(/update: _update_b\d+ \},\s*true\s*\)/);
    expect(js).not.toMatch(/void 0,\s*true\s*\)/);
  });

  test('a closure-row list takes the index through its update function', async () => {
    const js = await buildAndReadJs(
      app(
        '${repeat(rows(), (item, index) => html`<li><i ${when(show())}>${index}</i>${item.label}-${index}</li>`, null, (item) => item.id)}',
      ),
    );
    // the update takes the row's current index (esbuild renames the shadowing parameters)
    expect(js).toMatch(/update: \(item2?, index2?\) =>/);
    // closure rows have no batch descriptor, so the flag follows an explicit `undefined` (`void 0` after esbuild)
    expect(js).toMatch(/,\s*void 0,\s*true\s*\)/);
  });
});
