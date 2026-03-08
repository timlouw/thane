import { defineComponent } from 'thane';
import { visitCount, sharedMessage } from './store.js';

export const Shell = defineComponent('router-shell', () => {
  return {
    template: html`
      <header data-testid="shell-header">
        <h1 data-testid="app-title">Router E2E App</h1>
        <nav data-testid="nav">
          <a
            data-testid="nav-home"
            class=${currentPath() === '/' ? 'active' : ''}
            href="/"
            @click=${(e: Event) => {
              e.preventDefault();
              navigate('/');
            }}
            >Home</a
          >
          <a
            data-testid="nav-about"
            class=${currentPath() === '/about' ? 'active' : ''}
            href="/about"
            @click=${(e: Event) => {
              e.preventDefault();
              navigate('/about');
            }}
            >About</a
          >
          <a
            data-testid="nav-user"
            class=${currentPath() === '/users/42' ? 'active' : ''}
            href="/users/42"
            @click=${(e: Event) => {
              e.preventDefault();
              navigate('/users/42');
            }}
            >User 42</a
          >
        </nav>
        <div data-testid="current-path">${currentPath()}</div>
        <div data-testid="shell-visit-count">${visitCount()}</div>
        <div data-testid="shell-message">${sharedMessage()}</div>
      </header>
      <main id="router-outlet"></main>
      <footer data-testid="shell-footer">Footer</footer>
    `,
  };
});
