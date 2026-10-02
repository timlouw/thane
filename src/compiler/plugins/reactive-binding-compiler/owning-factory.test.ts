/**
 * A component whose setup may create what it owns (a computed, an effect, an onCleanup function) is registered
 * with the full factory, which disposes them when the component is destroyed. One whose setup only declares
 * signals and functions keeps the lean factory, so an app of such components bundles no ownership code.
 */
import { describe, expect, test } from 'bun:test';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;

/** The registration function a component with this setup body is compiled to */
const factoryOf = (body: string, imports = 'signal, computed, effect, onCleanup, html'): string => {
  const source = `import { defineComponent, ${imports} } from 'thane';
import { useCart } from './cart.js';
export const App = defineComponent(() => {
${body}
});
`;
  const out = transformDefineComponentSource(source, `/virtual/owning-${fileId++}.ts`);
  if (out === null) throw new Error('not compiled');
  return /export const App = (__registerComponent(?:Lean)?)\(/.exec(out)![1]!;
};

const TEMPLATE = 'return { template: html`<p>${count()}</p>` };';

describe('the full factory, which owns what the setup creates', () => {
  test('a computed, an effect or an onCleanup in the setup', () => {
    expect(factoryOf(`const count = signal(1); const twice = computed(() => count() * 2); ${TEMPLATE}`)).toBe(
      '__registerComponent',
    );
    expect(factoryOf(`const count = signal(1); effect(() => document.title = String(count())); ${TEMPLATE}`)).toBe(
      '__registerComponent',
    );
    expect(factoryOf(`const count = signal(1); onCleanup(() => {}); ${TEMPLATE}`)).toBe('__registerComponent');
  });

  test('a helper called while the setup runs, which may create them', () => {
    expect(factoryOf(`const cart = useCart(); const count = signal(cart.size); ${TEMPLATE}`)).toBe(
      '__registerComponent',
    );
    expect(factoryOf(`const count = signal(new Date().getDay()); ${TEMPLATE}`)).toBe('__registerComponent');
  });

  test('a component with onMount, which owns what onMount creates too', () => {
    expect(
      factoryOf(
        `const count = signal(1); return { template: html\`<p>\${count()}</p>\`, onMount: () => onCleanup(() => {}) };`,
      ),
    ).toBe('__registerComponent');
    expect(
      factoryOf(
        `const count = signal(1); const start = () => {}; return { template: html\`<p>\${count()}</p>\`, onMount: start };`,
      ),
    ).toBe('__registerComponent');
  });
});

describe('the lean factory', () => {
  test('a setup of signals and functions, whose template reads them', () => {
    expect(factoryOf(`const count = signal(0); const inc = () => count(count() + 1); ${TEMPLATE}`)).toBe(
      '__registerComponentLean',
    );
  });

  test('a call inside a function the setup returns runs later, outside the setup', () => {
    expect(factoryOf(`const count = signal(0); const reset = () => count(useCart().size); ${TEMPLATE}`)).toBe(
      '__registerComponentLean',
    );
  });

  test("calls in the template's expressions are compiled into its bindings, and declaring a component creates nothing", () => {
    expect(
      factoryOf(
        'const count = signal(0); const Inner = defineComponent(() => ({ template: html`<b>in</b>` })); return { template: html`<p>${count() + Math.round(1.5)}</p>` };',
      ),
    ).toBe('__registerComponentLean');
  });
});
