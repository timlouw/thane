import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// A component whose template starts with text and holds a list, bindings and an event,
// mounted into document.body after the nodes the page already has (`&target=body`).
export const BodyMount = defineComponent('hardening-body-mount', () => {
  const t = signal('t0');
  const items = signal(['a', 'b']);
  const clicks = signal(0);
  expose('bodyMount', { t, items, clicks });
  return {
    // prettier-ignore
    template: html`body ${t()}
    <div class="body-mount" title=${t()}>
      <ul class="body-mount-list">${repeat(items(), (it) => html`<li class="body-mount-row">${it}</li>`)}</ul>
      <button class="body-mount-btn" @click=${() => clicks(clicks() + 1)}>${clicks()}</button>
    </div>`,
  };
});
