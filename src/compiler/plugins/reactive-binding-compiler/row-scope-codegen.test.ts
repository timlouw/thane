import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so the emitted row factory can be asserted directly.
// (esbuild prints the `__sig` helper under its original name, `signal`.)

const app = (row: string, params = '(row)'): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, name: 'A', on: true, tags: ['x'] }]);
  const user = signal({ name: 'Tim' });
  const flag = signal(true);
  const pick = (id) => console.log(id);
  return {
    template: html\`
      <ul>
        \${repeat(rows(), ${params} => html\`${row}\`, null, (row) => row.id)}
      </ul>
    \`,
  };
});
mount({ component: App });
`;

describe('Nested directives inside rows read the row through row-scoped signals', () => {
  test('when() with an item condition subscribes to the row signal and re-evaluates on update', async () => {
    const js = await buildAndReadJs(app('<li><b ${when(row.on)} title=${row.name}>on</b>${row.name}</li>'));
    // The row factory creates the signal and the row update writes it
    expect(js).toMatch(/const row\$ = (?:__sig|signal)\(row\);/);
    expect(js).toMatch(/row\$\(row2?\);/);
    // The condition reads it and is subscribed to it
    expect(js).toMatch(/__bindIfExpr\(_w[se]_b\d+, _w[me]_b\d+, \[row\$\], \(\) => row\$\(\)\.on,/);
    // Bound elements inside the content are reached by path from the content's root: here the
    // bound element is the root itself. The content is bound by the branch initializer.
    expect(js).toMatch(/\(_c\) => \{\s+const _b\d+ = _c;/);
    expect(js).not.toMatch(/_q\(/);
    // The host attribute is a guarded expression binding on the row signal
    expect(js).toMatch(
      /if \(_pv_b\d+_0 !== \(_pv_b\d+_0 = row\$\(\)\.name\)\) _b\d+\.setAttribute\("title", _pv_b\d+_0\)/,
    );
    expect(js).toMatch(/row\$\.subscribe\(/);
    // The when() reads the row through its signal; only the first write of the row's own text binding
    // reads the item (its updates read the update's parameter)
    expect(js).not.toMatch(/\brow\.on\b/);
    expect(js.match(/.*\brow\.name\b.*/g)?.map((line) => line.trim())).toEqual(['_c0.data = (_p0 = row.name) ?? "";']);
  });

  test('whenElse() branches inside a row may read the item', async () => {
    const js = await buildAndReadJs(
      app('<li>${whenElse(row.on, html`<b>${row.name}</b>`, html`<i>${row.name}!</i>`)}</li>'),
    );
    expect(js).toMatch(/const row\$ = (?:__sig|signal)\(row\);/);
    expect(js).toMatch(/__bindIfExpr\(_w[se]_b\d+, _w[me]_b\d+, \[row\$\], \(\) => row\$\(\)\.on,/);
    expect(js).toMatch(/__bindIfExpr\(_wm_b\d+, _we_b\d+, \[row\$\], \(\) => !row\$\(\)\.on,/);
    expect(js).toMatch(/if \(_pv_b\d+_0 !== \(_pv_b\d+_0 = row\$\(\)\.name\)\) _b\d+\.data = _pv_b\d+_0 \?\? ""/);
  });

  test('a nested repeat over item data re-reconciles on row update and its rows read the outer item', async () => {
    const js = await buildAndReadJs(app('<li>${repeat(row.tags, (t) => html`<i>${row.name}:${t}</i>`)}</li>'));
    expect(js).toMatch(/const row\$ = (?:__sig|signal)\(row\);/);
    // Inner list driven by the row signal, generated like any list, its subscription in the row's cleanups
    expect(js).toMatch(/const _items_b\d+ = \(\) => row\$\(\)\.tags;/);
    expect(js).toMatch(/const _rsrc_b\d+_0 = row\$;\s*_cleanups\.push\(typeof _rsrc_b\d+_0\?\.subscribe/);
    // Inner rows write the member, not the object, and subscribe to the row signal
    expect(js).toMatch(/_st\d+\.data = row\$\(\)\.name/);
    expect(js).toMatch(/_cleanups2\.push\(row\$\.subscribe\(/);
  });

  test('the index is available to nested directives through its own signal', async () => {
    const js = await buildAndReadJs(app('<li><b ${when(i > 0)}>${i}</b></li>', '(row, i)'));
    expect(js).toMatch(/const i\$ = (?:__sig|signal)\(i\);/);
    // the update takes the row's current index (esbuild renames the shadowing parameter)
    expect(js).toMatch(/update: \(row2?, i2?\) => \{/);
    expect(js).toMatch(/i\$\(i2?\);/);
    expect(js).toMatch(/__bindIfExpr\(_ws_b\d+, _we_b\d+, \[i\$\], \(\) => i\$\(\) > 0,/);
  });

  test('rows without nested directives declare no row signal', async () => {
    const js = await buildAndReadJs(app('<li>${row.name}</li>'));
    expect(js).not.toMatch(/row\$/);
  });

  test('a component signal read with a member access inside a row writes the member', async () => {
    const js = await buildAndReadJs(app('<li>${row.name} <em title=${user().name}>${user().name}</em></li>'));
    expect(js).toMatch(/_st\d+\.data = user\(\)\.name/);
    expect(js).toMatch(/setAttribute\("title", user\(\)\.name\)/);
    expect(js).not.toMatch(/\.data = user\(\)[;\s]/);
  });
});
