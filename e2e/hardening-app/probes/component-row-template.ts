import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import { ProbeCard } from '../shared/probe-card.js';

// A row that is a component call with a template literal in its props.
export const ComponentRowTemplate = defineComponent('hardening-component-row-template', () => {
  const rows = signal([
    { id: 1, label: 'a' },
    { id: 2, label: 'b' },
  ]);
  expose('componentRowTemplate', { rows });
  return {
    template: html`<div class="component-row">
      ${repeat(rows(), (item) => ProbeCard({ label: `x-${item.label}` }), { key: 'id' })}
    </div>`,
  };
});
