import { defineComponent, signal, html, repeat } from 'thane';
import { Kid } from '../shared/kid.js';

// A child component in a row whose props use the row index under a custom name.
export const IndexChildProps = defineComponent('hardening-index-child-props', () => {
  const items = signal(['x', 'y']);
  return html`<ul>
    ${repeat(items(), (it, i) => html`<li class="index-props-row">${Kid({ label: it + i })}</li>`)}
  </ul>`;
});
