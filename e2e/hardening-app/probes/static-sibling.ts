import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// A static sibling before a repeat() in the same container.
export const StaticSibling = defineComponent('hardening-static-sibling', () => {
  const items = signal(['a', 'b']);
  expose('staticSibling', { items });
  return html`<ul class="static-sibling">
    <li class="static-sibling-head">H</li>
    ${repeat(items(), (i) => html`<li class="static-sibling-item">${i}</li>`)}
  </ul>`;
});
