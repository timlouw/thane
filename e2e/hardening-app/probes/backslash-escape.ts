import { defineComponent, html } from 'thane';

// A backslash and an escaped \${ in template text. The template's value is the text
// `C:\dir` and the literal characters `${notExpr}`; neither is an interpolation.
export const BackslashEscape = defineComponent(
  'hardening-backslash-escape',
  () =>
    // prettier-ignore
    html`<div><p class="escape-bs">C:\\dir</p><p class="escape-dollar">\${notExpr}</p></div>`,
);
