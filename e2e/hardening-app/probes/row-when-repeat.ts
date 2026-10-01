import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// A repeat() inside a when() inside a repeat() row.
export const RowWhenRepeat = defineComponent('hardening-row-when-repeat', () => {
  const rows = signal([{ id: 1, tags: ['t1', 't2'] }]);
  const show = signal(true);
  expose('rowWhenRepeat', { show });
  return {
    template: html`<ul>
      ${repeat(
        rows(),
        (r) =>
          html`<li>
            <div class="when-list-wrap" ${when(show())}>
              <ol>
                ${repeat(r.tags, (t) => html`<li class="when-list-tag">${t}</li>`)}
              </ol>
            </div>
          </li>`,
        null,
        (r) => r.id,
      )}
    </ul>`,
  };
});
