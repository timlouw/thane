# Thane Component DX — Analysis & Improvement Plan

## Current State Analysis

### How a developer defines a component today

```typescript
import { Component, registerComponent, signal } from 'thane';

export const MyCounter = registerComponent(
  { selector: 'my-counter', type: 'component' },
  class extends Component {
    private _count = signal(0);

    render = () => html`
      <button @click=${() => this._count(this._count() + 1)}>
        Count: ${this._count()}
      </button>
    `;

    static styles = css`
      button { color: red; }
    `;
  },
);
```

### Pain points identified

| #  | Issue | Severity | Category |
|----|-------|----------|----------|
| 1  | `class extends Component` is mandatory boilerplate that every component must repeat | High | Verbosity |
| 2  | `registerComponent()` wrapper adds an extra indent level and mental overhead | High | Verbosity |
| 3  | The `{ selector: '...', type: '...' }` config object is disconnected from the class itself | Medium | Cohesion |
| 4  | `type: 'component'` vs `type: 'page'` is a framework concern leaking into authoring — most components are `'component'` | Medium | Leaky abstraction |
| 5  | The selector must be manually written and kept in sync with the export name | Medium | Redundancy |
| 6  | `render` must be an arrow property (`render = () =>`) not a method (`render()`) due to how the compiler binds `this` — but nothing enforces or explains this | High | Footgun |
| 7  | `static styles` must be declared on the class but it's easy to forget the `static` keyword | Low | Footgun |
| 8  | Importing three symbols (`Component`, `registerComponent`, `signal`) for a single component file | Low | Verbosity |
| 9  | The return value of `registerComponent` has an opaque, overloaded type — it's either a string or a function depending on `type` | Medium | Discoverability |
| 10 | `this.root` / `this.shadowRoot` are the only useful inherited members — the class inheritance exists just to carry those | Medium | Over-engineering |
| 11 | Anonymous class expression (`class extends Component { ... }`) means stack traces show no class name | Low | Debuggability |

---

## How Props Currently Work

Props are currently static and limited to `string` and `number` types. When a parent uses a child component in its template, the compiler's CTFE (Compile-Time Function Evaluation) evaluates the props at build time and serializes them as HTML attributes on the child's element tag. The child component reads them via `this.root.getAttribute()`. This works for static values but has no type safety and no support for complex types. Cross-component reactivity and a proper `ctx.props` system are tracked separately as a future workstream.

---

## Proposed Improvements

### 1. `defineComponent()` — function-based API, `template` as a static string

A single `defineComponent()` call replaces `registerComponent()` + `class extends Component`. There is no `type` distinction — pages and components are the same thing (see section 3).

The default form uses **auto-derived selectors** from the export name. An explicit selector string can be provided as an optional override:

```typescript
import { defineComponent, signal } from 'thane';

// Default: selector auto-derived as 'my-counter' from PascalCase export name
export const MyCounter = defineComponent(() => {
  const count = signal(0);

  return {
    template: html`
      <button @click=${() => count(count() + 1)}>
        Count: ${count()}
      </button>
    `,
    styles: css`button { color: red; }`,
  };
});

// Explicit override when you need a different selector
export const MyCounter = defineComponent('custom-counter', () => {
  // ...
});
```

**What this solves:**
- Eliminates `class extends Component` (pain #1)
- Eliminates the config object (pain #3)
- Removes the `registerComponent` wrapper concept (pain #2)
- No `this` needed for signals — they're just closures (pain #6 goes away entirely)
- Only one import: `defineComponent` (+ `signal` which is universal) (pain #8)
- `type` concept is gone entirely (pain #4)
- Selector is auto-derived by default — zero config (pain #5)

**Key design decisions:**

#### `template` instead of `render`

The returned `template` is a tagged template literal string — not an arrow function. This is both a DX and a performance win:

- **DX:** Less to type. No `() =>` wrapper, no ambiguity about arrow-property vs method.
- **Performance / compiler alignment:** This is exactly how the compiler already works internally. Today, the compiler:
  1. Takes the `render = () => html\`...\`` arrow function
  2. Extracts the `html\`...\`` template content as a string
  3. Processes it (assigns IDs, replaces `${this._signal()}` with initial values, extracts binding metadata)
  4. Generates a `static template` property containing the processed HTML string as a `<template>` element
  5. Replaces the original `html\`...\`` with empty backticks `\`\`` — so `render()` returns `""` at runtime
  6. The actual DOM content comes from cloning the static template, not from calling `render()`

  **The `render` arrow function was always a fiction** — the compiler strips it and replaces it with a static template. Making `template` a direct string just makes the source code match what the compiler actually does. The compiler no longer needs to unwrap an arrow function to get to the template content.

#### No `this` — closures replace class properties

Signals are plain `const` variables captured by the closure. No `this._count`, just `count`. The arrow-vs-method footgun disappears entirely because there is no class and no `this`.

#### `ctx` parameter for framework APIs

The setup function receives a context object for web component–like functionality:

```typescript
export const MyWidget = defineComponent((ctx) => {
  // ctx.root — the host element (same as this.root today)
  // ctx.root.getElementById('bar')
  // ctx.emit('custom-event', detail)  — optional sugar

  return { template: html`<div>...</div>` };
});
```

#### How it works internally (runtime)

```typescript
export function defineComponent<T>(selectorOrSetup, maybeSetup?) {
  // 1. Resolve selector (string arg or auto-derived at compile time)
  // 2. Create the host element (div) with getElementById support
  // 3. Build the ctx object: { root, props, emit }
  // 4. Call setup(ctx) — get back { template, styles, onMount, onDestroy }
  // 5. Register styles (same as registerComponent does today)
  // 6. Create factory: clone static template into root, call initializeBindings
  // 7. Store factory in componentFactories map
  // 8. Return the HTML selector function (typed via generic T)
}
```

#### How it works internally (compiler)

The compiler transformation is simpler than today because there's no class to inject into:

1. **Detection:** `source.includes('defineComponent')` (replaces `extendsComponentQuick`)
2. **AST extraction:** Find `defineComponent(...)` — if the first arg is a string literal, use it as the selector; if it's a function, auto-derive the selector from the `export const X =` variable name by converting PascalCase → kebab-case
3. **Selector injection:** When auto-deriving, the compiler rewrites `defineComponent(() => {` to `defineComponent('my-counter', () => {` in the compiled output so the runtime always receives an explicit selector string
4. **Template processing:** Identical to today — parse `html\`...\``, identify bindings, assign IDs, extract event bindings, conditionals, repeats
5. **Code injection:** Instead of injecting `static template` and `initializeBindings` into a class body, the compiler transforms the returned object to include the pre-compiled template and a generated `__bindings` function
6. **Tag stripping:** `html\`...\`` → `\`...\`` and `css\`...\`` → `\`...\`` — same as today

---

### 2. Auto-derived selector as the default

The default is **no selector argument** — the compiler derives it automatically from the export name:

```typescript
// Default (recommended) — 'MyCounter' → 'my-counter'
export const MyCounter = defineComponent(() => { ... });

// Explicit override — only when you specifically need a different selector
export const MyCounter = defineComponent('custom-counter', () => { ... });
```

The compiler has full AST access to the `VariableDeclaration` name. When the first argument to `defineComponent` is a function (not a string), it:
1. Reads the identifier from `export const MyCounter = ...`
2. Converts PascalCase → kebab-case: `MyCounter` → `my-counter`
3. Injects the derived selector string as the first argument in the compiled output

The explicit form exists for edge cases only (e.g. a selector that doesn't map cleanly from PascalCase, or when working with third-party naming conventions). In normal usage, developers never think about selectors at all.

#### Compile-time validation: no `export default` for components

A compile-time lint rule ensures `defineComponent()` is always a named export:

```typescript
// ✅ Allowed
export const MyCounter = defineComponent(() => { ... });

// ❌ Build error: "THANE400: defineComponent must use a named export (export const X = defineComponent(...))"
export default defineComponent(() => { ... });
```

**Implementation:** This runs inside the existing `ComponentPrecompilerPlugin`'s `onLoad` handler. After parsing the source file, walk top-level statements looking for `ExportAssignment` (i.e. `export default`) nodes where the expression is a `defineComponent()` call. If found, emit a diagnostic error via the existing `createError()` / `logger.diagnostic()` infrastructure. No external TypeScript plugin or separate tool needed — it's a ~15 line check inside a plugin that already parses every `.ts` file.

**Why this rule matters more with auto-derived selectors:** Since the selector is derived from the `export const X = ...` name, `export default` would have no variable name to derive from. The rule isn't just style — it's structurally necessary for the auto-derivation to work.

---

### 3. Eliminating `type: 'page'` vs `type: 'component'` — compiler already knows

The `type` property is completely eliminated. Pages and components are the same thing.

**The compiler already distinguishes pages from components by export pattern, not by `type`:**

| Compiler function | What it looks for | Where |
|---|---|---|
| `extractComponentDefinitions()` | `export const X = registerComponent(...)` with `type: 'component'` | `ast-utils.ts:310–340` |
| `extractPageSelector()` | `export default registerComponent(...)` — **does not check `type` at all** | `ast-utils.ts:348–368` |

The routes precompiler (`routes-precompiler.ts`) calls `extractPageSelector()`, which identifies pages by `export default` — not by `type: 'page'`. The CTFE component precompiler calls `extractComponentDefinitions()`, which looks for named exports.

**With `defineComponent()`, the rule becomes:**
- `export const X = defineComponent(...)` → **component** (eligible for CTFE inlining in other templates, HTML selector function returned)
- The entry `mount()` call identifies the root — no `export default` of the component itself is needed

**What about the runtime?** The only runtime difference between `type: 'page'` and `type: 'component'` is the return type of `registerComponent()`:
- `'page'` → returns a static string `"<my-page></my-page>"`  
- `'component'` → returns a function `(props) => "<my-comp ...></my-comp>"`

With `defineComponent()`, the return type is **always** the function form `(props: T) => string`. Pages are just components with no props — `defineComponent(() => { ... })` returns `(props: {}) => string`, and `mount()` can accept either the function or the selector string directly. The `RegisterComponentStripperPlugin` that strips the else-branch becomes unnecessary.

**No `definePage()` needed.** A "page" is just a component that happens to be passed to `mount()` or loaded by the router. The router's `componentModule` lazy-import pattern continues to work — the routes precompiler just needs to extract the selector from `defineComponent(...)` (reading either the explicit string or the auto-derived name from the export).

---

### 4. Lifecycle hooks with enforced ordering

Lifecycle hooks are returned as properties of the setup function's return object. The execution order at runtime is:

1. `template` — compiled to static HTML, cloned into DOM
2. `styles` — registered globally with scoped selectors
3. `onMount()` — called after the template is in the DOM and bindings are initialized
4. `onDestroy()` — called when the component is removed from the DOM

```typescript
export const MyTimer = defineComponent(() => {
  const elapsed = signal(0);
  let intervalId: number;

  return {
    template: html`<span>${elapsed()}</span>`,
    styles: css`span { font-weight: bold; }`,

    onMount() {
      intervalId = setInterval(() => elapsed(elapsed() + 1), 1000);
    },

    onDestroy() {
      clearInterval(intervalId);
    },
  };
});
```

`onMount` maps directly to the existing `initializeBindings()` call site — the compiler generates the reactive binding setup code and the runtime calls `onMount` immediately after. `onDestroy` is new and hooks into either a `MutationObserver` on the host element's removal or an explicit `destroy()` method on the component instance.

#### Enforcing declaration order — Thane Linter

The return object must declare properties in the canonical lifecycle order: `template → styles → onMount → onDestroy`. If a developer puts them out of order, the build emits a warning with a clear message.

**Implementation — a built-in Thane linter, shipped as part of the compiler:**

Rather than depending on ESLint or a TypeScript language service plugin, the linter is a **standalone esbuild plugin** in the existing compiler pipeline. It runs on every `.ts` file during `thane dev` and `thane build`, using the same TypeScript AST parsing the rest of the compiler uses.

```
src/compiler/plugins/
  thane-linter/
    thane-linter.ts        ← esbuild plugin, runs onLoad for all .ts files
    rules/
      no-default-export-component.ts   ← THANE400
      component-property-order.ts      ← THANE401
```

**How it works:**

1. The `ThaneLinterPlugin` is an esbuild `onLoad` plugin registered in `build.ts` alongside the other plugins. It runs **before** the component precompiler so that lint errors appear before transformation errors.

2. Each rule is a pure function: `(sourceFile: ts.SourceFile, filePath: string) => Diagnostic[]`. It receives the parsed AST and returns diagnostics.

3. The plugin collects all diagnostics from all rules and emits them via `logger.diagnostic()` — the same infrastructure used by the rest of the compiler. Warnings don't fail the build; errors do.

**Rule: `THANE401` — component property order**

The rule walks the AST to find `defineComponent(...)` calls, locates the returned object literal, and checks that properties appear in order:

```typescript
const CANONICAL_ORDER = ['template', 'styles', 'onMount', 'onDestroy'];

// Walk object literal properties, record each one's index in CANONICAL_ORDER
// If any property's index is less than the previous property's index → warning
```

Example diagnostic output:
```
[warning] THANE401: src/components/timer.ts:14:5
  'onMount' should be declared after 'template' and before 'onDestroy' (expected order: template → styles → onMount → onDestroy)
```

**Rule: `THANE400` — no default export for defineComponent**

```typescript
// Walk top-level statements, find ExportAssignment where expression is defineComponent()
// If found → error
```

Example diagnostic output:
```
[error] THANE400: src/components/timer.ts:3:1
  defineComponent must use a named export: export const MyTimer = defineComponent(...)
```

**Why a built-in linter instead of ESLint:**

- **Zero external dependencies.** No `eslint`, no `@typescript-eslint/parser`, no plugin configuration. Thane apps don't need an `.eslintrc`.
- **Uses the same AST.** The compiler already parses every `.ts` file with the TypeScript compiler API. The linter reuses those parsed source files — no double-parsing.
- **Integrated diagnostics.** Errors and warnings use the same `Diagnostic` type, `ErrorCode` enum, `formatDiagnostic()`, and `logger` infrastructure as the rest of the compiler. They show up in the same terminal output with the same formatting.
- **Ships with the framework.** When a developer installs `thane` and runs `thane dev`, the linter just works. No setup, no config files.
- **Extensible.** New rules are just functions in the `rules/` directory. The pattern is trivial: parse AST → return diagnostics.

---

### 5. Styles — both inline and file imports

Both approaches work and are supported:

**Option A: Inline in the return object**

```typescript
return {
  template: html`<button>Click</button>`,
  styles: css`button { color: red; }`,
};
```

The compiler already strips `css\`...\`` tags and registers the CSS string globally with `:host` → `.selector` scoping. No changes needed.

**Option B: CSS file import**

```typescript
import styles from './my-counter.css';

export const MyCounter = defineComponent(() => ({
  template: html`<button>Click</button>`,
  styles,
}));
```

Already supported via `client.d.ts` (`declare module '*.css'`) and the `css-file-inliner` compiler plugin. No changes needed.

---

### 6. Type-safe props via `ctx.props` and generic parameter

```typescript
interface CounterProps {
  initial: number;
  label?: string;
}

export const MyCounter = defineComponent<CounterProps>((ctx) => {
  const count = signal(ctx.props.initial);

  return {
    template: html`
      <button @click=${() => count(count() + 1)}>
        ${ctx.props.label ?? 'Count'}: ${count()}
      </button>
    `,
  };
});

// Usage in another component — fully typed:
// ${MyCounter({ initial: 5, label: 'Clicks' })}
```

**How this replaces `getAttribute()`:**

Today, props are serialized as HTML attributes and the developer manually reads them with `this.root.getAttribute('text')`. With `ctx.props`:

- Props are passed as a typed object, not serialized to/from strings
- The generic parameter `CounterProps` flows through to the return type — `MyCounter` becomes `(props: CounterProps) => string`
- Complex types (objects, arrays, numbers, booleans) work without JSON serialization/parsing
- The compiler's CTFE still evaluates props at compile time, but instead of emitting them as HTML attributes, it can emit them as a data attribute containing the serialized props object, or (with future child instantiation) pass them directly to the child's factory

---

### 7. Compiler changes required

| Change | Complexity | Description |
|--------|-----------|-------------|
| Recognize `defineComponent()` calls | Low | Add `DEFINE_COMPONENT: 'defineComponent'` to `FN` constants, add `isDefineComponentCall()` to `ast-utils.ts` |
| Auto-derive selector from export name (default) | Medium | Read `VariableDeclaration.name`, convert PascalCase → kebab-case, inject as first arg in compiled output |
| Extract explicit selector from first string arg | Low | When first arg is a string literal, use it directly |
| Extract `template` from returned object | Medium | Walk the setup function body to find the return statement's `template` property. Simpler than today's approach of finding `render = () => html\`...\`` inside a class body |
| Quick-detection update | Trivial | `extendsComponentQuick` → also match `source.includes('defineComponent')` |
| Thane Linter plugin | Low | New esbuild plugin with two rules: `THANE400` (no default export), `THANE401` (property order). ~100 lines total |
| Template processing | None | `html\`...\`` processing is identical — the reactive-binding-compiler processes all `html` tagged templates regardless of their surrounding context |
| `extractComponentDefinitions` update | Low | Also match `export const X = defineComponent(...)` pattern |
| Route selector extraction update | Low | Extract selector from `defineComponent` calls for the routes precompiler |
| Strip old infrastructure | Low | Remove `registerComponent`, its overloads, `CreateComponentConfig`, `InputComponent`, `NativeComponent` class, `RegisterComponentStripperPlugin`, `type: 'page' | 'component'` |

---

### 8. Migration path

This is a **breaking change** by design — `registerComponent` and `class extends Component` are removed entirely. There is one API: `defineComponent()`.

1. **Phase 1:** Implement `defineComponent()` runtime + compiler support. Update the benchmark to use it. Validate that the full compile pipeline works (CTFE, reactive bindings, style scoping, routes).
2. **Phase 2:** Remove `registerComponent`, `Component` class export, `NativeComponent`, `RegisterComponentStripperPlugin`, and all `type: 'page' | 'component'` infrastructure.
3. **Phase 3:** Add the Thane Linter plugin with `THANE400` and `THANE401` rules.

---

### 9. Side-by-side comparison

#### Before (current)
```typescript
import { Component, registerComponent, signal } from 'thane';
import styles from './todo-item.css';

interface TodoItemProps {
  text: string;
  done: boolean;
}

export const TodoItem = registerComponent<TodoItemProps>(
  { selector: 'todo-item', type: 'component' },
  class extends Component {
    private _done = signal(false);

    render = () => html`
      <label>
        <input type="checkbox" 
               .checked=${this._done()} 
               @change=${() => this._done(!this._done())} />
        <span>${this.root.getAttribute('text')}</span>
      </label>
    `;

    static styles = styles;
  },
);
```

#### After (proposed)
```typescript
import { defineComponent, signal } from 'thane';
import styles from './todo-item.css';

interface TodoItemProps {
  text: string;
  done: boolean;
}

export const TodoItem = defineComponent<TodoItemProps>((ctx) => {
  const done = signal(false);

  return {
    template: html`
      <label>
        <input type="checkbox" 
               .checked=${done()} 
               @change=${() => done(!done())} />
        <span>${ctx.props.text}</span>
      </label>
    `,
    styles,
  };
});
```

**Delta:**
- 3 imports → 2 (`Component` gone)
- No `class extends Component` boilerplate
- No selector string to write — auto-derived from `TodoItem` → `todo-item`
- No `this._` prefix on signals — just `done`
- No `static` keyword to forget
- No arrow function wrapper on `template` (was `render = () => html\`...\``, now just `template: html\`...\``)
- No `type: 'component'` config — the concept doesn't exist
- Props accessed through typed `ctx.props` instead of `this.root.getAttribute()`
- 2 fewer indent levels (no class body, no `registerComponent` wrapper)

#### Benchmark — before (current)
```typescript
import { Component, registerComponent, signal } from "thane";

export const Benchmark = registerComponent(
  { selector: 'bench-mark', type: 'page' },
  class extends Component {
    private _rows = signal<RowData[]>([]);
    private _selectedEl: HTMLElement | null = null;

    render = () => { return html`...`; };

    private _run = () => { ... };
    static styles = css``;
  },
);

// main.ts
import { mount } from 'thane';
import { Benchmark } from './benchmark.js';
mount(Benchmark);
```

#### Benchmark — after (proposed)
```typescript
import { defineComponent, signal } from "thane";

export const Benchmark = defineComponent(() => {
  const rows = signal<RowData[]>([]);
  let selectedEl: HTMLElement | null = null;

  const run = () => { ... };

  return {
    template: html`...`,
    styles: css``,
  };
});

// main.ts
import { mount } from 'thane';
import { Benchmark } from './benchmark.js';
mount(Benchmark);
```

---

## Summary — Prioritized Roadmap

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| **P0** | Implement `defineComponent()` runtime function | Medium | Eliminates all major DX pain points |
| **P0** | Add `defineComponent` pattern detection to the compiler | Medium | Required for P0 runtime to work with reactive bindings |
| **P0** | `template` as static string (not `render` arrow function) | Low | Simpler DX, aligns with what compiler already does internally |
| **P0** | Auto-derived selector from export name as the default | Medium | Zero-config component naming |
| **P0** | Remove `registerComponent`, `Component` class, `type: 'page'/'component'` | Medium | Clean single-API surface |
| **P1** | Type-safe props via `ctx.props` + generic parameter | Low | Major DX win, foundation for future cross-component reactivity |
| **P1** | Lifecycle hooks (`onMount`, `onDestroy`) | Low | Enables real-world components |
| **P1** | Thane Linter plugin (`THANE400`, `THANE401`) | Low | Built-in lint rules — no external deps, ships with the framework |
