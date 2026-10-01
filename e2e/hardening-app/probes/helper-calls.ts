import { defineComponent, signal, html } from 'thane';
import { expose } from '../shared/expose.js';

// Calls to the component's own functions in a template. A zero-argument function is not a signal:
// `total()` follows the signals it reads, and `label()` renders once. A helper called with arguments
// follows its body's signals too.
export const HelperCalls = defineComponent('hardening-helper-calls', () => {
  const price = signal(2);
  const qty = signal(3);
  const currency = signal('EUR');
  const label = () => 'Total';
  const total = () => price() * qty();
  const format = (n: number) => `${n} ${currency()}`;
  expose('helperCalls', { price, qty, currency });
  return {
    template: html`<p class="calls">
      <span class="calls-label">${label()}</span>
      <span class="calls-total" title=${total()}>${total()}</span>
      <span class="calls-formatted">${format(price())}</span>
    </p>`,
  };
});
