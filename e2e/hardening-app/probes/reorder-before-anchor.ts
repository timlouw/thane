import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// A keyed list reordered while a row goes (the reconciler's general path), then appended to.
// A row moved after the last one went after the list's anchor, so the next row was added before it.
export const ReorderBeforeAnchor = defineComponent('hardening-reorder-before-anchor', () => {
  const items = signal([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
  expose('reorderBeforeAnchor', { items });
  return {
    template: html`<ul class="reorder">
      ${repeat(
        items(),
        (item) => html`<li class="reorder-item">${item.id}</li>`,
        null,
        (item) => item.id,
      )}
      <li class="reorder-tail">T</li>
    </ul>`,
  };
});
