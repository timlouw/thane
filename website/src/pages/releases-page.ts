import { defineComponent } from 'thane';

/**
 * ReleasesPage — Release notes with links to GitHub.
 */

export const ReleasesPage = defineComponent('releases-page', () => ({
  template: html`
    <div class="releases-page">
      <div class="container">
        <div class="releases-header">
          <h1>Releases</h1>
          <p>Track Thane's development progress. All releases are published on GitHub and npm.</p>
          <div class="releases-links">
            <a
              href="https://github.com/timlouw/thane/releases"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-secondary"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
              All GitHub Releases
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </a>
            <a
              href="https://www.npmjs.com/package/thane"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-secondary"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path
                  d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"
                />
              </svg>
              View on npm
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </a>
          </div>
        </div>

        <div class="releases-timeline">
          <!-- v0.0.101 -->
          <article class="release-card">
            <div class="release-tag">
              <span class="release-version">v0.0.101</span>
              <span class="release-badge latest-badge">Latest</span>
            </div>
            <time class="release-date">February 2026</time>
            <h3 class="release-title">Hardening &amp; Reactive Primitives</h3>
            <ul class="release-changes">
              <li class="change-added">Added <code>computed()</code> — derived signals with auto-tracking</li>
              <li class="change-added"
                >Added <code>batch()</code> — deferred subscriber notifications with nested support</li
              >
              <li class="change-added">Added <code>effect()</code> — auto-tracking side effects with dispose</li>
              <li class="change-added">Added <code>--verbose</code> / <code>--quiet</code> CLI flags</li>
              <li class="change-added">Added comprehensive CLI unit tests</li>
              <li class="change-added">Added VS Code extension with HTML/CSS autocomplete in tagged templates</li>
              <li class="change-fixed">Fixed dev server path traversal vulnerability</li>
              <li class="change-fixed">Fixed signal subscriber error resilience (try/catch per subscriber)</li>
              <li class="change-fixed">Fixed async type checking (no longer blocks build)</li>
              <li class="change-fixed">Fixed key guard logic for multi-key event modifiers</li>
              <li class="change-improved">Replaced sync Brotli with async compression</li>
              <li class="change-improved">Added LRU eviction to source cache (configurable max size)</li>
              <li class="change-improved">ANSI colors now respect <code>NO_COLOR</code> and non-TTY environments</li>
              <li class="change-improved">Eliminated <code>as any</code> casts from component.ts</li>
            </ul>
            <a
              href="https://github.com/timlouw/thane/releases/tag/v0.0.101"
              target="_blank"
              rel="noopener noreferrer"
              class="release-link"
            >
              View on GitHub
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </a>
          </article>

          <!-- v0.0.66 -->
          <article class="release-card">
            <div class="release-tag">
              <span class="release-version">v0.0.66</span>
            </div>
            <time class="release-date">January 2026</time>
            <h3 class="release-title">Initial Public Release</h3>
            <ul class="release-changes">
              <li class="change-added"
                >Core runtime: <code>signal()</code>, <code>defineComponent()</code>, <code>mount()</code></li
              >
              <li class="change-added">Compile-time template optimization with static template cloning</li>
              <li class="change-added">Fine-grained signal subscriptions at the binding level</li>
              <li class="change-added"
                >Built-in directives: <code>when()</code>, <code>whenElse()</code>, <code>repeat()</code></li
              >
              <li class="change-added">CSS auto-scoping via class-based isolation</li>
              <li class="change-added">Keyed reconciliation for <code>repeat()</code> with DOM reuse</li>
              <li class="change-added">CLI with dev server, production builds, and preview</li>
              <li class="change-added">TypeScript-first with full type declarations</li>
              <li class="change-added">12 compile-time lint rules</li>
              <li class="change-added">E2E test suite across Chromium, Firefox, and WebKit</li>
            </ul>
            <a
              href="https://github.com/timlouw/thane/releases"
              target="_blank"
              rel="noopener noreferrer"
              class="release-link"
            >
              View on GitHub
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </a>
          </article>
        </div>

        <div class="releases-cta">
          <p>Want to stay up to date? Star the repo on GitHub to get notified of new releases.</p>
          <a href="https://github.com/timlouw/thane" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path
                d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"
              />
            </svg>
            Star on GitHub
          </a>
        </div>
      </div>
    </div>
  `,
  styles: css`
    .releases-page {
      padding: calc(var(--nav-height) + 40px) 0 80px;
    }

    .releases-header {
      margin-bottom: 48px;
    }

    .releases-header h1 {
      font-size: 2.5rem;
      margin-bottom: 12px;
    }

    .releases-header p {
      font-size: 1.05rem;
      max-width: 560px;
      margin-bottom: 24px;
    }

    .releases-links {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    /* Timeline */
    .releases-timeline {
      display: flex;
      flex-direction: column;
      gap: 24px;
      margin-bottom: 48px;
    }

    .release-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 32px;
      transition: all var(--transition);
    }

    .release-card:hover {
      border-color: var(--text-muted);
    }

    .release-tag {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }

    .release-version {
      font-family: var(--font-mono);
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .release-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 100px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .latest-badge {
      background: var(--accent-subtle);
      color: var(--accent);
      border: 1px solid rgba(99, 102, 241, 0.3);
    }

    .release-date {
      display: block;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .release-title {
      font-size: 1.25rem;
      margin-bottom: 16px;
      color: var(--text-primary);
    }

    .release-changes {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 20px;
    }

    .release-changes li {
      font-size: 14px;
      color: var(--text-secondary);
      padding-left: 24px;
      position: relative;
      line-height: 1.5;
    }

    .release-changes li::before {
      position: absolute;
      left: 0;
      top: 0;
      font-size: 14px;
    }

    .change-added::before {
      content: '✅';
    }
    .change-fixed::before {
      content: '🔧';
    }
    .change-improved::before {
      content: '⚡';
    }

    .release-changes code {
      font-size: 12.5px;
      color: var(--accent);
      background: var(--accent-subtle);
    }

    .release-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 500;
      color: var(--accent);
      text-decoration: none;
    }

    .release-link:hover {
      color: var(--accent-hover);
    }

    /* CTA */
    .releases-cta {
      text-align: center;
      padding: 40px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
    }

    .releases-cta p {
      margin-bottom: 20px;
      font-size: 15px;
    }

    @media (max-width: 640px) {
      .release-card {
        padding: 20px;
      }
      .releases-header h1 {
        font-size: 2rem;
      }
    }
  `,
}));
