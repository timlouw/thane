import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// Event modifiers: the guards (.prevent, .stop, .self), the keys, and the listener options (.once, .passive,
// .capture), at component level, in a when() branch and in list rows (where an option gives each row a
// listener of its own).
export const EventModifiers = defineComponent('hardening-event-modifiers', () => {
  const log = signal<string[]>([]);
  const add = (entry: string) => log([...log(), entry]);
  const rows = signal([{ id: 1 }, { id: 2 }]);
  const open = signal(true);
  expose('eventModifiers', { log, rows, open });
  return {
    template: html`<div>
      <button class="em-once" @click.once=${() => add('once')}>once</button>
      <div class="em-capture-outer" @click.capture=${() => add('outer capture')} @click=${() => add('outer bubble')}>
        <button class="em-capture-inner" @click=${() => add('inner')}>inner</button>
      </div>
      <a
        class="em-passive"
        href="#passive"
        @click.passive=${(e) => {
          e.preventDefault();
          add('passive prevented ' + e.defaultPrevented);
        }}
        >passive</a
      >
      <a class="em-prevent" href="#prevent" @click.prevent=${(e) => add('prevented ' + e.defaultPrevented)}>prevent</a>
      <input class="em-keys" @keydown.enter.esc=${(e) => add('key ' + e.key)} />
      <input class="em-key-once" @keydown.enter.once=${() => add('enter once')} />
      ${when(open(), html`<button class="em-branch-once" @click.once=${() => add('branch once')}>branch</button>`)}
      <ul class="em-rows">
        ${repeat(
          rows(),
          (r) => html`<li><button @click.once.stop=${() => add('row once ' + r.id)}>${r.id}</button></li>`,
          {
            key: 'id',
          },
        )}
      </ul>
    </div>`,
  };
});
