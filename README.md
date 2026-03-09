<div align="center">

# ⚡ Thane

### The compile-time component framework

**Zero virtual DOM · Zero runtime diffing · Surgical DOM updates**

[![package version](https://img.shields.io/npm/v/thane?style=flat-square&color=cb3837&label=package)](https://www.npmjs.com/package/thane)
[![license](https://img.shields.io/github/license/timlouw/thane?style=flat-square&color=blue)](https://github.com/timlouw/thane/blob/master/LICENSE)
[![bundle size](https://img.shields.io/badge/runtime-~3KB_gzip-brightgreen?style=flat-square)](https://github.com/timlouw/thane)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CI](https://img.shields.io/github/actions/workflow/status/timlouw/thane/ci.yml?style=flat-square&label=tests)](https://github.com/timlouw/thane/actions)

<br />

Thane compiles your declarative components into **optimized vanilla JavaScript** at build time —<br/>
template cloning, direct DOM navigation, and fine-grained signal subscriptions —<br/>
so the browser does the **absolute minimum work** at runtime.

<br />

[Quick Start](#-quick-start) · [Developer Docs](documentation/README.md) · [Contributing](contributing/README.md)

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
HTML templates become static `<template>` elements with direct DOM path navigation. Zero runtime parsing.

</td>
<td width="33%" valign="top">

### ⚡ Fine-Grained Reactivity
Signal subscriptions at individual binding level. Only the exact text node, attribute, or style that changed gets updated.

</td>
<td width="33%" valign="top">

### 🪶 ~3 KB Runtime
Most logic runs at compile time. The runtime is just signals, components, and a keyed reconciler.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🌐 Light DOM
No Shadow DOM. Components render as regular DOM elements with auto-scoped CSS via CSS Nesting.

</td>
<td width="33%" valign="top">

### 📦 Built-in Directives
`when()`, `whenElse()`, `repeat()` with keyed reconciliation, empty-state fallbacks, and full nesting support.

</td>
<td width="33%" valign="top">

### 🛡️ TypeScript-First
Full IDE autocompletion, type-safe routing, and 12 compile-time lint rules that catch silent failures.

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

  return {
    template: html`
      <button @click=${() => count(count() + 1)}>
        Count: ${count()}
      </button>
    `,
  };
});

mount({ component: MyCounter });
```

The compiler auto-derives the selector from the export name (`MyCounter` → `my-counter`), compiles the template to optimized DOM operations, and scopes CSS — all at build time.

**→ [Full Getting Started Guide](documentation/getting-started.md)**

<br />

## 🌍 Browser Support

| Chrome | Firefox | Safari | Edge |
|:------:|:-------:|:------:|:----:|
| 120+   | 117+    | 17.2+  | 120+ |

<br />

## 📖 Learn More

<table>
<tr>
<td width="33%" align="center">

### [Developer Docs](documentation/README.md)

Complete framework reference — signals, components, templates, directives, routing, styling, CLI, and more.

</td>
<td width="33%" align="center">

### [Contributing](contributing/README.md)

Set up the dev environment, run tests, understand the architecture, and submit PRs.

</td>
<td width="33%" align="center">

### [License](LICENSE)

MIT © Tim Louw

</td>
</tr>
</table>

<br />

<div align="center">

**Built with ❤️ and compiled at light speed.**

</div>
