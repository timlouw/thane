import { defineComponent, html, css, signal } from 'thane';

// The file's own signal: kept when the file changes
const total = signal(0);

// The component the hot update test changes: its text and its colour. Its taps are kept when it is swapped.
export const HotLabel = defineComponent<{ n: number }>('hot-label', ({ props }) => {
  const taps = signal(0);
  const tap = () => {
    taps(taps() + 1);
    total(total() + 1);
  };
  return {
    template: html`<b class="hot-label-text">v1 ${props.n}</b>
      <button class="hot-tap" @click=${tap}>tap</button>
      <span class="hot-taps">${taps()}</span> <span class="hot-total">${total()}</span>`,
    styles: css`
      b {
        color: rgb(0, 0, 255);
      }
    `,
  };
});
