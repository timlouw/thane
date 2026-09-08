import { expect, test, describe } from 'bun:test';
import { buildAndReadJs as buildProjectAndReadJs, PROD_BUILD } from '../../testing/build-project.js';

/** Production build of a fixture, returning the emitted JavaScript. */
const buildAndReadJs = (source: string): Promise<string> => buildProjectAndReadJs(source, { config: PROD_BUILD });

// ============================================================================
// Tests — dynamic `class` written through `className` instead of setAttribute
// ============================================================================

describe('Attribute bindings written through DOM properties', () => {
  test('class bindings on HTML elements use className in rows and at component level', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  const selected = signal(0);
  const tone = signal('calm');
  return {
    template: html\`
      <div class=\${tone()}>
        <table><tbody>
          \${repeat(items(), (item) => html\`<tr class=\${selected() === item.id ? 'danger' : ''}><td>\${item.label}</td></tr>\`, null, (item) => item.id)}
        </tbody></table>
      </div>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    // Component-level signal binding: el.className = tone()
    expect(js).toMatch(/\.className\s*=\s*\w+\(\)/);
    // Row binding: the guarded write `… && (el.className = _p)` (the guard variable holds the
    // evaluated `selected() === item.id ? 'danger' : ''`)
    expect(js).toMatch(/\.className\s*=\s*\w+\)/);
    expect(js).not.toMatch(/setAttribute\("class"/);
  });

  test('class bindings inside <svg> keep setAttribute because SVG className is read-only', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const tone = signal('calm');
  return {
    template: html\`
      <svg viewBox="0 0 10 10"><g class=\${tone()}><rect width="1" height="1"></rect></g></svg>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    expect(js).toMatch(/setAttribute\("class"/);
    // (the runtime's mount teardown also assigns className, so match the binding shape only)
    expect(js).not.toMatch(/\.className\s*=\s*\w+\(\)/);
  });

  test('attributes other than class keep setAttribute', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const url = signal('/a');
  return {
    template: html\`
      <a href=\${url()}>link</a>
    \`,
  };
});
mount(App);
`;
    const js = await buildAndReadJs(source);
    expect(js).toMatch(/setAttribute\("href"/);
    expect(js).not.toMatch(/\.href\s*=/);
  });
});
