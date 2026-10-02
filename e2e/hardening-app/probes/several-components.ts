import { defineComponent, signal, html, css, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// Several components in one file. LocalPill is not exported: SeveralComponents mounts it at the top
// level and in its rows. ExportedCount is exported next to it. Each has a signal named `count` with its
// own initial value, and LocalPill's styles apply to its own elements only.
const LocalPill = defineComponent<{ label: string }>(({ props }) => {
  const count = signal(2);
  return {
    template: html`<span class="local-pill-text">${props.label} ${count()}</span>`,
    styles: css`
      span {
        color: rgb(0, 128, 0);
      }
    `,
  };
});

export const ExportedCount = defineComponent(() => {
  const count = signal(3);
  expose('exportedCount', { count });
  return html`<b class="exported-count-value">${count()}</b>`;
});

export const SeveralComponents = defineComponent('hardening-several-components', () => {
  const count = signal(1);
  const items = signal([
    { id: 1, label: 'a' },
    { id: 2, label: 'b' },
  ]);
  expose('severalComponents', { count, items });
  return html`<div class="several">
    <p class="several-own">${count()}</p>
    <span class="several-plain">plain</span>
    ${LocalPill({ label: 'top' })} ${ExportedCount()}
    <ul class="several-rows">
      ${repeat(items(), (item) => html`<li>${LocalPill({ label: item.label })}</li>`, { key: 'id' })}
    </ul>
  </div>`;
});
