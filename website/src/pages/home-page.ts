import { defineComponent as dc } from 'thane';
import { InstallTabs } from '../components/install-tabs.js';
import { FeatureCard } from '../components/feature-card.js';
import { LiveDemo } from '../components/live-demo.js';
import { CodeBlock } from '../components/code-block.js';
import { PlaygroundEditor } from '../components/playground-editor.js';

// ── Code examples for the comparison section ──

const WRITE_CODE = `export const Counter = defineComponent(() => {
  const count = signal(0);
  const inc = () => count(count() + 1);

  return {
    template: html\`
      <button @click=\${inc}>
        Clicks: \${count()}
      </button>
    \`,
  };
});`;

const COMPILED_CODE = `// Static template (cloned, never re-parsed)
const _t = document.createElement('template');
_t.innerHTML = \`<button>Clicks: <!--b0-->0<!----></button>\`;

// TreeWalker finds all comment markers in one pass
const _cm = _fcm(root);  // { b0: CommentNode }

// Direct DOM binding — subscribe with skip-initial
count.subscribe(v => {
  _cm['b0'].nextSibling.data = v;
}, true);

// Event — direct addEventListener, no delegation
_el0.addEventListener('click', inc);`;

const REACTIVE_EXAMPLE = `import { signal, computed, batch } from 'thane';

const firstName = signal('John');
const lastName = signal('Doe');
const fullName = computed(() =>
  \`\${firstName()} \${lastName()}\`
);

fullName(); // → 'John Doe'

// Batch: subscribers fire once, not twice
batch(() => {
  firstName('Jane');
  lastName('Smith');
});

fullName(); // → 'Jane Smith'`;

const REPEAT_EXAMPLE = `\${repeat(
  items(),                     // signal array
  (item, i) => html\`
    <li>\${item.name} (#\${i})</li>
  \`,
  html\`<li>No items yet.</li>\`,  // empty fallback
  (item) => item.id,            // trackBy key
)}`;

const PLAYGROUND_SNIPPET = `const Greeting = defineComponent(() => {
  const name = signal('World');
  const handleInput = (e) => name(e.target.value);

  return {
    template: html\`
      <div class="greeting">
        <input
          type="text"
          placeholder="Enter your name"
          value="\${name()}"
          @input=\${handleInput}
        />
        <h2>Hello, \${name()}!</h2>
      </div>
    \`,
    styles: css\`
      .greeting {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 24px;
      }
      input {
        padding: 10px 16px;
        border: 1px solid #27272a;
        border-radius: 6px;
        background: #18181b;
        color: #fafafa;
        font-size: 15px;
        outline: none;
        width: 240px;
        text-align: center;
        transition: border-color 150ms ease;
      }
      input:focus { border-color: #6366f1; }
      h2 {
        font-size: 1.75rem;
        font-weight: 700;
        background: linear-gradient(135deg, #6366f1, #a78bfa);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    \`,
  };
});

mount(Greeting);`;

export const HomePage = dc('home-page', ({ root }) => ({
  template: html`
    <div class="home-page">
      <!-- Hero Section -->
      <section class="hero section">
        <div class="container hero-inner">
          <a href="https://github.com/timlouw/thane" target="_blank" rel="noopener noreferrer" class="badge hero-badge">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path
                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
              />
            </svg>
            Open Source
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <path d="M7 17L17 7M17 7H7M17 7V17" />
            </svg>
          </a>

          <h1 class="hero-title">
            The compile-time<br />
            <span class="hero-gradient">component framework</span>
          </h1>

          <p class="hero-subtitle">
            Zero virtual DOM &middot; Zero runtime diffing &middot; Surgical DOM updates<br />
            Thane compiles your declarative components into <strong>optimized vanilla JavaScript</strong> at build time.
          </p>

          <div class="hero-install"> ${InstallTabs({})} </div>

          <div class="hero-actions">
            <a href="#/docs" class="btn btn-primary">
              Get Started
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
            <a
              href="https://github.com/timlouw/thane"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-secondary"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
              GitHub
            </a>
          </div>
        </div>
      </section>

      <!-- Stats Bar -->
      <section class="stats-section">
        <div class="container">
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-icon">⚡</span>
              <div class="stat-content">
                <span class="stat-value">~3 KB</span>
                <span class="stat-label">Runtime (gzip)</span>
              </div>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-icon">🔷</span>
              <div class="stat-content">
                <span class="stat-value">TypeScript</span>
                <span class="stat-label">First-class support</span>
              </div>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-icon">📜</span>
              <div class="stat-content">
                <span class="stat-value">MIT</span>
                <span class="stat-label">Licensed</span>
              </div>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <span class="stat-icon">🧪</span>
              <div class="stat-content">
                <span class="stat-value">158+</span>
                <span class="stat-label">Unit tests</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Code Comparison -->
      <section class="section comparison-section">
        <div class="container">
          <div class="section-header">
            <h2>What makes Thane different?</h2>
            <p
              >The compiler traces every binding at build time and generates the exact DOM operations needed — nothing
              more.</p
            >
          </div>
          <div class="comparison-grid">
            <div class="comparison-col">
              <div class="comparison-label">
                <span class="comparison-icon">💻</span>
                What you write
              </div>
              ${CodeBlock({ code: WRITE_CODE, lang: 'typescript' })}
            </div>
            <div class="comparison-col">
              <div class="comparison-label">
                <span class="comparison-icon">⚙️</span>
                What the compiler generates
              </div>
              ${CodeBlock({ code: COMPILED_CODE, lang: 'javascript' })}
            </div>
          </div>
        </div>
      </section>

      <!-- Live Demo -->
      <section class="section">
        <div class="container">
          <div class="section-header">
            <h2>See it in action</h2>
            <p>This counter is a real compiled Thane component running right here. Fully interactive, zero overhead.</p>
          </div>
          ${LiveDemo({})}
        </div>
      </section>

      <!-- Features Grid -->
      <section class="section features-section">
        <div class="container">
          <div class="section-header">
            <h2>Built for performance</h2>
            <p>Every design decision optimizes for the smallest, fastest output possible.</p>
          </div>
          <div class="grid grid-3">
            ${FeatureCard({
              icon: '🔬',
              title: 'Compile-Time Optimized',
              description:
                'HTML templates are pre-compiled into static <template> elements with direct DOM path navigation. No runtime parsing ever.',
            })}
            ${FeatureCard({
              icon: '⚡',
              title: 'Fine-Grained Reactivity',
              description:
                'Signal-based subscriptions at the individual binding level. Only the exact text node, attribute, or style that changed is updated.',
            })}
            ${FeatureCard({
              icon: '🪶',
              title: 'Tiny Runtime',
              description:
                'The entire runtime is ~3KB min+gzip. Most logic runs at compile time. Just signals, a reconciler, and mount.',
            })}
            ${FeatureCard({
              icon: '🌐',
              title: 'Light DOM',
              description:
                'No Shadow DOM. Components render as regular DOM elements with auto-scoped CSS. Natural cascade, standard devtools.',
            })}
            ${FeatureCard({
              icon: '📦',
              title: 'Built-in Directives',
              description:
                'when(), whenElse(), and repeat() with keyed reconciliation, empty-state fallbacks, and full nesting support.',
            })}
            ${FeatureCard({
              icon: '🛡️',
              title: 'TypeScript-First',
              description:
                'Written in TypeScript, ships declarations, full IDE autocompletion. 12 compile-time lint rules catch silent failures.',
            })}
          </div>
        </div>
      </section>

      <!-- Reactive Primitives -->
      <section class="section">
        <div class="container">
          <div class="section-header">
            <h2>Reactive primitives</h2>
            <p>Signals, computed values, batching, and effects — everything you need for fine-grained reactivity.</p>
          </div>
          <div class="primitives-layout">
            <div class="primitives-code"> ${CodeBlock({ code: REACTIVE_EXAMPLE, lang: 'typescript' })} </div>
            <div class="primitives-cards">
              <div class="primitive-card">
                <h4>signal()</h4>
                <p>Reactive value containers. Read with no args, write with an arg. Auto-detected in templates.</p>
              </div>
              <div class="primitive-card">
                <h4>computed()</h4>
                <p>Derived values that auto-track dependencies and update when any dependency changes.</p>
              </div>
              <div class="primitive-card">
                <h4>batch()</h4>
                <p>Batch multiple updates so subscribers fire once after all changes are applied.</p>
              </div>
              <div class="primitive-card">
                <h4>effect()</h4>
                <p>Side-effect functions that auto-track signals and re-run when dependencies change.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Inline Playground Snippet -->
      <section class="section">
        <div class="container">
          <div class="section-header">
            <h2>Try it live</h2>
            <p
              >Edit the code below and see instant results. This embedded playground runs a mini Thane runtime in a
              sandboxed iframe.</p
            >
          </div>
          ${PlaygroundEditor({ initialCode: PLAYGROUND_SNIPPET, compact: 'true' })}
        </div>
      </section>

      <!-- Directives -->
      <section class="section">
        <div class="container">
          <div class="section-header">
            <h2>Powerful directives</h2>
            <p>Conditional rendering and optimized list reconciliation, compiled to minimal DOM operations.</p>
          </div>
          <div class="comparison-grid">
            <div class="comparison-col"> ${CodeBlock({ code: REPEAT_EXAMPLE, lang: 'typescript' })} </div>
            <div class="comparison-col directives-info">
              <div class="directive-item">
                <code>when()</code>
                <p
                  >Show/hide elements based on a reactive condition. The element is removed from the DOM when hidden.</p
                >
              </div>
              <div class="directive-item">
                <code>whenElse()</code>
                <p>Two-branch conditional rendering — swap between templates based on a signal.</p>
              </div>
              <div class="directive-item">
                <code>repeat()</code>
                <p>Keyed reconciliation with template cloning, empty-state fallback, and full nesting support.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- FAQ -->
      <section class="section faq-section">
        <div class="container">
          <div class="section-header">
            <h2>Frequently asked questions</h2>
          </div>
          <div class="faq-list">
            <details>
              <summary>What is Thane?</summary>
              <div>
                <p
                  >Thane is a compile-time component framework for building web applications. It compiles your
                  declarative TypeScript components into optimized vanilla JavaScript at build time — template cloning,
                  direct DOM navigation, and fine-grained signal subscriptions — so the browser does the absolute
                  minimum work at runtime.</p
                >
              </div>
            </details>
            <details>
              <summary>How does compile-time compilation work?</summary>
              <div>
                <p
                  >The Thane compiler finds defineComponent() calls, extracts html and css tagged templates via AST
                  analysis, identifies all bindings, and generates the exact DOM operations needed. Each signal read
                  becomes a direct subscription to update a specific text node, attribute, or style. No virtual DOM, no
                  diffing.</p
                >
              </div>
            </details>
            <details>
              <summary>Do I need a build step?</summary>
              <div>
                <p
                  >Yes. Thane's power comes from compile-time optimization. The CLI provides dev (with hot reload),
                  build, and serve commands. Under the hood it uses esbuild for fast bundling.</p
                >
              </div>
            </details>
            <details>
              <summary>How small is the runtime?</summary>
              <div>
                <p
                  >The runtime is approximately 3KB min+gzip. It includes signal(), computed(), effect(), batch(),
                  defineComponent(), and a keyed reconciler. Most of the logic runs at compile time, not in the
                  browser.</p
                >
              </div>
            </details>
            <details>
              <summary>Can I use Thane with existing projects?</summary>
              <div>
                <p
                  >Thane is designed as a standalone framework with its own build pipeline. You can gradually adopt it
                  by mounting Thane components into specific sections of an existing page.</p
                >
              </div>
            </details>
            <details>
              <summary>What browsers are supported?</summary>
              <div>
                <p
                  >Thane targets modern evergreen browsers: Chrome 120+, Firefox 117+, Safari 17.2+, and Edge 120+. The
                  compiled output uses standard DOM APIs with no polyfills required.</p
                >
              </div>
            </details>
            <details>
              <summary>Is Thane production ready?</summary>
              <div>
                <p
                  >Thane is currently pre-1.0 and under active development. It has 158+ unit tests and comprehensive
                  end-to-end browser tests across Chromium, Firefox, and WebKit. Check the releases page for the latest
                  version.</p
                >
              </div>
            </details>
          </div>
        </div>
      </section>

      <!-- CTA -->
      <section class="section cta-section">
        <div class="container">
          <div class="cta-inner">
            <h2>Ready to build at light speed?</h2>
            <p>Get started with Thane in seconds. Zero config, instant dev server, production-optimized builds.</p>
            <div class="cta-actions">
              <a href="#/docs" class="btn btn-primary">
                Read the docs
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
              <a href="#/playground" class="btn btn-secondary">Open playground</a>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: css`
    .home-page {
      padding-top: var(--nav-height);
    }

    /* Hero */
    .hero {
      padding: 80px 0 48px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .hero::before {
      content: '';
      position: absolute;
      top: -200px;
      left: 50%;
      transform: translateX(-50%);
      width: 800px;
      height: 600px;
      background: radial-gradient(ellipse, var(--accent-glow) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }

    .hero-inner {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }

    .hero-badge {
      text-decoration: none;
      color: var(--text-secondary);
      transition: all var(--transition);
    }

    .hero-badge:hover {
      color: var(--text-primary);
      border-color: var(--text-muted);
      background: var(--bg-surface);
    }

    .hero-title {
      max-width: 800px;
      line-height: 1.1;
    }

    .hero-gradient {
      background: linear-gradient(135deg, #6366f1 0%, #a78bfa 50%, #6366f1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-subtitle {
      font-size: clamp(1rem, 2vw, 1.2rem);
      max-width: 640px;
      line-height: 1.7;
    }

    .hero-install {
      margin-top: 8px;
    }

    .hero-actions {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      flex-wrap: wrap;
      justify-content: center;
    }

    /* Stats */
    .stats-section {
      padding: 40px 0;
      border-top: 1px solid var(--border-color);
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .stats-grid {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 40px;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .stat-icon {
      font-size: 24px;
      line-height: 1;
    }

    .stat-content {
      display: flex;
      flex-direction: column;
    }

    .stat-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .stat-label {
      font-size: 13px;
      color: var(--text-muted);
    }

    .stat-divider {
      width: 1px;
      height: 32px;
      background: var(--border-color);
    }

    /* Comparison */
    .comparison-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      align-items: start;
    }

    .comparison-label {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      font-weight: 600;
      font-size: 15px;
      color: var(--text-primary);
    }

    .comparison-icon {
      font-size: 20px;
    }

    /* Primitives */
    .primitives-layout {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 32px;
      align-items: start;
    }

    .primitives-cards {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .primitive-card {
      padding: 20px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
    }

    .primitive-card h4 {
      font-family: var(--font-mono);
      color: var(--accent);
      font-size: 15px;
      margin-bottom: 6px;
    }

    .primitive-card p {
      font-size: 13.5px;
      line-height: 1.5;
    }

    /* Directives */
    .directives-info {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .directive-item {
      padding: 16px 20px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
    }

    .directive-item code {
      color: var(--accent);
      font-size: 15px;
      font-weight: 600;
      background: var(--accent-subtle);
      padding: 2px 8px;
      border-radius: var(--radius-xs);
    }

    .directive-item p {
      margin-top: 8px;
      font-size: 13.5px;
      line-height: 1.5;
    }

    /* FAQ */
    .faq-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 800px;
      margin: 0 auto;
    }

    /* CTA */
    .cta-section {
      border-top: 1px solid var(--border-color);
    }

    .cta-inner {
      text-align: center;
      padding: 48px 32px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-xl);
      position: relative;
      overflow: hidden;
    }

    .cta-inner::before {
      content: '';
      position: absolute;
      top: -100px;
      left: 50%;
      transform: translateX(-50%);
      width: 500px;
      height: 300px;
      background: radial-gradient(ellipse, var(--accent-glow) 0%, transparent 70%);
      pointer-events: none;
    }

    .cta-inner h2 {
      position: relative;
      margin-bottom: 12px;
    }
    .cta-inner p {
      position: relative;
      margin-bottom: 24px;
      font-size: 1.05rem;
    }

    .cta-actions {
      position: relative;
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .hero {
        padding: 56px 0 32px;
      }

      .stats-grid {
        flex-wrap: wrap;
        gap: 24px;
      }
      .stat-divider {
        display: none;
      }

      .comparison-grid {
        grid-template-columns: 1fr;
      }

      .primitives-layout {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 480px) {
      .stats-grid {
        flex-direction: column;
        gap: 20px;
      }
    }
  `,
}));
