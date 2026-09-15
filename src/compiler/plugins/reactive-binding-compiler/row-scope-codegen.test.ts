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
mount(App);
`;

describe('Nested directives inside rows read the row through row-scoped signals', () => {
  test('when() with an item condition subscribes to the row signal and re-evaluates on update', async () => {
    const js = await buildAndReadJs(app('<li><b ${when(row.on)} title=${row.name}>on</b>${row.name}</li>'));
    // The row factory creates the signal and the row update writes it
    expect(js).toMatch(/const row\$ = (?:__sig|signal)\(item\);/);
    expect(js).toMatch(/row\$\(item2?\);/);
    // The condition reads it and is subscribed to it
    expect(js).toMatch(/__bindIfExpr\(r, \[row\$\], \(\) => row\$\(\)\.on,/);
    // Bound elements inside the content are resolved inside the content, not at the root
    expect(js).toMatch(/const _q = \(id\) => _c \? _c\.id === id \? _c : _c\.querySelector\("#" \+ id\) : _gid\(id\);/);
    expect(js).toMatch(/_q\("b\d+"\)/);
    // The host attribute is a guarded expression binding on the row signal
    expect(js).toMatch(/setAttribute\("title", _pv_b\d+ = row\$\(\)\.name\)/);
    expect(js).toMatch(/row\$\.subscribe\(/);
    expect(js).not.toMatch(/\brow\.on\b|\brow\.name\b/);
  });

  test('whenElse() branches inside a row may read the item', async () => {
    const js = await buildAndReadJs(
      app('<li>${whenElse(row.on, html`<b>${row.name}</b>`, html`<i>${row.name}!</i>`)}</li>'),
    );
    expect(js).toMatch(/const row\$ = (?:__sig|signal)\(item\);/);
    expect(js).toMatch(/__bindIfExpr\(r, \[row\$\], \(\) => row\$\(\)\.on,/);
    expect(js).toMatch(/__bindIfExpr\(r, \[row\$\], \(\) => !row\$\(\)\.on,/);
    expect(js).toMatch(/\.nextSibling\.data = \(_pv_b\d+ = row\$\(\)\.name\) \?\? ""/);
  });

  test('a nested repeat over item data re-reconciles on row update and its rows read the outer item', async () => {
    const js = await buildAndReadJs(app('<li>${repeat(row.tags, (t) => html`<i>${row.name}:${t}</i>`)}</li>'));
    expect(js).toMatch(/const row\$ = (?:__sig|signal)\(item\);/);
    // Inner list driven by the row signal
    expect(js).toMatch(/_nrRc_b\d+\.reconcile\(row\$\(\)\.tags\);/);
    expect(js).toMatch(/row\$\.subscribe\(\(\) => \{\s*_nrRc_b\d+\.reconcile\(row\$\(\)\.tags\);/);
    // Inner rows write the member, not the object, and subscribe to the row signal
    expect(js).toMatch(/\.nextSibling\.data = row\$\(\)\.name/);
    expect(js).toMatch(/_nrCleanups\.push\(row\$\.subscribe\(/);
  });

  test('the index is available to nested directives through its own signal', async () => {
    const js = await buildAndReadJs(app('<li><b ${when(i > 0)}>${i}</b></li>', '(row, i)'));
    expect(js).toMatch(/const i\$ = (?:__sig|signal)\(i\);/);
    // the update takes the row's current index (esbuild renames the shadowing parameter)
    expect(js).toMatch(/update: \(item2?, i2?\) => \{/);
    expect(js).toMatch(/i\$\(i2?\);/);
    expect(js).toMatch(/__bindIfExpr\(r, \[i\$\], \(\) => i\$\(\) > 0,/);
  });

  test('rows without nested directives declare no row signal', async () => {
    const js = await buildAndReadJs(app('<li>${row.name}</li>'));
    expect(js).not.toMatch(/row\$/);
  });

  test('a component signal read with a member access inside a row writes the member', async () => {
    const js = await buildAndReadJs(app('<li>${row.name} <em title=${user().name}>${user().name}</em></li>'));
    expect(js).toMatch(/\.nextSibling\.data = user\(\)\.name/);
    expect(js).toMatch(/setAttribute\("title", user\(\)\.name\)/);
    expect(js).not.toMatch(/\.data = user\(\)[;\s]/);
  });
});
