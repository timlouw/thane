import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { CountingKid } from '../shared/counting-kid.js';

type Row = { id: number; label: string; on: boolean; kids: { id: number; n: string }[] };

// The code a row keeps after it is created (a subscription to another signal, a listener on one of its
// elements, a child inside one of its directives) reads the row's item and index as they are now: after the
// row gets a new item under the same key, or moves.
export const RowClosures = defineComponent('hardening-row-closures', () => {
  const kids = [{ id: 10, n: 'k' }];
  const rows = signal<Row[]>([
    { id: 1, label: 'a', on: true, kids },
    { id: 2, label: 'b', on: true, kids },
  ]);
  const suffix = signal('!');
  const picked = signal('');
  const pick = (what: string) => picked(what);
  expose('rowClosures', { rows, suffix, picked });
  return {
    template: html`<div>
      <ul class="rc-mixed">
        ${repeat(rows(), (r) => html`<li>${r.label + suffix()}</li>`, { key: 'id' })}
      </ul>
      <ul class="rc-self">
        ${repeat(rows(), (r) => html`<li @click.self=${() => pick('self ' + r.label)}>${r.label}</li>`, { key: 'id' })}
      </ul>
      <ul class="rc-index">
        ${repeat(rows(), (r, i) => html`<li @click=${() => pick('index ' + i)}>${r.label}</li>`, { key: 'id' })}
      </ul>
      <ul class="rc-self-index">
        ${repeat(rows(), (r, i) => html`<li @click.self=${() => pick('self index ' + i)}>${r.label}</li>`, {
          key: 'id',
        })}
      </ul>
      <ul class="rc-branch-kid">
        ${repeat(rows(), (r) => html`<li>${when(r.on, html`${CountingKid({ label: 'branch ' + r.label })}`)}</li>`, {
          key: 'id',
        })}
      </ul>
      <ul class="rc-inner-kid">
        ${repeat(
          rows(),
          (r) =>
            html`<li
              ><ol
                >${repeat(r.kids, (k) => html`<li>${CountingKid({ label: r.label + '/' + k.n })}</li>`, { key: 'id' })}</ol
              ></li
            >`,
          { key: 'id' },
        )}
      </ul>
    </div>`,
  };
});
