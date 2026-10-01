import { defineComponent, signal, html, whenElse } from 'thane';
import { expose } from '../shared/expose.js';

// A text-only whenElse() branch that starts hidden. Showing it put the text "null" in place of
// its placeholder, and the binding went inert.
export const HiddenTextBranch = defineComponent('hardening-hidden-text-branch', () => {
  const on = signal(false);
  const n = signal(1);
  expose('hiddenTextBranch', { on, n });
  return {
    // prettier-ignore
    template: html`<section class="hidden-text">${whenElse(on(), html`text-${n()}`, html`<u class="hidden-text-else">else</u>`)}</section>`,
  };
});
