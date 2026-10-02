import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// The text between row text bindings, one shape per list. The paragraphs are the same
// shapes at component level, for comparison. The last four shapes (a binding next to an element) lose
// their space too.
export const RowTextSpace = defineComponent('hardening-row-text-space', () => {
  const items = signal([{ id: 1, first: 'John', mid: 'Q', last: 'Doe' }]);
  const label = signal('L');
  const a = signal('A');
  const b = signal('B');
  expose('rowTextSpace', { items, label, a, b });
  // prettier-ignore
  return html`<div class="row-text">
      <ul class="row-text-space">${repeat(items(), (it) => html`<li>${it.first} ${it.last}</li>`)}</ul>
      <ul class="row-text-two">${repeat(items(), (it) => html`<li>${it.first}  ${it.last}</li>`)}</ul>
      <ul class="row-text-newline">${repeat(items(), (it) => html`<li>${it.first}
        ${it.last}</li>`)}</ul>
      <ul class="row-text-padded">${repeat(items(), (it) => html`<li>
        ${it.first} ${it.last}
      </li>`)}</ul>
      <ul class="row-text-three">${repeat(items(), (it) => html`<li>${it.first} ${it.mid} ${it.last}</li>`)}</ul>
      <ul class="row-text-signal">${repeat(items(), (it) => html`<li>${it.first} ${label()}</li>`)}</ul>
      <ul class="row-text-dash">${repeat(items(), (it) => html`<li>${it.first}-${it.last}</li>`)}</ul>
      <ul class="row-text-adjacent">${repeat(items(), (it) => html`<li>${it.first}${it.last}</li>`)}</ul>
      <ul class="row-text-around">${repeat(items(), (it) => html`<li>x ${it.first} y</li>`)}</ul>
      <ul class="row-text-when">${repeat(items(), (it) => html`<li><span ${when(it.id > 0)}>${it.first} ${it.last}</span></li>`)}</ul>
      <p class="row-text-component">${a()} ${b()}</p>
      <ul class="row-text-before">${repeat(items(), (it) => html`<li>${it.first} <b>b</b></li>`)}</ul>
      <ul class="row-text-after">${repeat(items(), (it) => html`<li><b>b</b> ${it.first}</li>`)}</ul>
      <p class="row-text-cbefore">${a()} <b>b</b></p>
      <p class="row-text-cafter"><b>b</b> ${a()}</p>
    </div>`;
});
