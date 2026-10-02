import { defineComponent, signal, html, repeat } from 'thane';
import { Kid } from '../shared/kid.js';
import { destroyRowsTick } from '../shared/store.js';

// Component-level rows subscribe to a store signal and mount a child component;
// destroying the component must release both.
export const DestroyRows = defineComponent('hardening-destroy-rows', () => {
  const items = signal([
    { id: 1, n: 'a' },
    { id: 2, n: 'b' },
  ]);
  return {
    template: html`<ul>
      ${repeat(
        items(),
        (it) =>
          html`<li class="destroy-row"
            ><span class="destroy-m">${it.n}-${destroyRowsTick()}</span>${Kid({ label: it.n })}</li
          >`,
        { key: 'id' },
      )}
    </ul>`,
  };
});
