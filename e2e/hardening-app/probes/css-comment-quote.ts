import { defineComponent, html, css } from 'thane';

// A quote inside a CSS comment (dev build). Every rule stays scoped to the component,
// so the rule for .comment-quote-leak must not reach the element with that class outside the component.
export const CssCommentQuote = defineComponent('hardening-css-comment-quote', () => ({
  template: html`<div><p class="comment-quote-a">comment</p><p class="comment-quote-leak">inside</p></div>`,
  styles: css`
    .comment-quote-a {
      /* it's a comment */
      color: rgb(0, 0, 255);
    }
    .comment-quote-leak {
      color: rgb(1, 2, 3);
    }
  `,
}));
