import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// A method call on the row item in a row text binding.
export const RowMethodCall = defineComponent('hardening-row-method-call', () => {
  const items = signal([
    { id: 1, name: 'alpha' },
    { id: 2, name: 'beta' },
  ]);
  expose('rowMethodCall', { items });
  return {
    template: html`<ul>
      ${repeat(
        items(),
        (it) => html`<li class="method-row">${it.name.toUpperCase()}</li>`,
        null,
        (it) => it.id,
      )}
    </ul>`,
  };
});
