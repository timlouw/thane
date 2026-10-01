import { defineComponent, html, css } from 'thane';

// :host-context() applies while an ancestor of the component matches its argument.
export const HostContext = defineComponent('hardening-host-context', () => ({
  template: html`<p class="host-context-a">context</p>`,
  styles: css`
    :host-context(.host-context-dark) .host-context-a {
      color: rgb(255, 0, 0);
    }
  `,
}));
