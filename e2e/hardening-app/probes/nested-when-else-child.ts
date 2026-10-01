import { defineComponent, signal, html, when, whenElse } from 'thane';
import { expose } from '../shared/expose.js';
import { ProbeCard } from '../shared/probe-card.js';

// A child component inside a whenElse() that is nested in a when().
export const NestedWhenElseChild = defineComponent('hardening-nested-when-else-child', () => {
  const show = signal(true);
  const flag = signal(true);
  expose('nestedWhenElseChild', { show, flag });
  return {
    template: html`<section>
      <div class="nested-branch-when" ${when(show())}>
        ${whenElse(flag(), html`<p class="nested-branch-then">${ProbeCard({ label: 'branch-card' })}</p>`, html`<p class="nested-branch-else">no</p>`)}
      </div>
    </section>`,
  };
});
