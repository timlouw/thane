import { defineComponent, signal, html, repeat } from 'thane';

// An event handler on an element in a nested repeat() row.
export const NestedRowEvent = defineComponent('hardening-nested-row-event', () => {
  const groups = signal([{ id: 1, tags: ['a', 'b'] }]);
  const picked = signal('none');
  return html`<div>
    <b class="nested-event-picked">${picked()}</b>
    <ul>
      ${repeat(
        groups(),
        (g) =>
          html`<li>
            <ol>
              ${repeat(
                g.tags,
                (t) => html`<li><button class="nested-event-inner" @click=${() => picked(t)}>${t}</button></li>`,
              )}
            </ol>
          </li>`,
        { key: 'id' },
      )}
    </ul>
  </div>`;
});
