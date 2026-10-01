import { defineComponent, signal, type Signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';

type SigRow = { id: number; on: boolean; name: string };

// Rows whose items are signals (the Signal<Signal<T>[]> pattern) with a when() on the item
// signal and a binding that reads it inside. The row's directives read the item variable itself, which
// the row factory declares (`const row = item;`).
export const SignalRows = defineComponent('hardening-signal-rows', () => {
  const rows = signal<Signal<SigRow>[]>([
    signal({ id: 1, on: true, name: 's1' }),
    signal({ id: 2, on: false, name: 's2' }),
  ]);
  const set = (i: number, patch: Partial<SigRow>) => {
    const s = rows()[i]!;
    s({ ...s(), ...patch });
  };
  expose('signalRows', { set });
  return {
    // prettier-ignore
    template: html`<ul class="signal-rows">${repeat(rows(), (row) => html`<li class="signal-row"><b ${when(row().on)}>${row().name}</b></li>`, null, (row) => row().id)}</ul>`,
  };
});
