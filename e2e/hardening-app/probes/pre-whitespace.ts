import { defineComponent, html } from 'thane';

// Whitespace inside <pre> in a component template.
export const PreWhitespace = defineComponent('hardening-pre-whitespace', () => ({
  // prettier-ignore
  template: html`<pre class="whitespace-pre">line1
    line2</pre>`,
}));
