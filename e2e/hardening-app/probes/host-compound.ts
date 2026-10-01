import { defineComponent, html, css } from 'thane';

// :host() with a compound argument that contains its own parentheses.
// Correct scoping: the rule applies only while the host has .y and does not have .x.
export const HostCompound = defineComponent('hardening-host-compound', () => ({
  template: html`<p class="host-compound-a">compound</p>`,
  styles: css`
    :host(:not(.x).y) .host-compound-a {
      color: rgb(0, 128, 0);
    }
  `,
}));
