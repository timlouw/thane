import { defineComponent as dc, signal } from 'thane';
import { CodeBlock } from '../components/code-block.js';

// ── Code Examples ──

const INSTALL_CODE = `# Install with your preferred package manager
bun add thane
npm install thane
yarn add thane`;

const QUICK_START = `import { defineComponent, signal, mount } from 'thane';

export const MyCounter = defineComponent(() => {
  const count = signal(0);
  const increment = () => count(count() + 1);

  return {
    template: html\`
      <div>
        <button @click=\${increment}>
          Count: \${count()}
        </button>
      </div>
    \`,
    styles: css\`
      button {
        padding: 8px 16px;
        cursor: pointer;
        border-radius: 6px;
      }
    \`,
  };
});

// Mount to the page
mount(MyCounter);`;

const SIGNAL_CODE = `import { signal } from 'thane';

const name = signal('world');

name();           // → 'world'  (read)
name('Thane');    // → sets to 'Thane'  (write)

// Subscribe to changes
name.subscribe((value) => {
  console.log('changed:', value);
});`;

const COMPUTED_CODE = `import { signal, computed } from 'thane';

const firstName = signal('John');
const lastName = signal('Doe');
const fullName = computed(
  () => \`\${firstName()} \${lastName()}\`
);

fullName(); // → 'John Doe'
firstName('Jane');
fullName(); // → 'Jane Doe'`;

const BATCH_CODE = `import { signal, batch } from 'thane';

const firstName = signal('John');
const lastName = signal('Doe');

// Subscribers fire once with final values, not twice
batch(() => {
  firstName('Jane');
  lastName('Smith');
});`;

const EFFECT_CODE = `import { signal, effect } from 'thane';

const name = signal('world');

const dispose = effect(() => {
  console.log(\`Hello, \${name()}!\`);
});
// Logs: "Hello, world!"

name('Thane');
// Logs: "Hello, Thane!"

dispose(); // Stop the effect`;

const COMPONENT_CODE = `export const Greeting = defineComponent(() => {
  const name = signal('world');

  return {
    template: html\`<p>Hello, \${name()}!</p>\`,
    onMount: () => console.log('mounted'),
    onDestroy: () => console.log('destroyed'),
  };
});`;

const PROPS_CODE = `import { TodoItem } from './todo-item.js';

// Static props — evaluated once at mount time
\${TodoItem({ label: 'Buy groceries', done: false })}

// Reactive props — pass signals by reference
\${TodoItem({ label: labelSignal, done: doneSignal })}`;

const EVENT_CODE = `<button @click=\${handleClick}>Click me</button>
<input @input=\${(e) => value(e.target.value)} />
<form @submit.prevent=\${handleSubmit}>...</form>

<!-- Modifiers: .prevent .stop .self .enter .esc .space
     .tab .up .down .left .right -->
<!-- Combine: @keydown.ctrl.shift.enter=\${fn} -->`;

const WHEN_CODE = `// Show/hide based on signal
<div \${when(isVisible())}>
  Only shown when truthy
</div>

// If/else branches
\${whenElse(
  isLoggedIn(),
  html\`<p>Welcome back!</p>\`,
  html\`<p>Please log in.</p>\`,
)}`;

const REPEAT_CODE = `\${repeat(
  items(),                          // signal array
  (item, index) => html\`
    <li>\${item.name} (#\${index})</li>
  \`,
  html\`<li>No items yet.</li>\`,     // empty fallback
  (item) => item.id,                // trackBy key
)}`;

const CSS_CODE = `export const Card = defineComponent(() => ({
  template: html\`<div class="card">Hello</div>\`,
  styles: css\`
    .card {
      border: 1px solid #ccc;
      padding: 16px;
    }
    .card:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
  \`,
}));

// Styles are auto-scoped — they won't leak
// External CSS files also work:
// import styles from './card.css';`;

const CLI_CODE = `# Development server with hot reload
thane dev --entry ./src/main.ts --out ./dist

# Production build (minified + tree-shaken)
thane build --prod --entry ./src/main.ts --out ./dist

# Preview the production build
thane serve --prod --entry ./src/main.ts --out ./dist`;

const CONFIG_CODE = `{
  "entry": "./src/main.ts",
  "outDir": "./dist",
  "assetsDir": "./src/assets",
  "htmlTemplate": "./index.html",
  "prod": false,
  "commands": {
    "build": { "prod": true }
  }
}`;

// ── Docs Sidebar Sections ──

const SECTIONS = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'installation', label: 'Installation' },
  { id: 'quick-start', label: 'Quick Start' },
  { id: 'signals', label: 'Signals' },
  { id: 'computed', label: 'Computed' },
  { id: 'batching', label: 'Batching' },
  { id: 'effects', label: 'Effects' },
  { id: 'components', label: 'Components' },
  { id: 'props', label: 'Props' },
  { id: 'events', label: 'Event Handling' },
  { id: 'conditionals', label: 'Conditionals' },
  { id: 'lists', label: 'Lists (repeat)' },
  { id: 'css-scoping', label: 'CSS Scoping' },
  { id: 'cli', label: 'CLI Reference' },
  { id: 'config', label: 'Configuration' },
  { id: 'browser-support', label: 'Browser Support' },
];

export const DocsPage = dc('docs-page', ({ root }) => {
  const sidebarOpen = signal(false);
  const toggleSidebar = () => sidebarOpen(!sidebarOpen());
  const closeSidebar = () => sidebarOpen(false);

  return {
    template: html`
      <div class="docs-page">
        <button class="docs-mobile-toggle" @click=${toggleSidebar}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
          Documentation
        </button>

        <aside class="docs-sidebar" ${when(sidebarOpen())}>
          <nav class="sidebar-nav">
            <div class="sidebar-section">
              <span class="sidebar-heading">Getting Started</span>
              <a href="#introduction" class="sidebar-link" @click=${closeSidebar}>Introduction</a>
              <a href="#installation" class="sidebar-link" @click=${closeSidebar}>Installation</a>
              <a href="#quick-start" class="sidebar-link" @click=${closeSidebar}>Quick Start</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Core Concepts</span>
              <a href="#signals" class="sidebar-link" @click=${closeSidebar}>Signals</a>
              <a href="#computed" class="sidebar-link" @click=${closeSidebar}>Computed</a>
              <a href="#batching" class="sidebar-link" @click=${closeSidebar}>Batching</a>
              <a href="#effects" class="sidebar-link" @click=${closeSidebar}>Effects</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Components</span>
              <a href="#components" class="sidebar-link" @click=${closeSidebar}>Components</a>
              <a href="#props" class="sidebar-link" @click=${closeSidebar}>Props</a>
              <a href="#events" class="sidebar-link" @click=${closeSidebar}>Event Handling</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Directives</span>
              <a href="#conditionals" class="sidebar-link" @click=${closeSidebar}>Conditionals</a>
              <a href="#lists" class="sidebar-link" @click=${closeSidebar}>Lists (repeat)</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Styling</span>
              <a href="#css-scoping" class="sidebar-link" @click=${closeSidebar}>CSS Scoping</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Tooling</span>
              <a href="#cli" class="sidebar-link" @click=${closeSidebar}>CLI Reference</a>
              <a href="#config" class="sidebar-link" @click=${closeSidebar}>Configuration</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Other</span>
              <a href="#browser-support" class="sidebar-link" @click=${closeSidebar}>Browser Support</a>
            </div>
          </nav>
        </aside>

        <div class="docs-sidebar-desktop">
          <nav class="sidebar-nav">
            <div class="sidebar-section">
              <span class="sidebar-heading">Getting Started</span>
              <a href="#introduction" class="sidebar-link">Introduction</a>
              <a href="#installation" class="sidebar-link">Installation</a>
              <a href="#quick-start" class="sidebar-link">Quick Start</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Core Concepts</span>
              <a href="#signals" class="sidebar-link">Signals</a>
              <a href="#computed" class="sidebar-link">Computed</a>
              <a href="#batching" class="sidebar-link">Batching</a>
              <a href="#effects" class="sidebar-link">Effects</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Components</span>
              <a href="#components" class="sidebar-link">Components</a>
              <a href="#props" class="sidebar-link">Props</a>
              <a href="#events" class="sidebar-link">Event Handling</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Directives</span>
              <a href="#conditionals" class="sidebar-link">Conditionals</a>
              <a href="#lists" class="sidebar-link">Lists (repeat)</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Styling</span>
              <a href="#css-scoping" class="sidebar-link">CSS Scoping</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Tooling</span>
              <a href="#cli" class="sidebar-link">CLI Reference</a>
              <a href="#config" class="sidebar-link">Configuration</a>
            </div>
            <div class="sidebar-section">
              <span class="sidebar-heading">Other</span>
              <a href="#browser-support" class="sidebar-link">Browser Support</a>
            </div>
          </nav>
        </div>

        <main class="docs-content">
          <!-- Introduction -->
          <section id="introduction" class="doc-section">
            <h1>Introduction</h1>
            <p>Thane is a <strong>compile-time component framework</strong> that compiles your declarative TypeScript components into optimized vanilla JavaScript at build time.</p>
            <p>Unlike virtual DOM frameworks that diff and patch at runtime, Thane traces every binding at compile time and generates the exact DOM operations needed — template cloning, direct DOM navigation, and fine-grained signal subscriptions. The result is <strong>zero runtime overhead</strong>.</p>
            <div class="doc-callout">
              <strong>Key insight:</strong> The browser does the absolute minimum work at runtime because the compiler already determined what needs to happen.
            </div>
          </section>

          <!-- Installation -->
          <section id="installation" class="doc-section">
            <h2>Installation</h2>
            <p>Thane requires <a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a> as the development runtime. Install with your preferred package manager:</p>
            ${CodeBlock({ code: INSTALL_CODE, lang: 'bash' })}
            <p>This gives you both the runtime library and the <code>thane</code> CLI for building and development.</p>
          </section>

          <!-- Quick Start -->
          <section id="quick-start" class="doc-section">
            <h2>Quick Start</h2>
            <p>Here's a complete Thane component — from import to mount:</p>
            ${CodeBlock({ code: QUICK_START, lang: 'typescript' })}
            <p>The compiler auto-derives the component selector from the export name (<code>MyCounter</code> → <code>my-counter</code>), compiles the template into optimized DOM operations, and scopes the CSS automatically.</p>
          </section>

          <!-- Signals -->
          <section id="signals" class="doc-section">
            <h2>Signals</h2>
            <p>Signals are Thane's reactive primitives. Call without args to read, with an arg to write:</p>
            ${CodeBlock({ code: SIGNAL_CODE, lang: 'typescript' })}
            <p>Inside templates, signal reads (<code>\${count()}</code>) are automatically detected by the compiler and wired to surgical DOM updates. Only the exact text node or attribute bound to the signal is updated — nothing else re-renders.</p>
          </section>

          <!-- Computed -->
          <section id="computed" class="doc-section">
            <h2>Computed Signals</h2>
            <p>Derived values that automatically track their signal dependencies and update when any dependency changes:</p>
            ${CodeBlock({ code: COMPUTED_CODE, lang: 'typescript' })}
            <p>Computed signals are read-only. They can be used in templates just like regular signals. They are tree-shakable — if your app never imports <code>computed</code>, the code is eliminated at build time.</p>
          </section>

          <!-- Batching -->
          <section id="batching" class="doc-section">
            <h2>Batching</h2>
            <p>Batch multiple signal updates so subscriber notifications fire only once after the batch completes:</p>
            ${CodeBlock({ code: BATCH_CODE, lang: 'typescript' })}
            <p>Batches can be nested — notifications flush when the outermost batch ends. Useful for updating several related signals without triggering intermediate re-renders.</p>
          </section>

          <!-- Effects -->
          <section id="effects" class="doc-section">
            <h2>Effects</h2>
            <p>Side-effect functions that automatically track which signals they read and re-run when any of those signals change:</p>
            ${CodeBlock({ code: EFFECT_CODE, lang: 'typescript' })}
            <p>Returns a dispose function to stop the effect. Effects are tree-shakable.</p>
          </section>

          <!-- Components -->
          <section id="components" class="doc-section">
            <h2>Components</h2>
            <p>Thane uses a closure-based API. The setup function runs once per instance and returns template, styles, and optional lifecycle hooks:</p>
            ${CodeBlock({ code: COMPONENT_CODE, lang: 'typescript' })}
            <p>Components render as regular DOM elements with class-based CSS scoping. No Shadow DOM, no custom elements registry overhead.</p>
            <div class="doc-callout">
              <strong>Lifecycle hooks:</strong> <code>onMount</code> fires after template is in the DOM. <code>onDestroy</code> fires when the component is removed.
            </div>
          </section>

          <!-- Props -->
          <section id="props" class="doc-section">
            <h2>Props</h2>
            <p>Components accept props as an object. Signals can be passed by reference for reactive props:</p>
            ${CodeBlock({ code: PROPS_CODE, lang: 'typescript' })}
            <p>Static props are evaluated once at mount time. Reactive props (signals passed by reference, without parentheses) keep the child automatically in sync.</p>
          </section>

          <!-- Event Handling -->
          <section id="events" class="doc-section">
            <h2>Event Handling</h2>
            <p>Use the <code>@event</code> syntax to bind event handlers. Modifiers like <code>.prevent</code> and <code>.stop</code> are supported:</p>
            ${CodeBlock({ code: EVENT_CODE, lang: 'html' })}
            <p>Multiple key modifiers can be combined: <code>@keydown.ctrl.shift.enter</code>.</p>
          </section>

          <!-- Conditionals -->
          <section id="conditionals" class="doc-section">
            <h2>Conditional Rendering</h2>
            <p>Use <code>when()</code> for show/hide and <code>whenElse()</code> for branching:</p>
            ${CodeBlock({ code: WHEN_CODE, lang: 'typescript' })}
            <p>When the condition is falsy, the element is replaced with a lightweight <code>&lt;template&gt;</code> placeholder — fully removed from the DOM, not just hidden.</p>
          </section>

          <!-- Lists -->
          <section id="lists" class="doc-section">
            <h2>Lists with repeat()</h2>
            <p>Render arrays with keyed reconciliation, template cloning, and optional empty-state fallbacks:</p>
            ${CodeBlock({ code: REPEAT_CODE, lang: 'typescript' })}
            <p>The compiler automatically selects the optimal rendering strategy — template cloning with direct DOM navigation for single-root elements, and keyed identity with DOM reuse when a <code>trackBy</code> function is provided.</p>
          </section>

          <!-- CSS Scoping -->
          <section id="css-scoping" class="doc-section">
            <h2>CSS Scoping</h2>
            <p>Thane automatically scopes component CSS using class-based isolation — no Shadow DOM needed. Write normal CSS selectors:</p>
            ${CodeBlock({ code: CSS_CODE, lang: 'typescript' })}
            <p>Styles from one component won't leak to others, but parent styles <strong>do</strong> cascade in (natural light DOM behavior).</p>
          </section>

          <!-- CLI -->
          <section id="cli" class="doc-section">
            <h2>CLI Reference</h2>
            <p>The Thane CLI provides dev server, production builds, and preview:</p>
            ${CodeBlock({ code: CLI_CODE, lang: 'bash' })}
            <div class="doc-table-wrap">
              <table class="doc-table">
                <thead>
                  <tr><th>Flag</th><th>Description</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>--entry</code></td><td>Entry TypeScript file (default: <code>./src/main.ts</code>)</td></tr>
                  <tr><td><code>--out</code></td><td>Output directory (default: <code>./dist</code>)</td></tr>
                  <tr><td><code>--html</code></td><td>HTML template file</td></tr>
                  <tr><td><code>--assets</code></td><td>Static assets directory</td></tr>
                  <tr><td><code>--prod, -p</code></td><td>Production mode (minification + tree-shaking)</td></tr>
                  <tr><td><code>--gzip</code></td><td>Enable gzip compression (production only)</td></tr>
                  <tr><td><code>--config</code></td><td>Path to config file</td></tr>
                  <tr><td><code>--verbose, -V</code></td><td>Verbose output</td></tr>
                  <tr><td><code>--quiet, -q</code></td><td>Suppress non-error output</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Config -->
          <section id="config" class="doc-section">
            <h2>Configuration</h2>
            <p>Thane can be configured with <code>thane.config.json</code> (or <code>.jsonc</code>) at the project root:</p>
            ${CodeBlock({ code: CONFIG_CODE, lang: 'json' })}
            <p><strong>Precedence:</strong> CLI flags → Command-specific config → Top-level config → Built-in defaults.</p>
          </section>

          <!-- Browser Support -->
          <section id="browser-support" class="doc-section">
            <h2>Browser Support</h2>
            <p>Thane targets modern evergreen browsers. The compiled output uses standard DOM APIs with no polyfills required.</p>
            <div class="doc-table-wrap">
              <table class="doc-table browser-table">
                <thead>
                  <tr><th>Chrome</th><th>Firefox</th><th>Safari</th><th>Edge</th></tr>
                </thead>
                <tbody>
                  <tr><td>120+</td><td>117+</td><td>17.2+</td><td>120+</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    `,
    styles: css`
      .docs-page {
        display: flex;
        padding-top: var(--nav-height);
        min-height: 100vh;
      }

      /* Sidebar — Desktop */
      .docs-sidebar-desktop {
        position: sticky;
        top: var(--nav-height);
        height: calc(100vh - var(--nav-height));
        width: 260px;
        flex-shrink: 0;
        overflow-y: auto;
        border-right: 1px solid var(--border-color);
        background: var(--bg-secondary);
        padding: 24px 0;
      }

      /* Sidebar — Mobile overlay */
      .docs-sidebar {
        display: none;
        position: fixed;
        top: var(--nav-height);
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 50;
        background: var(--bg-secondary);
        overflow-y: auto;
        padding: 16px 0;
        border-bottom: 1px solid var(--border-color);
      }

      .docs-mobile-toggle {
        display: none;
        position: sticky;
        top: var(--nav-height);
        z-index: 40;
        width: 100%;
        padding: 12px 24px;
        border: none;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        align-items: center;
        gap: 8px;
      }

      .sidebar-nav {
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 0 20px;
      }

      .sidebar-section {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .sidebar-heading {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-muted);
        padding: 4px 12px;
        margin-bottom: 2px;
      }

      .sidebar-link {
        display: block;
        padding: 6px 12px;
        font-size: 13.5px;
        color: var(--text-secondary);
        border-radius: var(--radius-xs);
        text-decoration: none;
        transition: all var(--transition-fast);
      }

      .sidebar-link:hover {
        color: var(--text-primary);
        background: var(--accent-subtle);
      }

      /* Content */
      .docs-content {
        flex: 1;
        min-width: 0;
        max-width: 800px;
        padding: 40px 48px 80px;
      }

      .doc-section {
        padding-bottom: 48px;
        margin-bottom: 48px;
        border-bottom: 1px solid var(--border-subtle);
      }

      .doc-section:last-child {
        border-bottom: none;
        margin-bottom: 0;
      }

      .doc-section h1,
      .doc-section h2 {
        margin-bottom: 16px;
      }

      .doc-section h1 {
        font-size: 2rem;
      }

      .doc-section h2 {
        font-size: 1.5rem;
      }

      .doc-section p {
        margin-bottom: 16px;
        font-size: 15px;
        line-height: 1.75;
      }

      .doc-section p code {
        font-size: 13px;
      }

      .doc-callout {
        padding: 16px 20px;
        background: var(--accent-subtle);
        border: 1px solid rgba(99, 102, 241, 0.2);
        border-radius: var(--radius-md);
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-secondary);
        margin: 16px 0;
      }

      .doc-callout strong {
        color: var(--accent);
      }

      .doc-callout code {
        background: rgba(99, 102, 241, 0.15);
        font-size: 12.5px;
      }

      .doc-table-wrap {
        overflow-x: auto;
        margin: 16px 0;
      }

      .doc-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      .doc-table th,
      .doc-table td {
        padding: 10px 16px;
        text-align: left;
        border-bottom: 1px solid var(--border-color);
      }

      .doc-table th {
        background: var(--bg-secondary);
        font-weight: 600;
        color: var(--text-primary);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .doc-table td {
        color: var(--text-secondary);
      }

      .doc-table td code {
        font-size: 12.5px;
        color: var(--accent);
        background: var(--accent-subtle);
      }

      .browser-table {
        text-align: center;
        max-width: 500px;
      }

      .browser-table th,
      .browser-table td {
        text-align: center;
        font-size: 16px;
      }

      @media (max-width: 768px) {
        .docs-sidebar-desktop {
          display: none;
        }
        .docs-mobile-toggle {
          display: flex;
        }
        .docs-sidebar {
          display: flex;
          flex-direction: column;
        }

        .docs-content {
          padding: 24px 16px 64px;
        }

        .doc-section h1 {
          font-size: 1.75rem;
        }
        .doc-section h2 {
          font-size: 1.3rem;
        }
      }

      @media (min-width: 769px) {
        .docs-sidebar {
          display: none !important;
        }
      }
    `,
  };
});
