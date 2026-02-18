import { defineComponent, signal, effect, registerGlobalStyles } from 'thane';
import globalStyles from './global.css';
import { SiteNav } from './components/site-nav.js';
import { SiteFooter } from './components/site-footer.js';
import { HomePage } from './pages/home-page.js';
import { DocsPage } from './pages/docs-page.js';
import { PlaygroundPage } from './pages/playground-page.js';
import { ReleasesPage } from './pages/releases-page.js';

// Register global styles (theme, reset, utilities)
registerGlobalStyles(globalStyles);

/**
 * App — Root component with hash-based routing.
 *
 * Routes:
 *   #/            → Home
 *   #/docs        → Documentation
 *   #/playground  → Playground
 *   #/releases    → Release Notes
 */
export const App = defineComponent('thane-app', () => {
  // ── Router ──
  const getHash = () => window.location.hash.slice(1) || '/';
  const route = signal(getHash());

  // Route matcher signals (updated via effect when route changes)
  const isHome = signal(true);
  const isDocs = signal(false);
  const isPlayground = signal(false);
  const isReleases = signal(false);

  effect(() => {
    const r = route();
    isHome(r === '/' || r === '');
    isDocs(r === '/docs');
    isPlayground(r === '/playground');
    isReleases(r === '/releases');
  });

  return {
    template: html`
      <div class="app-shell">
        ${SiteNav({})}

        <div class="page-wrapper" "${when(isHome())}">
          ${HomePage({})}
        </div>

        <div class="page-wrapper" "${when(isDocs())}">
          ${DocsPage({})}
        </div>

        <div class="page-wrapper" "${when(isPlayground())}">
          ${PlaygroundPage({})}
        </div>

        <div class="page-wrapper" "${when(isReleases())}">
          ${ReleasesPage({})}
        </div>

        ${SiteFooter({})}
      </div>
    `,
    styles: css`
      .app-shell {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }

      .page-wrapper {
        flex: 1;
      }
    `,
    onMount: () => {
      window.addEventListener('hashchange', () => {
        route(getHash());
        // Scroll to top on page change (unless it's an anchor link)
        const hash = window.location.hash;
        if (hash.startsWith('#/')) {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
      });
    },
  };
});
