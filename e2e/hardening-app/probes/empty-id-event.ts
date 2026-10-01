import { defineComponent, signal, html } from 'thane';
import { expose } from '../shared/expose.js';

// An event on an element with an empty id attribute. The id lookup ran
// querySelector('#'), which throws.
export const EmptyIdEvent = defineComponent('hardening-empty-id-event', () => {
  const clicks = signal(0);
  expose('emptyIdEvent', { clicks });
  return {
    // prettier-ignore
    template: html`<div class="empty-id"><button id="" class="empty-id-btn" @click=${() => clicks(clicks() + 1)}>${clicks()}</button></div>`,
  };
});
