import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// A when() inside a nested repeat() row whose content reads the inner item.
export const NestedRowWhen = defineComponent('hardening-nested-row-when', () => {
  const groups = signal([{ id: 1, tags: ['a'] }]);
  const show = signal(true);
  expose('nestedRowWhen', { show });
  return {
    template: html`<ul>
      ${repeat(
        groups(),
        (g) =>
          html`<li>
            <ol>
              ${repeat(g.tags, (t) => html`<li><em class="nested-when-w" ${when(show())}>${t}-shown</em></li>`)}
            </ol>
          </li>`,
        { key: 'id' },
      )}
    </ul>`,
  };
});
