import { defineComponent, signal, html, when, type Fragment } from 'thane';
import { expose } from '../shared/expose.js';

interface PanelProps {
  title: string;
  body: Fragment;
  footer?: Fragment;
}

// A child with two slots: its body in its content, its footer (optional) in a when() branch of its own
const SlotPanel = defineComponent<PanelProps>('hardening-slot-panel', ({ props }) => {
  const expanded = signal(true);
  expose(`slotPanel${props.title}`, { expanded });
  return {
    template: html`<section class="slot-panel">
      <h3>${props.title}</h3>
      <div class="slot-body">${props.body}</div>
      ${when(expanded(), html`<footer class="slot-footer">${props.footer}</footer>`)}
    </section>`,
  };
});

// The parent passes templates that read its signals and call its handlers
export const Slots = defineComponent('hardening-slots', () => {
  const count = signal(1);
  const shown = signal(true);
  const withFooter = signal(true);
  const bump = () => count(count() + 1);
  const subscribers = () => (count as unknown as { _s: unknown[] })._s.filter((s) => s !== null).length;
  expose('slots', { count, shown, withFooter, subscribers });
  return {
    template: html`<div>
      ${when(
        shown(),
        html`${SlotPanel({
          title: 'Panel',
          body: html`<p class="slot-count">count ${count()}</p> <button class="slot-bump" @click=${bump}>bump</button>`,
          footer: html`<i class="slot-note">${count() > 2 ? 'many' : 'few'}</i>`,
        })}`,
      )}
      ${when(withFooter(), html`<div class="slot-bare">${SlotPanel({ title: 'Bare', body: html`<b>bare</b>` })}</div>`)}
    </div>`,
  };
});
