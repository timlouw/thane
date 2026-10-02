import { defineComponent, signal, html } from 'thane';
import { expose } from '../shared/expose.js';
import { ProbeCard } from '../shared/probe-card.js';

// JavaScript's control flow in content: a ternary of templates, `&&`, a chain of ternaries, `.map()` rows (of
// templates and of child components), and a ternary of text, which stays a text binding.
export const ControlFlow = defineComponent('hardening-control-flow', () => {
  const open = signal(false);
  const n = signal(0);
  const items = signal(['a', 'b']);
  expose('controlFlow', { open, n, items });
  return html`<div>
    <section class="flow-ternary">
      ${open() ? html`<b class="flow-on">on ${n()}</b>` : html`<i class="flow-off">off</i>`}
    </section>
    <section class="flow-and">${open() && html`<b class="flow-and-on">shown</b>`}</section>
    <section class="flow-chain">
      ${n() > 2 ? html`<b>many</b>` : n() > 0 ? html`<i>some</i>` : html`<u>none</u>`}
    </section>
    <ul class="flow-map">
      ${items().map((item, i) => html`<li class="flow-row">${i}:${item}</li>`)}
    </ul>
    <div class="flow-cards">${items().map((item) => ProbeCard({ label: item }))}</div>
    <p class="flow-text">${open() ? 'yes' : 'no'}</p>
  </div>`;
});
