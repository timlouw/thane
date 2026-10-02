import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { ProbeCard } from '../shared/probe-card.js';

type User = { name: string; tags: string[] };

// when()'s narrowing form: the branch is a function of the condition's value, typed without null. Its bindings,
// handlers and child props read the value; in a row the condition reads the row's item.
export const Narrowing = defineComponent('hardening-narrowing', () => {
  const user = signal<User | null>(null);
  const greeted = signal('');
  const rows = signal([
    { id: 1, tag: 'x' as string | null },
    { id: 2, tag: null as string | null },
  ]);
  expose('narrowing', { user, greeted, rows });
  return html`<div>
    <section class="narrow">
      ${when(
        user(),
        (u) =>
          html`<p class="narrow-name" title=${u.name}>${u.name} (${u.tags.length})</p>
            <button class="narrow-greet" @click=${() => greeted(u.name)}>greet</button>
            ${ProbeCard({ label: u.name })}`,
        html`<p class="narrow-none">none</p>`,
      )}
    </section>
    <b class="narrow-greeted">${greeted()}</b>
    <ul class="narrow-rows">
      ${repeat(rows(), (r) => html`<li>${when(r.tag, (t) => html`<b class="narrow-tag">${t}</b>`)}</li>`, {
        key: 'id',
      })}
    </ul>
  </div>`;
});
