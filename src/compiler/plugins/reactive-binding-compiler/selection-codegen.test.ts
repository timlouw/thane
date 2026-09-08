import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so the emitted shape can be asserted directly.

const app = (rowClass: string, trackBy: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, key: 'a', label: 'A' }]);
  const selected = signal(0);
  return {
    template: html\`
      <table><tbody>
        \${repeat(rows(), (row) => html\`<tr class=\${${rowClass}}><td>\${row.label}</td></tr>\`, null, ${trackBy})}
      </tbody></table>
    \`,
  };
});
mount(App);
`;

const count = (js: string, re: RegExp): number => (js.match(re) ?? []).length;

describe('Selection bindings are lifted to one subscription per list', () => {
  test("signal() === item.<key> ? 'on' : 'off' subscribes once and updates rows through the key map", async () => {
    const js = await buildAndReadJs(app("selected() === row.id ? 'danger' : ''", '(row) => row.id'));
    // One list-level subscription, none inside the row factory
    expect(count(js, /selected\.subscribe\(/g)).toBe(1);
    // It remembers the previous key and rewrites exactly the two affected rows via the reconciler
    expect(js).toMatch(/let _sel_b\d+_0 = selected\(\);/);
    expect(js).toMatch(/_rc_b\d+\.get\(_sel_b\d+_0\)/);
    expect(js).toMatch(/_rc_b\d+\.get\(_v\)/);
    expect(js).toMatch(/\.el\.className = ""/);
    expect(js).toMatch(/\.el\.className = "danger"/);
    // Rows still compute the value on creation (guarded: an empty class skips the write)
    expect(js).toMatch(/if \(\(_p\d+ = selected\(\) === item\.id \? "danger" : ""\) !== ""\) _m0\.className = _p\d+/);
    // The row update path no longer recomputes it
    expect(js).not.toMatch(/item2\.id \? "danger"/);
  });

  test('the swapped operand order and !== are recognised with the values exchanged', async () => {
    const js = await buildAndReadJs(app("row.id !== selected() ? '' : 'danger'", '(row) => row.id'));
    expect(count(js, /selected\.subscribe\(/g)).toBe(1);
    expect(js).toMatch(/if \(_o\) _o\.el\.className = ""/);
    expect(js).toMatch(/if \(_n\) _n\.el\.className = "danger"/);
  });

  test('a comparison against a property that is not the trackBy key keeps the per-row subscription', async () => {
    const js = await buildAndReadJs(app("selected() === row.id ? 'danger' : ''", '(row) => row.key'));
    expect(js).not.toMatch(/_rc_b\d+\.get\(/);
    // Per-row subscription inside the factory (pushed onto the row's cleanups)
    expect(js).toMatch(/_cleanups\.push\(selected\.subscribe\(/);
  });

  test('an expression that is not a two-valued selection keeps the per-row subscription', async () => {
    const js = await buildAndReadJs(app("selected() > row.id ? 'past' : 'future'", '(row) => row.id'));
    expect(js).not.toMatch(/_rc_b\d+\.get\(/);
    expect(js).toMatch(/_cleanups\.push\(selected\.subscribe\(/);
  });
});
