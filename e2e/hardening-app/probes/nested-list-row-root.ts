import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// A nested repeat() whose container is the outer row's root element; the inner list is
// driven by a component signal and goes from empty to non-empty for one row.
export const NestedListRowRoot = defineComponent('hardening-nested-list-row-root', () => {
  const outer = signal([{ id: 'A' }, { id: 'B' }]);
  const inner = signal<string[]>([]);
  expose('nestedListRowRoot', { inner });
  return {
    template: html`<div class="row-root-list">
      ${repeat(
        outer(),
        (o) =>
          html`<ul class="row-root-list-row" data-id=${o.id}>
            ${repeat(
              inner().filter((x) => x.startsWith(o.id)),
              (x) => html`<li class="row-root-list-inner">${x}</li>`,
            )}
          </ul>`,
        null,
        (o) => o.id,
      )}
    </div>`,
  };
});
