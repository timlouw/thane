import { defineComponent, signal, html, when, repeat } from 'thane';

// An event handler inside a when() branch inside a repeat() row.
export const RowWhenElseEvent = defineComponent('hardening-row-when-else-event', () => {
  const rows = signal([{ id: 1, on: true }]);
  const clicks = signal(0);
  return html`<div>
    <b class="branch-event-clicks">${clicks()}</b>
    <ul>
      ${repeat(
        rows(),
        (r) =>
          html`<li>
            ${when(
              r.on,
              html`<button class="branch-event-then" @click=${() => clicks(clicks() + 1)}>then</button>`,
              html`<i class="branch-event-else">else</i>`,
            )}
          </li>`,
        { key: 'id' },
      )}
    </ul>
  </div>`;
});
