import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { ProbeCard } from '../shared/probe-card.js';

// In a row, a when() whose initial value is unknown at compile time, followed by a
// child component. The child mounted in place of the when() anchor. The second list has a nested
// list before the child, whose anchor the child's could be mistaken for the same way.
export const RowChildAfterWhen = defineComponent('hardening-row-child-after-when', () => {
  const rows = signal([
    { id: 1, g: 'g1', tags: ['t1', 't2'] },
    { id: 2, g: 'g2', tags: ['t3'] },
  ]);
  const on = signal(Math.random() > 2);
  const lbl = signal('L');
  expose('rowChildAfterWhen', { rows, on, lbl });
  return {
    // prettier-ignore
    template: html`<div><ul class="after-when">${repeat(rows(), (r) => html`<li class="after-when-row"><b class="after-when-b" ${when(on())}>${lbl()}</b>${ProbeCard({ label: r.g })}</li>`, null, (r) => r.id)}</ul><ul class="after-list">${repeat(rows(), (r) => html`<li class="after-list-row">${repeat(r.tags, (t) => html`<i>${t}</i>`)}${ProbeCard({ label: r.g })}</li>`, null, (r) => r.id)}</ul></div>`,
  };
});
