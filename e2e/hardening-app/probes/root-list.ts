import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// A repeat() whose container is the component root (the rows sit directly in the host).
export const RootList = defineComponent('hardening-root-list', () => {
  const items = signal(['r1', 'r2']);
  expose('rootList', { items });
  return {
    template: html`${repeat(items(), (it) => html`<p class="root-list-row">${it}</p>`)}`,
  };
});
