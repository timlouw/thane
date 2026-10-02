import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { CountingKid } from '../shared/counting-kid.js';
import { ProbeCard } from '../shared/probe-card.js';

type Leaf = { id: number; n: string };
type Mid = { id: number; name: string; on: boolean; leaves: Leaf[] };
type Top = { id: number; title: string; mids: Mid[] };

/** The probe's starting data; the spec sends changed copies through `window.__probe.nestedLists.tops`. */
export const INITIAL_TOPS: Top[] = [
  {
    id: 1,
    title: 'A',
    mids: [
      {
        id: 11,
        name: 'a1',
        on: true,
        leaves: [
          { id: 111, n: 'x' },
          { id: 112, n: 'y' },
        ],
      },
      { id: 12, name: 'a2', on: false, leaves: [] },
    ],
  },
  { id: 2, title: 'B', mids: [{ id: 21, name: 'b1', on: true, leaves: [{ id: 211, n: 'z' }] }] },
  { id: 3, title: 'C', mids: [] },
];

// A list inside a row is generated like any other list, at any depth.
// - three: three lists, each row reading the rows above it, a handler on each level's row, a .stop one
//   on the innermost;
// - idx: index bindings in inner rows, then a reorder;
// - kids: child components in inner rows, their props reading the outer row;
// - empty: an inner list's empty template;
// - branch: a when() and a when() in inner rows (the nestedRowWhen probe's shape);
// - mixed: repeat › whenElse › repeat › when / whenElse;
// - shadow: an inner list whose item has the outer item's name;
// - after: a handler of the outer row on a static element after an inner list, in the list's container;
// - oitem: a child in an inner row whose props read an outer item named `item`;
// - sigitem: rows whose items are signals and whose parameter is named `item`, read as `item()` in inner rows.
type SigRow = { id: number; name: string; tags: string[] };

export const NestedLists = defineComponent('hardening-nested-lists', () => {
  const tops = signal<Top[]>(INITIAL_TOPS);
  const show = signal(true);
  const log = signal<string[]>([]);
  const sigRows = signal([
    signal<SigRow>({ id: 1, name: 'A', tags: ['x', 'y'] }),
    signal<SigRow>({ id: 2, name: 'B', tags: ['z'] }),
  ]);
  const bump = (what: string) => log([...log(), what]);
  expose('nestedLists', { tops, show, log, sigRows });
  // prettier-ignore
  return html`<div class="lists">
      <ul class="lists-three">${repeat(tops(), (t) => html`<li class="lists-top" @click=${() => bump('top' + t.id)}><b class="lists-top-title">${t.title}</b><ol>${repeat(t.mids, (m) => html`<li class="lists-mid" @click=${() => bump('mid' + m.id)}><i class="lists-mid-name">${t.title}/${m.name}</i><ul>${repeat(m.leaves, (l) => html`<li class="lists-leaf"><button class="lists-leaf-btn" @click=${() => bump('leaf' + l.id)}>${t.title}/${m.name}/${l.n}</button><button class="lists-leaf-stop" @click.stop=${() => bump('stop' + l.id)}>s</button></li>`, { key: "id" })}</ul></li>`, { key: "id" })}</ol></li>`, { key: "id" })}</ul>
      <ul class="lists-idx">${repeat(tops(), (t) => html`<li><ol>${repeat(t.mids, (m, j) => html`<li class="lists-idx-row">${j}:${m.name}</li>`, { key: "id" })}</ol></li>`, { key: "id" })}</ul>
      <ul class="lists-kids">${repeat(tops(), (t) => html`<li><ol>${repeat(t.mids, (m) => html`<li class="lists-kid-row">${CountingKid({ label: t.title + '/' + m.name })}</li>`, { key: "id" })}</ol></li>`, { key: "id" })}</ul>
      <ul class="lists-empty">${repeat(tops(), (t) => html`<li><ol>${repeat(t.mids, (m) => html`<li class="lists-e-row">${m.name}</li>`, { key: "id", empty: html`<li class="lists-e-none">none</li>` })}</ol></li>`, { key: "id" })}</ul>
      <ul class="lists-branch">${repeat(tops(), (t) => html`<li><ol>${repeat(t.mids, (m) => html`<li class="lists-branch-row"><b class="lists-branch-on" ${when(m.on)}>${m.name}</b>${when(m.on, html`<i class="lists-branch-t">${t.title}</i>`, html`<i class="lists-branch-f">off</i>`)}</li>`, { key: "id" })}</ol></li>`, { key: "id" })}</ul>
      <ul class="lists-mixed">${repeat(tops(), (t) => html`<li>${when(show(), html`<ol>${repeat(t.mids, (m) => html`<li class="lists-mx-row"><span class="lists-mx-on" ${when(m.on)}>${t.title}:${m.name}</span>${when(m.on, html`<i class="lists-mx-t">on</i>`, html`<i class="lists-mx-f">off</i>`)}</li>`, { key: "id" })}</ol>`, html`<p class="lists-mx-hidden">hidden</p>`)}</li>`, { key: "id" })}</ul>
      <ul class="lists-shadow">${repeat(tops(), (t) => html`<li><ol>${repeat(t.mids, (t) => html`<li class="lists-sh-row">${t.name}</li>`, { key: "id" })}</ol></li>`, { key: "id" })}</ul>
      <ul class="lists-after">${repeat(tops(), (t) => html`<li><ol>${repeat(t.mids, (m) => html`<li class="lists-af-row">${m.name}</li>`, { key: "id" })}<li class="lists-af-btn" @click=${() => bump('after' + t.id)}>after</li></ol></li>`, { key: "id" })}</ul>
      <ul class="lists-oitem">${repeat(tops(), (item) => html`<li><ol>${repeat(item.mids, (m) => html`<li class="lists-oi-row">${ProbeCard({ label: item.title + ':' + m.name })}</li>`, { key: "id" })}</ol></li>`, { key: "id" })}</ul>
      <ul class="lists-sigitem">${repeat(sigRows(), (item) => html`<li><ol>${repeat(item().tags, (tag) => html`<li class="lists-si-row">${item().name}/${tag}</li>`)}</ol></li>`)}</ul>
    </div>`;
});
