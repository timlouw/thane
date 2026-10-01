import { defineComponent, signal, html, when, whenElse } from 'thane';
import { expose } from '../shared/expose.js';

// A hyphenated tag as a whenElse() branch root and as the element carrying when().
export const HyphenatedTag = defineComponent('hardening-hyphenated-tag', () => {
  const flag = signal(false);
  const show = signal(false);
  expose('hyphenatedTag', { flag, show });
  return {
    template: html`<section class="hyphenated">
      ${whenElse(flag(), html`<my-tag class="hyphenated-we">A</my-tag>`, html`<b class="hyphenated-we-else">B</b>`)}
      <my-tag class="hyphenated-w" ${when(show())}>W</my-tag>
    </section>`,
  };
});
