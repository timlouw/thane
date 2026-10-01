import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { ProbeCard } from '../shared/probe-card.js';

// A repeat() whose row is a child component, inside a when() that starts hidden.
export const ComponentRowsInWhen = defineComponent('hardening-component-rows-in-when', () => {
  const show = signal(false);
  const items = signal(['x', 'y']);
  expose('componentRowsInWhen', { show });
  return {
    template: html`<section>
      <div class="component-rows-when" ${when(show())}>
        <ul>
          ${repeat(items(), (i) => ProbeCard({ label: i }))}
        </ul>
      </div>
    </section>`,
  };
});
