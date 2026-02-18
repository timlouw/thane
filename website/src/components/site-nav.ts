import { defineComponent, signal } from 'thane';

export const SiteNav = defineComponent('site-nav', ({ root }) => {
  const mobileOpen = signal(false);
  const toggleMobile = () => mobileOpen(!mobileOpen());
  const closeMobile = () => mobileOpen(false);

  const scrolledClass = signal('');

  return {
    template: html`
      <nav class="site-nav ${scrolledClass()}">
        <div class="nav-inner container">
          <a href="#/" class="nav-logo" @click=${closeMobile}>
            <span class="logo-icon">⚡</span>
            <span class="logo-text">Thane</span>
          </a>

          <div class="nav-links">
            <a href="#/docs" class="nav-link">Docs</a>
            <a href="#/playground" class="nav-link">Playground</a>
            <a href="#/releases" class="nav-link">Releases</a>
            <a href="https://github.com/timlouw/thane" target="_blank" rel="noopener noreferrer" class="nav-link nav-github">
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            </a>
          </div>

          <button class="nav-toggle" @click=${toggleMobile}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>

        <div class="mobile-menu" ${when(mobileOpen())}>
          <a href="#/docs" class="mobile-link" @click=${closeMobile}>Docs</a>
          <a href="#/playground" class="mobile-link" @click=${closeMobile}>Playground</a>
          <a href="#/releases" class="mobile-link" @click=${closeMobile}>Releases</a>
          <a href="https://github.com/timlouw/thane" target="_blank" rel="noopener noreferrer" class="mobile-link">
            GitHub
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
          </a>
        </div>
      </nav>
    `,
    styles: css`
      .site-nav {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 100;
        height: var(--nav-height);
        display: flex;
        flex-direction: column;
        background: rgba(9, 9, 11, 0.8);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-bottom: 1px solid transparent;
        transition: all var(--transition);
      }

      .nav-scrolled {
        border-bottom-color: var(--border-color);
        background: rgba(9, 9, 11, 0.95);
      }

      .nav-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--nav-height);
      }

      .nav-logo {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--text-primary);
        font-weight: 700;
        font-size: 18px;
        text-decoration: none;
      }

      .nav-logo:hover {
        color: var(--text-primary);
      }

      .logo-icon {
        font-size: 22px;
        line-height: 1;
      }

      .nav-links {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .nav-link {
        padding: 8px 16px;
        color: var(--text-secondary);
        font-size: 14px;
        font-weight: 500;
        border-radius: var(--radius-sm);
        transition: all var(--transition-fast);
        text-decoration: none;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .nav-link:hover {
        color: var(--text-primary);
        background: var(--accent-subtle);
      }

      .nav-github {
        margin-left: 8px;
        padding: 8px;
        border-radius: var(--radius-sm);
      }

      .nav-toggle {
        display: none;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 8px;
        border-radius: var(--radius-sm);
      }

      .nav-toggle:hover {
        color: var(--text-primary);
      }

      .mobile-menu {
        display: none;
        flex-direction: column;
        padding: 8px 24px 16px;
        border-top: 1px solid var(--border-color);
        background: rgba(9, 9, 11, 0.98);
      }

      .mobile-link {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 0;
        color: var(--text-secondary);
        font-size: 15px;
        font-weight: 500;
        border-bottom: 1px solid var(--border-subtle);
        text-decoration: none;
      }

      .mobile-link:last-child {
        border-bottom: none;
      }
      .mobile-link:hover {
        color: var(--text-primary);
      }

      @media (max-width: 768px) {
        .nav-links {
          display: none;
        }
        .nav-toggle {
          display: flex;
        }
        .mobile-menu {
          display: flex;
        }
      }
    `,
    onMount: () => {
      window.addEventListener(
        'scroll',
        () => {
          scrolledClass(window.scrollY > 20 ? 'nav-scrolled' : '');
        },
        { passive: true },
      );
    },
  };
});
