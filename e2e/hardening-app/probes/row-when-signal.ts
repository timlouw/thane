import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';

type Row = { id: number; label: string };

// A when() inside a repeat() row whose condition reads only a component signal. The branch's
// initializer found nothing in the pre-rendered row template, so the attribute binding inside stayed
// empty until the branch had been hidden and shown once.
export const RowWhenSignal = defineComponent('hardening-row-when-signal', () => {
  const rows = signal<Row[]>([
    { id: 1, label: 'one' },
    { id: 2, label: 'two' },
    { id: 3, label: 'three' },
  ]);
  const show = signal(true);
  expose('rowWhenSignal', { rows, show });
  return {
    // prettier-ignore
    template: html`<ul>
      ${repeat(
        rows(),
        (r) => html`<li class="when-signal-row"><div ${when(show())}><b class="when-signal-b" title=${r.label}>shown</b></div></li>`, { key: "id" },
      )}
    </ul>`,
  };
});
