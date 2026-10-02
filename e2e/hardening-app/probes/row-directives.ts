import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { CountingKid } from '../shared/counting-kid.js';

type Row = { id: number; first: string; last: string; on: boolean; tags: string[] };

// The content of a row's when() / when() is bound by the same initializer as a
// component-level branch, so it may hold anything a branch can: bindings, events, child components,
// nested directives and lists.
// - pre: a when() on a component signal that is true at compile time is pre-rendered in the row; its
//   content (two text bindings separated by a space, an attribute) is the when()'s own template.
// - events: handlers in both when() branches, one with .stop, under a handler on the row element.
// - kids: child components in a row's when() on a component signal (pre-rendered), in a when() on the
//   item, and in both when() branches (the last two did not build once: THANE202).
// - nested: a when() and a list inside a row's when(), a list inside a row's when() branch.
export const RowDirectives = defineComponent('hardening-row-directives', () => {
  const rows = signal<Row[]>([
    { id: 1, first: 'John', last: 'Doe', on: true, tags: ['a', 'b'] },
    { id: 2, first: 'Jane', last: 'Roe', on: false, tags: ['c'] },
  ]);
  const show = signal(true);
  const log = signal<string[]>([]);
  const bump = (what: string) => log([...log(), what]);
  expose('rowDirectives', { rows, show, log });
  // prettier-ignore
  return html`<div class="row-dirs">
      <ul class="row-dirs-pre">${repeat(rows(), (r) => html`<li><span class="row-dirs-pre-w" ${when(show())} title=${r.first}>${r.first} ${r.last}</span></li>`, { key: "id" })}</ul>
      <ul class="row-dirs-events">${repeat(rows(), (r) => html`<li @click=${() => bump('row' + r.id)}>${when(r.on, html`<button class="row-dirs-then" @click=${() => bump('then' + r.id)}>then</button>`, html`<button class="row-dirs-else" @click.stop=${() => bump('else' + r.id)}>else</button>`)}</li>`, { key: "id" })}</ul>
      <ul class="row-dirs-kids">${repeat(rows(), (r) => html`<li><div class="row-dirs-kw" ${when(show())}>${CountingKid({ label: 'w' + r.id })}</div><div class="row-dirs-kr" ${when(r.on)}>${CountingKid({ label: 'r' + r.id })}</div>${when(r.on, html`<p class="row-dirs-kt">${CountingKid({ label: 't' + r.id })}</p>`, html`<p class="row-dirs-ke">${CountingKid({ label: 'e' + r.id })}</p>`)}</li>`, { key: "id" })}</ul>
      <ul class="row-dirs-nested">${repeat(rows(), (r) => html`<li><div class="row-dirs-in" ${when(show())}>${when(r.on, html`<b class="row-dirs-in-then">${r.first}</b>`, html`<i class="row-dirs-in-else">off</i>`)}<ol>${repeat(r.tags, (t) => html`<li class="row-dirs-in-tag">${t}</li>`)}</ol></div>${when(r.on, html`<ol class="row-dirs-we-list">${repeat(r.tags, (t) => html`<li class="row-dirs-we-tag">${r.first}:${t}</li>`)}</ol>`, html`<i class="row-dirs-we-none">none</i>`)}</li>`, { key: "id" })}</ul>
    </div>`;
});
