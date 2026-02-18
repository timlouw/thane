import { defineComponent } from 'thane';

export const SiteFooter = defineComponent('site-footer', () => ({
  template: html`
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <a href="#/" class="footer-logo">
              <span class="logo-icon">⚡</span>
              <span>Thane</span>
            </a>
            <p class="footer-tagline">The compile-time component framework</p>
            <p class="footer-copy">&copy; ${new Date().getFullYear()} Tim Louw &middot; MIT License</p>
          </div>

          <div class="footer-col">
            <h4 class="footer-heading">Resources</h4>
            <a href="#/docs" class="footer-link">Documentation</a>
            <a href="#/playground" class="footer-link">Playground</a>
            <a href="#/releases" class="footer-link">Releases</a>
          </div>

          <div class="footer-col">
            <h4 class="footer-heading">Community</h4>
            <a href="https://github.com/timlouw/thane" target="_blank" rel="noopener noreferrer" class="footer-link">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
              GitHub
            </a>
            <a href="https://www.npmjs.com/package/thane" target="_blank" rel="noopener noreferrer" class="footer-link">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path
                  d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"
                />
              </svg>
              npm
            </a>
            <a
              href="https://github.com/timlouw/thane/issues"
              target="_blank"
              rel="noopener noreferrer"
              class="footer-link"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Issues
            </a>
          </div>

          <div class="footer-col">
            <h4 class="footer-heading">Legal</h4>
            <a
              href="https://github.com/timlouw/thane/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              class="footer-link"
              >MIT License</a
            >
            <a href="https://github.com/timlouw/thane" target="_blank" rel="noopener noreferrer" class="footer-link"
              >Source Code</a
            >
          </div>
        </div>

        <hr class="divider footer-divider" />

        <div class="footer-bottom">
          <p>Built with <span class="heart">&hearts;</span> using Thane</p>
          <div class="footer-badges">
            <a
              href="https://www.npmjs.com/package/thane"
              target="_blank"
              rel="noopener noreferrer"
              class="footer-badge-link"
            >
              <img
                src="https://img.shields.io/npm/v/thane?style=flat-square&color=cb3837&label=npm"
                alt="npm version"
                width="80"
                height="20"
                loading="lazy"
              />
            </a>
            <a
              href="https://github.com/timlouw/thane"
              target="_blank"
              rel="noopener noreferrer"
              class="footer-badge-link"
            >
              <img
                src="https://img.shields.io/github/license/timlouw/thane?style=flat-square&color=blue"
                alt="license"
                width="80"
                height="20"
                loading="lazy"
              />
            </a>
          </div>
        </div>
      </div>
    </footer>
  `,
  styles: css`
    .site-footer {
      border-top: 1px solid var(--border-color);
      background: var(--bg-secondary);
      padding: 64px 0 32px;
    }

    .footer-grid {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr;
      gap: 48px;
    }

    .footer-brand {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .footer-logo {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-primary);
      font-weight: 700;
      font-size: 18px;
      text-decoration: none;
    }

    .footer-logo:hover {
      color: var(--text-primary);
    }

    .logo-icon {
      font-size: 20px;
    }
    .footer-tagline {
      color: var(--text-muted);
      font-size: 14px;
    }
    .footer-copy {
      color: var(--text-muted);
      font-size: 13px;
      margin-top: 8px;
    }

    .footer-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .footer-heading {
      color: var(--text-primary);
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }

    .footer-link {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 14px;
      text-decoration: none;
      transition: color var(--transition-fast);
    }

    .footer-link:hover {
      color: var(--text-primary);
    }

    .footer-divider {
      margin: 40px 0 24px;
    }

    .footer-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .footer-bottom p {
      font-size: 13px;
      color: var(--text-muted);
    }

    .heart {
      color: var(--error);
    }

    .footer-badges {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .footer-badge-link {
      display: flex;
      opacity: 0.7;
      transition: opacity var(--transition);
    }

    .footer-badge-link:hover {
      opacity: 1;
    }

    @media (max-width: 768px) {
      .footer-grid {
        grid-template-columns: 1fr 1fr;
        gap: 40px;
      }
      .footer-brand {
        grid-column: 1 / -1;
      }
      .footer-bottom {
        flex-direction: column;
        gap: 16px;
        text-align: center;
      }
    }

    @media (max-width: 480px) {
      .footer-grid {
        grid-template-columns: 1fr;
        gap: 32px;
      }
    }
  `,
}));
