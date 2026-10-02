import { defineComponent, signal, html, when } from 'thane';
import { expose } from '../shared/expose.js';

// A text-only when() branch that starts hidden. Showing it put the text "null" in place of
// its placeholder, and the binding went inert.
export const HiddenTextBranch = defineComponent('hardening-hidden-text-branch', () => {
  const on = signal(false);
  const n = signal(1);
  expose('hiddenTextBranch', { on, n });
  // prettier-ignore
  return html`<section class="hidden-text">${when(on(), html`text-${n()}`, html`<u class="hidden-text-else">else</u>`)}</section>`;
});
