import { defineComponent, signal, html, whenElse } from 'thane';
import { expose } from '../shared/expose.js';

// whenElse() branches with more than one root node. The first section's then-branch has
// two root elements; the second section's then-branch is text only.
export const MultiRootBranch = defineComponent('hardening-multi-root-branch', () => {
  const two = signal(true);
  const text = signal(true);
  const n = signal(1);
  expose('multiRootBranch', { two, text, n });
  return {
    // prettier-ignore
    template: html`<div>
      <section class="multi-root-two">${whenElse(two(), html`<b class="multi-root-a">A</b><i class="multi-root-b">${n()}</i>`, html`<u class="multi-root-e">E</u>`)}</section>
      <section class="multi-root-text">${whenElse(text(), html`text-${n()}`, html`<u class="multi-root-text-else">else</u>`)}</section>
    </div>`,
  };
});
