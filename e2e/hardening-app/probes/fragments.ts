import { defineComponent, signal, html, whenElse, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// Fragments, html`` consts inlined wherever a template goes: a module fragment and a component
// fragment as whenElse() branches, one used twice with a signal and a child component in it, and one as
// a repeat() empty template.
const FragmentKid = defineComponent<{ n: number }>(({ props }) => ({
  template: html`<em class="fragment-kid-n">${props.n}</em>`,
}));

const busy = html`<span class="fragments-busy">busy</span>`;

export const Fragments = defineComponent('hardening-fragments', () => {
  const loading = signal(true);
  const count = signal(1);
  const rows = signal<number[]>([]);
  const counter = html`<b class="fragments-count">${count()}</b>${FragmentKid({ n: 7 })}`;
  const done = html`<p class="fragments-done">done</p>`;
  const empty = html`<li class="fragments-empty">none</li>`;
  expose('fragments', { loading, count, rows });
  return {
    template: html`<div class="fragments">
      ${whenElse(loading(), busy, done)}
      <section class="fragments-a">${counter}</section>
      <section class="fragments-b">${counter}</section>
      <ul class="fragments-rows">
        ${repeat(rows(), (r) => html`<li class="fragments-row">${r}</li>`, empty)}
      </ul>
    </div>`,
  };
});
