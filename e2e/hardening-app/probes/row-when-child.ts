import { defineComponent, signal, html, when, repeat } from 'thane';
import { ProbeCard } from '../shared/probe-card.js';

// A child component inside a when() inside a repeat() row.
export const RowWhenChild = defineComponent('hardening-row-when-child', () => {
  const rows = signal([{ id: 1 }]);
  const show = signal(true);
  // prettier-ignore
  return html`<ul>
      ${repeat(
        rows(),
        (r) => html`<li class="when-child-row" data-row=${r.id}><div ${when(show())}>${ProbeCard({ label: 'row-card' })}</div></li>`, { key: "id" },
      )}
    </ul>`;
});
