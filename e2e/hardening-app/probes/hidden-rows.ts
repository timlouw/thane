import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { Kid } from '../shared/kid.js';
import { hiddenRowsTick } from '../shared/store.js';

// A list whose rows subscribe to a store signal and mount a child component, inside a when().
// Hiding the when() must release the rows' subscriptions and destroy the children, and showing it
// again must not add a second set.
export const HiddenRows = defineComponent('hardening-hidden-rows', () => {
  const items = signal([
    { id: 1, n: 'a' },
    { id: 2, n: 'b' },
  ]);
  const show = signal(true);
  expose('hiddenRows', { show });
  return {
    template: html`<section>
      <div class="hidden-when" ${when(show())}>
        <ul>
          ${repeat(
            items(),
            (it) =>
              html`<li class="hidden-row"
                ><span class="hidden-m">${it.n}-${hiddenRowsTick()}</span>${Kid({ label: it.n })}</li
              >`,
            null,
            (it) => it.id,
          )}
        </ul>
      </div>
    </section>`,
  };
});
