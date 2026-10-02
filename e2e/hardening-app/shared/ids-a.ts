import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from './expose.js';

/**
 * Developer ids on bound elements, on directive roots, on a repeat container and on an element
 * inside a hidden branch. The duplicateIds probe places two instances of it and one IdsB on one page, so
 * every id is duplicated; each instance must bind its own elements.
 */
export const IdsA = defineComponent<{ n: number }>('hardening-ids-a', ({ props }) => {
  const t = signal(`a${props.n}`);
  const show = signal(true);
  const hidden = signal(false);
  const items = signal(['x', 'y']);
  const clicks = signal(0);
  expose(`idsA${props.n}`, { t, show, hidden, items, clicks });
  return {
    template: html`<div class="ids">
      <p id="dev-attr" class="ids-attr" title=${t()}>P</p>
      <div id="dev-when" class="ids-when" ${when(show())}><b class="ids-when-b" title=${t()}>W</b></div>
      ${when(
        show(),
        html`<i id="dev-then" class="ids-then" title=${t()}>T</i>`,
        html`<i id="dev-else" class="ids-else" title=${t()}>E</i>`,
      )}
      <ul id="dev-list" class="ids-list">
        ${repeat(items(), (it) => html`<li class="ids-row">${it}</li>`)}
      </ul>
      <button id="dev-btn" class="ids-btn" @click=${() => clicks(clicks() + 1)}>${clicks()}</button>
      <section class="ids-hidden" ${when(hidden())}>
        <span id="dev-inner" class="ids-inner" title=${t()}>I</span>
      </section>
    </div>`,
  };
});
