import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { Kid } from '../shared/kid.js';

// A child component in the rows of a repeat() inside a when(). The child's mount was emitted at
// component level, where the row item is out of scope, so the component failed to mount.
export const RowChildInWhen = defineComponent('hardening-row-child-in-when', () => {
  const items = signal([
    { id: 1, n: 'a' },
    { id: 2, n: 'b' },
  ]);
  const show = signal(true);
  expose('rowChildInWhen', { show });
  return {
    template: html`<section>
      <div class="when-rows-when" ${when(show())}>
        <ul>
          ${repeat(
            items(),
            (it) => html`<li class="when-rows-row">${Kid({ label: it.n })}</li>`,
            null,
            (it) => it.id,
          )}
        </ul>
      </div>
    </section>`,
  };
});
