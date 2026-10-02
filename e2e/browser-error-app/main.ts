import { defineComponent, mount, html } from 'thane';

const BrowserErrorApp = defineComponent('browser-error-app', () => {
  return {
    template: html`<main data-testid="browser-error-app">Intentional browser error relay test</main>`,
    onMount: () => {
      throw new ReferenceError('thane e2e browser relay test error');
    },
  };
});

mount(BrowserErrorApp);
