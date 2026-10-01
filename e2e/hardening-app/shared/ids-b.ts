import { defineComponent, signal, html } from 'thane';
import { expose } from './expose.js';

/** A second component that uses the same developer ids as IdsA. */
export const IdsB = defineComponent('hardening-ids-b', () => {
  const t = signal('b');
  expose('idsB', { t });
  return {
    template: html`<div class="ids-b">
      <p id="dev-attr" class="ids-b-attr" title=${t()}>P</p>
      <span id="dev-inner" class="ids-b-inner" title=${t()}>I</span>
    </div>`,
  };
});
