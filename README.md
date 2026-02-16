<div align="center">

# ⚡ Thane

### The compile-time component framework

**Zero virtual DOM · Zero runtime diffing · Surgical DOM updates**

[![package version](https://img.shields.io/npm/v/thane?style=flat-square&color=cb3837&label=package)](https://www.npmjs.com/package/thane)
[![license](https://img.shields.io/github/license/timlouw/thane?style=flat-square&color=blue)](https://github.com/timlouw/thane/blob/main/LICENSE)
[![bundle size](https://img.shields.io/badge/runtime-~3KB_gzip-brightgreen?style=flat-square)](https://github.com/timlouw/thane)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/timlouw/thane/ci.yml?style=flat-square&label=tests)](https://github.com/timlouw/thane/actions)

<br />

Thane compiles your declarative components into **optimized vanilla JavaScript** at build time —<br/>
template cloning, direct DOM navigation, and fine-grained signal subscriptions —<br/>
so the browser does the **absolute minimum work** at runtime.

<br />

[Get Started](#-quick-start) · [How It Works](#-how-it-works) · [API](#-core-concepts) · [CLI](#-cli)

</div>

<br />

---

<br />

## ✨ What makes Thane different?

<table>
<tr>
<td width="50%">

#### 💻 What you write

```typescript
export const Counter = defineComponent(() => {
  const count = signal(0);
  const inc = () => count(count() + 1);

  return {
    template: html`
      <button @click=${inc}>
        Clicks: ${count()}
      </button>
    `,
  };
});
```

</td>
<td width="50%">

#### ⚙️ What the compiler generates

```javascript
// Static template (cloned, never re-parsed)
const _t = document.createElement('template');
_t.innerHTML = `<button>Clicks: <!--b0-->0<!----></button>`;

// TreeWalker finds all comment markers in one pass
const _cm = _fcm(root); // { b0: CommentNode }

// Direct DOM binding — subscribe with skip-initial
count.subscribe(v => {
  _cm['b0'].nextSibling.data = v;
}, true);
```

</td>
</tr>
</table>

> **No virtual DOM.** No runtime template compiler. No reconciliation algorithm.<br/>
> The compiler traces every binding at build time and generates the exact DOM operations needed — nothing more.

<br />

## 🧬 Features

<table>
<tr>
<td width="33%" valign="top">

### 🔬 Compile-Time Optimized
HTML templates are pre-compiled into static `<template>` elements with direct DOM path navigation. No runtime parsing ever.

</td>
<td width="33%" valign="top">

### ⚡ Fine-Grained Reactivity
Signal-based subscriptions at the individual binding level. Only the exact text node, attribute, or style that changed is updated.

</td>
<td width="33%" valign="top">

### 🪶 Tiny Runtime
~3 KB min+gzip. Most logic runs at compile time. The runtime is just `signal()`, `defineComponent()`, and a keyed reconciler.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🌐 Light DOM
No Shadow DOM. Components render as regular DOM elements with auto-scoped CSS. Natural cascade, standard devtools.

</td>
<td width="33%" valign="top">

### 📦 Built-in Directives
`when()`, `whenElse()`, `repeat()` with keyed reconciliation, empty-state fallbacks, and full nesting support.

</td>
<td width="33%" valign="top">

### 🛡️ TypeScript-First
Written in TypeScript, ships declarations, full IDE autocompletion. 12 compile-time lint rules catch silent failures.

</td>
</tr>
</table>

<br />

## 📦 Quick Start

```bash
bun add thane
```

```typescript
import { defineComponent, signal, mount } from 'thane';

export const MyCounter = defineComponent(() => {
  const count = signal(0);
  const increment = () => count(count() + 1);

  return {
    template: html`
      <div>
        <button @click=${increment}>Count: ${count()}</button>
      </div>
    `,
    styles: css`
      button { padding: 8px 16px; cursor: pointer; border-radius: 6px; }
      button:hover { background: #f0f0f0; }
    `,
  };
});

// Mount to the page
mount(MyCounter);
```

The compiler auto-derives the component selector from the export name (`MyCounter` → `my-counter`), compiles the template into optimized DOM operations, and scopes the CSS automatically.

<br />

## 🧠 Core Concepts

<details open>
<summary><h3>Signals</h3></summary>

Signals are reactive primitives. Call without args to read, with an arg to write.

```typescript
const name = signal('world');

name();           // → 'world'  (read)
name('Thane');    // → sets to 'Thane'  (write)

// Subscribe to changes
name.subscribe((value) => console.log('changed:', value));
```

Inside templates, signal reads (`${count()}`) are automatically detected by the compiler and wired to surgical DOM updates.

</details>

<details open>
<summary><h3>Components</h3></summary>

Closure-based API — the setup function runs once per instance and returns template, styles, and optional lifecycle hooks.

```typescript
export const Greeting = defineComponent(() => {
  const name = signal('world');

  return {
    template: html`<p>Hello, ${name()}!</p>`,
    onMount: () => console.log('mounted'),
    onDestroy: () => console.log('destroyed'),
  };
});
```

Compose components by importing and calling them inline:

```typescript
import { TodoItem } from './todo-item.js';

// Static props — evaluated once at mount time
${TodoItem({ label: 'Buy groceries', done: false })}

// Reactive props — pass signals by reference (no parentheses)
// The child receives the live signal and stays in sync automatically
${TodoItem({ label: labelSignal, done: doneSignal })}
```

</details>

<details>
<summary><h3>Conditional Rendering</h3></summary>

```typescript
// Show/hide based on signal
<div "${when(isVisible())}">Only shown when truthy</div>

// If/else branches
${whenElse(
  isLoggedIn(),
  html`<p>Welcome back!</p>`,
  html`<p>Please log in.</p>`,
)}
```

</details>

<details>
<summary><h3>Lists with repeat()</h3></summary>

```typescript
${repeat(
  items(),                                // signal array
  (item, index) => html`                  // item template
    <li>${item.name} (#${index})</li>
  `,
  html`<li>No items yet.</li>`,           // empty-state fallback (optional)
  (item) => item.id,                      // trackBy key function (optional)
)}
```

The compiler optimizes `repeat()` into keyed reconciliation with template cloning — items are created via `cloneNode(true)` and updated with direct property assignments, not re-parsed from HTML strings.

</details>

<details>
<summary><h3>Event Handling</h3></summary>

```typescript
<button @click=${handleClick}>Click me</button>
<input @input=${(e) => value(e.target.value)} />
<form @submit.prevent=${handleSubmit}>...</form>
```

Supported modifiers: `.prevent` · `.stop` · `.self` · `.enter` · `.esc` · `.space` · `.tab` · `.up` · `.down` · `.left` · `.right`

</details>

<br />

## 🔧 How It Works

> **Parse** → **Analyze** → **Codegen** → **Inject**
>
> Everything happens at build time. The runtime is just signals + a keyed reconciler.

| Phase | What happens |
|-------|-------------|
| **Parse** | The compiler finds `defineComponent()` calls, extracts `html` and `css` tagged templates via AST analysis. |
| **Analyze** | Bindings (`${signal()}`, `@click`, `when()`, `repeat()`) are identified and mapped to DOM positions. |
| **Codegen** | Each binding becomes a direct DOM operation: `commentNode.nextSibling.data = value`, `el.setAttribute()`, `el.addEventListener()`, `signal.subscribe()`. |
| **Inject** | The compiled initializer and static `<template>` element replace the original tagged template literal. |

**Runtime (~3 KB):** `signal()` · `defineComponent()` · `createKeyedReconciler()` — no virtual DOM, no diffing, no template compiler.

<br />

## 🎨 CSS Scoping

Thane automatically scopes component CSS using class-based isolation — **no Shadow DOM, no `:host` prefix needed.** Just write normal CSS selectors and the runtime wraps them to your component boundary:

```typescript
export const Card = defineComponent(() => ({
  template: html`<div class="card">Hello</div>`,
  styles: css`
    .card { border: 1px solid #ccc; padding: 16px; }
    .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  `,
}));
```

Styles from `.card` won't leak to other components, but parent styles **do** cascade in (natural light DOM behavior). External CSS files work too:

```typescript
import styles from './card.css';
export const Card = defineComponent(() => ({
  template: html`<div class="card">Hello</div>`,
  styles,
}));
```

<br />

## 📊 Repeat Optimization

The compiler automatically selects the optimal rendering strategy for `repeat()`:

| Pattern | Optimization |
|---------|:------------:|
| Single root element | ✅ Template cloning + direct DOM navigation |
| Item variable bindings | ✅ Optimized text, attributes, mixed content |
| Parent signal bindings in items | ✅ Comment-marker + TreeWalker |
| Nested `when()` / `whenElse()` | ✅ Anchor-based conditional |
| Nested `repeat()` | ✅ Recursive keyed reconciler |
| `trackBy` key function | ✅ Keyed identity with DOM reuse |
| Empty-state fallback | ✅ Inline toggle |
| Multiple root elements | ⚠️ Safe string renderer fallback |

<br />

## 🖥️ CLI

```bash
thane dev --entry ./src/main.ts --out ./dist       # Dev server + watch
thane build --prod --entry ./src/main.ts --out ./dist   # Production build
thane serve --prod --entry ./src/main.ts --out ./dist   # Preview production
thane analyze --entry ./src/main.ts --out ./dist   # Bundle analysis
```

Default paths (when flags are omitted):

- `--entry` → `./src/main.ts`
- `--out` → `./dist`
- `--assets` → `./src/assets`
- `--html` → `./index.html`

| Flag | Description |
|------|-------------|
| `--entry` | Entry TypeScript file |
| `--out` | Output directory |
| `--html` | HTML file to inject the bundle into |
| `--config` | Path to config file (`thane.config.json` / `thane.config.jsonc`) |
| `--assets` | Static assets directory to copy |
| `--prod, -p` | Production mode (minification + tree-shaking) |
| `--gzip` | Enable gzip compression (production only) |
| `--app` | Application name (default: `client`) |
| `--compare` | Compare dev and prod builds (analyze only) |
| `--port` | Analyzer server port (default: `4300`) |

### Config file

Thane can be configured with `thane.config.json` (or `.jsonc`) at the project root, or via `--config`:

```bash
thane build --config ./config/thane.config.json
```

Example config:

```json
{
  "entry": "./src/main.ts",
  "outDir": "./dist",
  "assetsDir": "./src/assets",
  "htmlTemplate": "./index.html",
  "prod": false,
  "commands": {
    "build": { "prod": true },
    "analyze": { "compare": true, "analyzerPort": 4300 }
  }
}
```

Precedence is:

1. CLI flags
2. Command-specific config (`commands.build`, `commands.dev`, etc.)
3. Top-level config
4. Built-in defaults

<br />

## 🧪 Testing

All features are validated by **69 end-to-end browser tests** across Chromium, Firefox, and WebKit, plus **95 unit tests** covering signals, reactivity, and lint rules.

```bash
bun run test          # Unit tests
bun run e2e:test      # E2E browser tests (all 3 engines)
```

Bun is the recommended runtime for development and CI.

<br />

## 🌍 Browser Support

Thane targets modern evergreen browsers. The compiled output uses standard DOM APIs with no polyfills required.

| Chrome | Firefox | Safari | Edge |
|:------:|:-------:|:------:|:----:|
| 120+ | 117+ | 17.2+ | 120+ |

<br />

## 📄 License

[MIT](LICENSE) © Tim Louw

<div align="center">
<br />

**Built with ❤️ and compiled at light speed.**

<br />
</div>
