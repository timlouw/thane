import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// Double quotes inside an attribute expression, in rows and at component level: the row analysis
// wrote such a binding back as a quoted value, where the expression's own quotes ended it.
export const QuotesInAttrs = defineComponent('hardening-quotes-in-attrs', () => {
  const items = signal([
    { id: 1, on: true, label: 'A' },
    { id: 2, on: false, label: 'B' },
  ]);
  const sel = signal(1);
  const flag = signal(true);
  expose('quotesInAttrs', { items, sel, flag });
  return {
    // The double quotes are what the probe is about: Prettier would turn them into single quotes
    // prettier-ignore
    template: html`<div>
      <p class="quotes-top" title=${flag() ? "one" : "two"}>top</p>
      <ul>${repeat(items(), (it) => html`<li class=${sel() === it.id ? "on" : ""} title=${it.on ? "yes" : "no"} data-x="${it.label + "!"}">${it.label}</li>`, null, (it) => it.id)}</ul>
    </div>`,
  };
});
