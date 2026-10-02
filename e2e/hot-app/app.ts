import { defineComponent, html, signal } from 'thane';
import { clicks } from './store.js';
import { HotLabel } from './label.js';

export const HotApp = defineComponent('hot-app', () => {
  const opened = signal(0);
  return html`<main>
    <h1 class="hot-title">a1</h1>
    <button class="hot-click" @click=${() => clicks(clicks() + 1)}>click</button>
    <span class="hot-clicks">${clicks()}</span>
    <button class="hot-open" @click=${() => opened(opened() + 1)}>open</button>
    <span class="hot-opened">${opened()}</span>
    ${HotLabel({ n: 1 })}
  </main>`;
});
