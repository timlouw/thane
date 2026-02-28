import { defineComponent, signal } from 'thane';
import { visitCount, sharedMessage } from './store.js';

export const Shell = defineComponent('router-shell', () => {
  return {
    template: html`
      <header data-testid="shell-header">
        <h1 data-testid="app-title">Router E2E App</h1>
        <nav data-testid="nav">
          <a data-testid="nav-home" href="/" @click=${(e: Event) => { e.preventDefault(); navigate('/'); }}>Home</a>
          <a data-testid="nav-about" href="/about" @click=${(e: Event) => { e.preventDefault(); navigate('/about'); }}>About</a>
          <a data-testid="nav-user" href="/users/42" @click=${(e: Event) => { e.preventDefault(); navigate('/users/42'); }}>User 42</a>
        </nav>
        <div data-testid="shell-visit-count">${visitCount()}</div>
        <div data-testid="shell-message">${sharedMessage()}</div>
      </header>
      <main id="router-outlet"></main>
      <footer data-testid="shell-footer">Footer</footer>
    `,
  };
});
