import { defineComponent, html } from 'thane';
import { currentPath, href, isActive, navigate } from 'thane/router';
import { visitCount, sharedMessage } from './store.js';

export const Shell = defineComponent('router-shell', () => {
  return html`
    <header data-testid="shell-header">
      <h1 data-testid="app-title">Router E2E App</h1>
      <nav data-testid="nav">
        <a data-testid="nav-home" class:active=${isActive('/')} href="/" @click.prevent=${navigate('/')}>Home</a>
        <a data-testid="nav-about" class:active=${isActive('/about')} href="/about" @click.prevent=${navigate('/about')}
          >About</a
        >
        <a
          data-testid="nav-user"
          class:active=${isActive('/users/:id')}
          href="/users/42"
          @click.prevent=${navigate('/users/42')}
          >User 42</a
        >
        <a
          data-testid="nav-user-tab-a"
          href="/users/42?tab=a"
          @click=${(e: Event) => {
            e.preventDefault();
            navigate('/users/42?tab=a');
          }}
          >Tab A</a
        >
        <a
          data-testid="nav-user-tab-b"
          href="/users/42?tab=b"
          @click=${(e: Event) => {
            e.preventDefault();
            navigate('/users/42?tab=b');
          }}
          >Tab B</a
        >
        <a
          data-testid="nav-user-params"
          href=${href('/users/:id', { id: 'ada lovelace' })}
          @click.prevent=${navigate('/users/:id', { id: 'ada lovelace' })}
          >Ada</a
        >
        <a data-testid="nav-plain-about" href="/about">About (plain link)</a>
        <a data-testid="nav-file" href="/robots.txt">A file</a>
      </nav>
      <div data-testid="current-path">${currentPath()}</div>
      <div data-testid="shell-visit-count">${visitCount()}</div>
      <div data-testid="shell-message">${sharedMessage()}</div>
    </header>
    <router-outlet></router-outlet>
    <footer data-testid="shell-footer">Footer</footer>
  `;
});
