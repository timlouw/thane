import { defineComponent, signal, html } from 'thane';
import { expose } from '../shared/expose.js';

// Rows whose attributes read a signal of the component, not the row's item: a boolean attribute (disabled), a
// property (value), and a class before another attribute, which a bare `class=` would swallow
export const RowSignalAttributes = defineComponent('hardening-row-signal-attributes', () => {
  const off = signal(false);
  const note = signal('n');
  const tone = signal('calm');
  expose('rowSignalAttributes', { off, note, tone });
  return html`<div>
    ${['a', 'b'].map(
      (label) =>
        html`<label class="rsa-row">
          <input class="rsa-box" type="checkbox" disabled=${off()} />
          <input class=${tone()} type="checkbox" />
          <input class="rsa-note" value=${note()} />
          ${label}
        </label>`,
    )}
  </div>`;
});
