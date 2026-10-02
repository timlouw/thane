import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// The whitespace between a text binding and an element or directive next to it,
// rendered. Rows first, then the same at component level and in a when() branch. The last
// paragraph is whitespace between two elements, which is not text and still goes.
export const TextNextToElements = defineComponent('hardening-text-next-to-elements', () => {
  const items = signal([{ id: 1, first: 'John', last: 'Doe', on: true }]);
  const a = signal('A');
  const b = signal('B');
  const on = signal(true);
  expose('textNextToElements', { items, a, b, on });
  return {
    // prettier-ignore
    template: html`<div class="next-to">
      <ul class="next-to-label">${repeat(items(), (it) => html`<li><b>Name:</b> ${it.first}</li>`)}</ul>
      <ul class="next-to-check">${repeat(items(), (it) => html`<li><input type="checkbox"> ${it.first}</li>`)}</ul>
      <ul class="next-to-before">${repeat(items(), (it) => html`<li>${it.first} <b>x</b></li>`)}</ul>
      <ul class="next-to-when">${repeat(items(), (it) => html`<li>${it.first} <span ${when(it.on)}>w</span> ${it.last}</li>`)}</ul>
      <ul class="next-to-whenelse">${repeat(items(), (it) => html`<li>${it.first} ${when(it.on, html`<i>y</i>`, html`<i>n</i>`)} ${it.last}</li>`)}</ul>
      <p class="next-to-cbefore">${a()} <b>x</b></p>
      <p class="next-to-cwhen">${a()} <span ${when(on())}>w</span> ${b()}</p>
      <p class="next-to-cwhenelse">${a()} ${when(on(), html`<i>y</i>`, html`<i>n</i>`)} ${b()}</p>
      ${when(on(), html`<p class="next-to-branch">${a()} <b>x</b></p>`, html`<p class="next-to-branch">none</p>`)}
      <p class="next-to-elements"><b>x</b> <i>y</i></p>
      <p class="next-to-lines"><b>x</b>
        <i>y</i></p>
    </div>`,
  };
});
