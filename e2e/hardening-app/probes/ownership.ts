import { defineComponent, signal, computed, effect, onCleanup, html, when } from 'thane';
import { countCall, expose } from '../shared/expose.js';

/** A store's signal, which outlives every page that reads it */
const products = signal([1, 2, 3]);

// A page that derives from the store, as the store example's cart does: its computed, its effect (with the
// effect's cleanup) and the listener onMount adds are its own, and go when it is destroyed.
const CartPage = defineComponent('hardening-cart-page', () => {
  const count = computed(() => products().length);
  effect(() => {
    countCall('ownership', `effect ${count()}`);
    return () => countCall('ownership', 'effect cleanup');
  });
  const onResize = () => countCall('ownership', 'resize');
  return {
    template: html`<p class="own-count">${count()}</p>`,
    onMount: () => {
      window.addEventListener('resize', onResize);
      onCleanup(() => window.removeEventListener('resize', onResize));
    },
  };
});

export const Ownership = defineComponent('hardening-ownership', () => {
  const open = signal(true);
  const subscribers = () => (products as unknown as { _s: unknown[] })._s.filter((s) => s !== null).length;
  expose('ownership', { open, products, subscribers });
  return { template: html`<div>${when(open(), html`${CartPage()}`)}</div>` };
});
