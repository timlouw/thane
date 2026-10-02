import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { CountingKid } from '../shared/counting-kid.js';

// A child component in a keyed row reads the row's item in its props. When the row's item is replaced by a new
// object with the same key, the child is mounted again with it (its props are read when it mounts); a row
// whose item is the same object keeps its child.
export const RowChildProps = defineComponent('hardening-row-child-props', () => {
  const rows = signal([
    { id: 1, label: 'a' },
    { id: 2, label: 'b' },
  ]);
  expose('rowChildProps', { rows });
  return {
    template: html`<div>
      <ul class="child-props-in-row">
        ${repeat(rows(), (r) => html`<li>${CountingKid({ label: r.label })}</li>`, { key: 'id' })}
      </ul>
      <div class="child-props-as-row"
        >${repeat(rows(), (r) => CountingKid({ label: 'row-' + r.label }), { key: 'id' })}</div
      >
    </div>`,
  };
});
