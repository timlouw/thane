import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';

type Row = { id: number; on: boolean; label: string };

// Attribute bindings inside a when() inside a repeat() row. Three rows, the second
// starts hidden; showing it must bind the second row's elements, not the first row's.
export const RowWhenAttribute = defineComponent('hardening-row-when-attribute', () => {
  const rows = signal<Row[]>([
    { id: 1, on: true, label: 'one' },
    { id: 2, on: false, label: 'two' },
    { id: 3, on: true, label: 'three' },
  ]);
  const tag = signal('t0');
  const toggle = (id: number) => rows(rows().map((r) => (r.id === id ? { ...r, on: !r.on } : r)));
  expose('rowWhenAttribute', { rows, tag, toggle });
  return {
    // prettier-ignore
    template: html`<div>
      <ul class="when-attr-a-list">
        ${repeat(
          rows(),
          (r) => html`<li class="when-attr-a-row"><b class="when-attr-a" ${when(r.on)} title=${r.label}>A</b></li>`, { key: "id" },
        )}
      </ul>
      <ul class="when-attr-b-list">
        ${repeat(
          rows(),
          (r) => html`<li class="when-attr-b-row"><div ${when(r.on)}><b class="when-attr-b" title=${r.label}>B</b></div></li>`, { key: "id" },
        )}
      </ul>
      <ul class="when-attr-c-list">
        ${repeat(
          rows(),
          (r) => html`<li class="when-attr-c-row"><div ${when(r.on)}><b class="when-attr-c" data-tag=${tag()}>C</b></div></li>`, { key: "id" },
        )}
      </ul>
      <ul class="when-attr-d-list">
        ${repeat(
          rows(),
          (r) =>
            html`<li class="when-attr-d-row">
              ${when(r.on, html`<b class="when-attr-d" title=${r.label}>D</b>`, html`<i class="when-attr-d-off">off</i>`)}
            </li>`, { key: "id" },
        )}
      </ul>
    </div>`,
  };
});
