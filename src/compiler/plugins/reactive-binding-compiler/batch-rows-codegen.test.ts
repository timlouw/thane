import { expect, test, describe } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

// Development builds keep identifiers, so the emitted row factory can be asserted directly.

const app = (row: string, extra = '', setup = ''): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const rows = signal([{ id: 1, label: 'A' }]);
  const flag = signal(true);
  const pick = (id) => console.log(id);
  ${setup}
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
    expect(js).toMatch(/"id",\s*\{ size: 16, row: _tc_b\d+, bind: _bind_b\d+, update: _update_b\d+, keyed: true \}/);
    // The record goes on the element for the delegated handler, which reads its value
    expect(js).toMatch(/_el\.__r = _r;\s*return _r;/);
    expect(js).toMatch(/const item = _row\.__r\.value;/);
    expect(js).not.toMatch(/__d/);
  });

  test('lean rows keep guard state on the record and share one update function', async () => {
    const js = await buildAndReadJs(
      app('<li data-id=${item.id}><span>${item.label}</span> <em>${item.label} (${idx})</em></li>').replace(
        '(item) => html',
        '(item, idx) => html',
      ),
    );
    // No per-row update closure: the record carries the guards, the lazily resolved text node
    // and the comment-marker text nodes, and key is pre-declared so its shape is stable
    expect(js).not.toMatch(/update: \(item2?\) =>/);
    expect(js).toMatch(
      /const _r = \{ el: _el, value: item, key: item\.id, p0: _p0, p1: _p1, p2: _p2, p3: _p3, t0: void 0, c0: _c0, c1: _c1 \};\s*return _r;/,
    );
    // One update per list, re-navigating from the row element and given the current index
    expect(js).toMatch(
      /const _update_b\d+ = \(_m, item, idx\) => \{\s*const _el = _m\.el;\s*const _e0 = _el;\s*const _e1 = _e0\.firstElementChild;/,
    );
    expect(js).toMatch(/if \(_m\.p0 !== \(_m\.p0 = item\.id\)\) _e0\.setAttribute\("data-id", _m\.p0\)/);
    expect(js).toMatch(/\(_m\.t0 \?\?= _e1\.firstChild\) \? _m\.t0\.nodeValue = _m\.p1 : _e1\.textContent = _m\.p1/);
    expect(js).toMatch(/if \(_m\.p3 !== \(_m\.p3 = idx\)\) _m\.c1\.data = _m\.p3/);
    expect(js).toMatch(/bind: _bind_b\d+, update: _update_b\d+, keyed: true \}/);
  });

  test('a lifted selection binding leaves no guard field on the record', async () => {
    const js = await buildAndReadJs(
      app("<li class=${selected() === item.id ? 'on' : ''}>${item.label}</li>", '', 'const selected = signal(0);'),
    );
    expect(js).toMatch(/const _r = \{ el: _el, value: item, key: item\.id, p0: _p0, t0: void 0 \};/);
  });

  test('a row with a nested when() keeps the inline factory and no batching', async () => {
    const js = await buildAndReadJs(app('<li>${item.label}${when(flag(), html`<em>on</em>`)}</li>'));
    expect(js).not.toMatch(/_bind_b\d+/);
    expect(js).not.toMatch(/size: 16/);
    expect(js).toMatch(/\(item, _idx, _ref\) => \{\s*const _el = _cloneNode\.call/);
  });
});
