import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so the emitted listener shape can be asserted directly.

describe('Delegated row events dispatch by cell', () => {
  test('the upward walk records the row child and each handler compares it before a containment check', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, label: 'A' }]);
  const select = (id: number) => {};
  const remove = (id: number) => {};
  const inspect = (id: number) => {};
  return {
    template: html\`
      <table><tbody>
        \${repeat(rows(), (row) => html\`
          <tr>
            <td @click=\${() => inspect(row.id)}>\${row.id}</td>
            <td><a @click=\${() => select(row.id)}>\${row.label}</a></td>
            <td><a @click=\${() => remove(row.id)}><span>x</span></a></td>
          </tr>
        \`, null, (row) => row.id)}
      </tbody></table>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // One walk up to the row, remembering the child the target came through
    // (esbuild pretty-prints development output, so match across whitespace)
    expect(js).toMatch(/let _row = e\.target,\s*_cell = null;/);
    expect(js).toMatch(/\{\s*_cell = _row;\s*_row = _row\.parentNode;\s*\}/);
    // A handler on the cell itself needs no containment check
    expect(js).toMatch(
      /if \(_cell !== null && _cell === _row\.firstElementChild\) \{\s*inspect\(item\.id\);\s*return;/,
    );
    // Handlers below a cell compare the cell first, then check containment from the cell down
    expect(js).toMatch(
      /if \(_cell !== null && _cell === _row\.firstElementChild\.nextElementSibling && _cell\.firstElementChild\?\.contains\(e\.target\)\) \{\s*select\(item\.id\);\s*return;/,
    );
    expect(js).toMatch(
      /if \(_cell !== null && _cell === _row\.firstElementChild\.nextElementSibling\.nextElementSibling && _cell\.firstElementChild\?\.contains\(e\.target\)\) \{\s*remove\(item\.id\);\s*return;/,
    );
    // No handler re-navigates from the row for its containment check
    expect(js).not.toMatch(/_row\.firstElementChild[.\w]*\?\.contains\(/);
  });
});
