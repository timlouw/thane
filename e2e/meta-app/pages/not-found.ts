import { defineComponent, html } from 'thane';

export const NotFoundPage = defineComponent(
  'meta-not-found',
  () => html`<main><h1 class="not-found">Not found</h1></main>`,
);
