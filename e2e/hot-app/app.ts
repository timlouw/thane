import { defineComponent, html, signal } from 'thane';
import { clicks, step } from './store.js';
import { HotLabel } from './label.js';
import styles from './app.css';

export const HotApp = defineComponent('hot-app', () => {
  const opened = signal(0);
  return {
    template: html`<main>
      <h1 class="hot-title">a1</h1>
      <button class="hot-click" @click=${() => clicks(clicks() + step)}>click</button>
      <span class="hot-clicks">${clicks()}</span>
      <button class="hot-open" @click=${() => opened(opened() + 1)}>open</button>
      <span class="hot-opened">${opened()}</span>
      ${HotLabel({ n: 1 })}
    </main>`,
    styles,
  };
});
