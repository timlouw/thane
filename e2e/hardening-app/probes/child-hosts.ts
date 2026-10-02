import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { ProbeCard } from '../shared/probe-card.js';

// Child hosts in the template where the parser keeps an element there (a paragraph, a row that
// is only the child), and comment anchors that the host replaces where it would not (a table row,
// svg).
export const ChildHosts = defineComponent('hardening-child-hosts', () => {
  const rows = signal([
    { id: 1, g: 'g1' },
    { id: 2, g: 'g2' },
  ]);
  expose('childHosts', { rows });
  return {
    // prettier-ignore
    template: html`<div class="hosts"><p class="hosts-p">${ProbeCard({ label: 'p' })}</p><table><tbody class="hosts-tbody">${repeat(rows(), (r) => html`<tr><td>${r.g}</td>${ProbeCard({ label: `tr-${r.g}` })}</tr>`, { key: "id" })}</tbody></table><div class="hosts-list">${repeat(rows(), (r) => html`${ProbeCard({ label: `row-${r.g}` })}`, { key: "id" })}</div><svg class="hosts-svg">${ProbeCard({ label: 'svg' })}</svg></div>`,
  };
});
