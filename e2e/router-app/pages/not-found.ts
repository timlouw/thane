import { defineComponent } from 'thane';

export const NotFoundPage = defineComponent('not-found-page', () => {
  return {
    template: html`
      <section data-testid="not-found-page">
        <h2 data-testid="page-title">404 — Not Found</h2>
        <p data-testid="not-found-text">The page you requested does not exist.</p>
      </section>
    `,
  };
});

export default NotFoundPage;
