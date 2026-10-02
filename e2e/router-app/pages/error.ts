import { defineComponent, html } from 'thane';

export const ErrorPage = defineComponent('error-page', ({ route }) => {
  const message = route!.error instanceof Error ? route!.error.message : String(route!.error);
  return html`
    <section data-testid="error-page">
      <h2 data-testid="page-title">Something went wrong</h2>
      <p data-testid="error-message">${message}</p>
      <button data-testid="error-reload" @click=${() => location.reload()}>Reload</button>
    </section>
  `;
});

export default ErrorPage;
