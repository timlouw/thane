# Thane — Feature Evaluation & Roadmap

## Current Architecture Summary

Thane is a compile-time optimized web framework built on esbuild. Components are defined with `defineComponent()`, reactivity is driven by callable signal functions (`signal()` to get, `signal(value)` to set), and the compiler transforms `html` tagged templates into static `<template>` elements with generated binding code. There is no Shadow DOM — components render as regular DOM elements with scoped styles.

**Runtime:** ~1,200 lines — signal, component, dom-binding
**Compiler:** ~5,000+ lines — esbuild plugin pipeline (reactive bindings, CTFE, routes, linter, minification, HTML parser)
**Tests:** ~40 signal tests (single-component scope only)

---

## Feature Evaluation

### 1. Tests for fine-grained reactivity across nested components

**Status: ❌ Not done**

The current `signal.test.ts` has ~40 tests but they are all single-signal, single-component-scope — subscribe/unsubscribe, array operations, performance, etc. There are zero tests for cross-component reactivity or nested component trees. The benchmark app is a single flat component with no nesting.

**Verdict: Good idea, but blocked.** The runtime currently has no real runtime props mechanism (see #2). Until signals can be passed across component boundaries, there's nothing to test. Once props work reactively, this becomes critical.

**Priority: 🟡 P2** — depends on #2 and #10.

---

### 2. Typed reactive props + signals across component boundaries

**Status: ❌ Not done — significant gap**

Current reality:
- `ctx.props` in `component.ts` is typed as `Readonly<P>` but is **always initialized as an empty object `{}`** — never populated at runtime.
- The only "props" that work today are **CTFE (compile-time function evaluation)** in the component precompiler. It evaluates props at build time and serializes them as HTML attributes (`key="value"`). This only supports strings/numbers/booleans — no objects, no arrays, no signals.
- `createComponentHTMLSelector()` stringifies props with `JSON.stringify` into HTML attributes, confirming they're static-only.
- The DX-IMPROVEMENT-PLAN explicitly acknowledged this: *"Cross-component reactivity and a proper ctx.props system are tracked separately as a future workstream."*

**Verdict: Essential for the framework to be usable.** Passing a signal as a prop should "just work" — the child subscribes to it, and reactivity flows naturally. The challenge is the current CTFE + HTML-attribute serialization path can't carry function objects (signals). This is what #10 (global props map) aims to solve.

**Priority: 🔴 P0** — depends on #10.

---

### 3. Compiler error rules for HTML directives with file/line numbers

**Status: ⚠️ Infrastructure exists, rules don't**

What exists:
- The `errors.ts` system has error codes including `THANE005 — INVALID_DIRECTIVE`, with `SourceLocation` (file, line, column) support.
- The `thane-linter` plugin infrastructure is solid — runs on every `.ts` file, supports custom rules, has severity levels.
- The HTML parser in `parser-core.ts` tracks line/column positions for all elements.
- BUT: There are only **2 lint rules** today (`THANE400` no default export, `THANE401` property order), and **neither validates directive usage in HTML templates**.

What's missing — potential rules to add:
- `when()` receives a boolean/signal expression
- `repeat()` has the right argument count/types
- `whenElse()` has both branches present
- Directives aren't nested illegally
- Event handler syntax (`@click`) is correct
- `trackBy` returns string/number
- Signal calls in templates match declared signals
- Component calls in templates reference known components

**Verdict: Great idea, and the infrastructure is already there.** The linter plugin + error code system + HTML parser with positions = everything needed. It's just a matter of writing the rules.

**Priority: 🟠 P1** — no blockers.

---

### 4. Routes as components with router params as typed props

**Status: ❌ Not done**

Current reality:
- The routes precompiler only processes files under a `router/` directory matching `routes.ts$`.
- It extracts selectors from lazy-import pages and injects a `selector` property into route objects.
- `getRouteParam(paramName)` exists as a global runtime function, but it returns a raw `string` — no typing, no integration with component props.
- There's no mechanism for the router to pass params as props to the mounted component.

**Verdict: Good idea.** Having routes be components where router params are automatically typed props (e.g., `defineComponent<{ id: string }>((ctx) => { ... })`) is a clean pattern. It aligns with #2 — once props work, router params become a special case of props.

**Priority: 🟠 P1** — depends on #2 and #9.

---

### 5. `render()` never async — force loading states

**Status: ✅ Already the case**

Current reality:
- The `setup` function in `defineComponent` is synchronous. It returns `ComponentReturnType` — not a `Promise<ComponentReturnType>`.
- There is no `async` anywhere in `component.ts` for the component creation flow.
- The template is a static string evaluated at setup time (actually at compile time via CTFE), so it can never await anything.
- `when()`/`whenElse()` already provide the mechanism for "loading → loaded" UI transitions.

What's missing:
- No explicit pattern or documentation for async data loading (e.g., fetch on mount, update signal, `when()` reveals content).
- No `Suspense`-like boundary or `setImmediate`-style deferred resolution.

**Verdict: Already enforced by architecture.** The current design naturally forces sync rendering + signal updates later. A few options to strengthen this:

1. **Documentation only** — Document the pattern: fetch in `onMount`, signal updates trigger `when()` reveals. Cheapest, most practical.
2. **`defer()` utility** — A small helper that wraps a `Promise` into a signal: `const data = defer(fetchItems())` → starts as `undefined`, becomes the resolved value. Sugar on top of the existing model.
3. **Next.js-inspired `setImmediate` pattern** — Would require the compiler to detect async code inside `onMount` and defer it. Adds complexity for marginal gain since the render is already sync.

**Priority: 🟢 P3** — document the existing pattern

---

### 6. Lit-style signal syntax (`test = ''` instead of `test('')`)

**Status: ❌ Not done**

Current reality:
- Signals are callable function objects: `signal()` to get, `signal(value)` to set.
- The compiler transforms `this._signalName()` patterns in templates.
- The entire reactive binding compiler (template-processing, codegen) relies on the function-call pattern for detection.

**Verdict: ❌ Not recommended for Thane.** Here's why:

- **Proxy approach** — Wrapping signals in a Proxy to intercept `=` assignment adds runtime cost on every read/write. This directly contradicts Thane's zero-overhead signal design where signals are bare function objects with properties.
- **Compiler transform** — Rewriting `x = val` → `x(val)` is extremely fragile. How does the compiler distinguish signal assignment from regular variable assignment? It would need full type information at every usage site.
- **Decorators + classes** — This is how Lit does it (property setters + `@property` decorators). But Thane moved away from classes to the function-based `defineComponent` API specifically to avoid this complexity.

The function-call syntax `count(count() + 1)` is the price of the zero-overhead signal design. It's explicit and unambiguous for both humans and the compiler.

**Priority: ⛔ Skip.**

---

### 7. HTML syntax highlighting in `html` tagged templates

**Status: ❌ Not done**

There's no TextMate grammar, VS Code extension, or language server in the workspace. The `html` and `css` tagged templates are raw strings with no editor support.

**Verdict: Good idea, but it's a VS Code extension project, not a framework feature.** You'd need a VS Code extension that registers a TextMate grammar for `` html`...` `` and `` css`...` `` embedded languages.

**Quick win:** The existing [`bierner.lit-html`](https://marketplace.visualstudio.com/items?itemName=bierner.lit-html) extension should work out of the box since Thane uses the same `html` tag name as Lit. Worth testing before building a custom one.

If a custom extension is needed later, it could also provide:
- Autocomplete for Thane directives (`when()`, `repeat()`, `@event`)
- Go-to-definition for component references in templates
- Inline error display from Thane linter rules

**Priority: 🟢 P3** — try `bierner.lit-html` first, build custom later if needed.

---

### 8. Watch mode watches `index.html`

**Status: ❌ Not done**

Current reality in `build.ts`:
```typescript
const ctx = await context(buildConfig);
await ctx.watch({});
```
This uses esbuild's built-in watch, which only watches the **dependency graph** (`.ts`, `.css` files imported by the entry point). The `index.html` file is not part of esbuild's module graph — it's processed by `PostBuildPlugin` as a separate file copy step.

**Verdict: Good idea, straightforward to implement.** Options:
- Use `fs.watch()` or `chokidar` on `index.html` alongside esbuild's watch, trigger a rebuild on change.
- Or use esbuild's `onResolve`/`onLoad` to pull `index.html` into the dependency graph so it's auto-watched.

Small but impactful DX improvement.

**Priority: 🟡 P2** — no blockers, quick win.

---

### 9. Framework without router + flexible router outlet placement

**Status: ⚠️ Partially done**

Current reality:
- `mount(Component)` works without a router — the benchmark app proves this (`mount(Benchmark)` with no routing).
- The `navigate`, `navigateBack`, `getRouteParam` are declared as globals but their implementations aren't in the core runtime source files — they appear to be provided by user-land router code or a separate module.
- The routes precompiler plugin is hardcoded to look for files under a `router/` directory.

Sub-items:

| Sub-item | Status |
|----------|--------|
| Main component without router | ✅ Works (`mount(Component)`) |
| Router placed anywhere (not just top-level) | ❓ Can't confirm — router runtime code not in core |
| Both together (main comp + router) | ❓ Depends on router implementation |
| Nested/sub-routers | ❌ Not implemented — routes precompiler doesn't support nesting |
| Login → authenticated sub-router pattern | ❌ Not implemented |

**Verdict: Good idea, and the architecture supports it.** The `mount()` API already works standalone. The missing piece is making the router a composable component rather than a top-level concern. Nested routers (login screen → app shell → nested routes) is a common, valuable pattern.

**Implementation direction:**
- Router outlet as a component that can be placed anywhere in any template
- Router config supports children routes for nesting
- Main `mount()` remains independent of routing
- A component can contain a router outlet, enabling patterns like: top-level login route → app shell component with sidebar + nested router outlet

**Priority: 🟠 P1** — no blockers for the basic restructuring.

---

### 10. Global props map — pass keys instead of serialized values

**Status: ❌ Not done — this is the right solution for #2**

Current reality:
- Props are serialized as HTML attributes in `createComponentHTMLSelector()`: `<div data-thane-component="selector" key="value"></div>`.
- This fundamentally cannot carry objects, arrays, functions, or signals.

**Verdict: Excellent idea — this solves the props problem at its root.**

A global `Map<string, Record<string, any>>` keyed by component instance ID would:
1. Eliminate HTML attribute serialization entirely
2. Allow passing signals, objects, functions — anything
3. Enable cross-component reactivity (pass a signal as a prop, child subscribes)
4. Work at both compile-time (CTFE generates the ID) and runtime

**Proposed flow:**
- Parent: `MyChild({ items: this._items })` → compiler generates a unique ID, stores props in the global map, renders `<div data-thane-component="my-child" data-thane-pid="abc123"></div>`
- Child: on instantiation, runtime reads `data-thane-pid`, looks up props from the global map, populates `ctx.props`
- Cleanup: When child is destroyed, its entry is removed from the map

This avoids all serialization issues and makes signal-passing "just work" — the signal function reference is stored directly in the map, not stringified.

**Priority: 🔴 P0** — foundational for #2, #1, and #4.

---

## Summary Priority Matrix

| # | Idea | Status | Recommended? | Priority | Depends On |
|---|------|--------|--------------|----------|------------|
| 10 | Global props map | ❌ | ✅ Essential | 🔴 P0 | — |
| 2 | Typed reactive props + signals across boundaries | ❌ | ✅ Essential | 🔴 P0 | #10 |
| 9 | Framework without/with router, flexible outlet | ⚠️ Partial | ✅ Yes | 🟠 P1 | — |
| 3 | Directive validation rules in compiler | ⚠️ Infra only | ✅ Yes | 🟠 P1 | — |
| 4 | Routes as components + typed params | ❌ | ✅ Yes | 🟠 P1 | #2, #9 |
| 1 | Nested reactivity tests | ❌ | ✅ Yes | 🟡 P2 | #2, #10 |
| 8 | Watch index.html in dev mode | ❌ | ✅ Yes | 🟡 P2 | — |
| 5 | Sync render + async patterns | ✅ Exists | ⚠️ Document it | 🟢 P3 | — |
| 7 | HTML syntax highlighting | ❌ | ✅ Yes | 🟢 P3 | Separate project |
| 6 | Lit-style assignment syntax for signals | ❌ | ❌ Not recommended | ⛔ Skip | — |

---

## Suggested Execution Order

### Phase 1 — Foundation (P0)
1. Implement global props map (`Map<instanceId, props>`) in the runtime
2. Wire `ctx.props` population from the global map on component instantiation
3. Update `createComponentHTMLSelector` to store props in the map instead of HTML attributes
4. Update CTFE in the component precompiler to work with the new props model

### Phase 2 — Architecture (P1)
5. Refactor router to be a composable component with flexible outlet placement
6. Add support for nested/sub-routers
7. Make router params flow as typed `ctx.props` to page components
8. Write directive validation lint rules (when/whenElse/repeat argument validation, event handler syntax, etc.)

### Phase 3 — Polish (P2-P3)
9. Write cross-component reactivity tests (signal passed as prop, nested component trees)
10. Add `index.html` to watch mode
11. Document async patterns (fetch in onMount, `when()` loading states)
12. Test `bierner.lit-html` extension for HTML syntax highlighting, build custom if needed
