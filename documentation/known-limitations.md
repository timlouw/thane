# Thane Framework — Known Limitations & By-Design Decisions

> This document explains the deliberate architectural choices, constraints, and accepted trade-offs in Thane.
> These are not bugs — they are intentional decisions with specific reasons.

---

## Compiler Constraints

### Single Component Per File (THANE407)

Every file may export at most one `defineComponent` call. This is a hard compile error, not a warning.

**Why:** The compiler derives the custom element selector from the export name of the component in the file. For example, a file exporting `MyCounter` produces `my-counter`. If a file exports two components, the compiler has no unambiguous way to derive a selector for each one, and the entire compile-time template analysis — including the scoped CSS class, the compiled `<template>` injection, and the component precompiler's CTFE pass — depends on that 1:1 mapping. Relaxing this constraint would require either explicit selectors on every component (more boilerplate) or a different selector derivation strategy.

---

### No Nested `html`` Tagged Templates (THANE404)

You cannot write `html\`... ${html\`...\`} ...\`` — nesting a tagged template literal inside another. This is enforced as a compile error.

**Why:** The reactive binding compiler processes a single `html` tagged template per component. It cannot perform correct binding analysis across nested template literals without full recursive expansion, which would significantly complicate the analysis pipeline. The correct pattern is to assign the inner template to a `const` variable and interpolate that variable.

---

### `when()` Attribute Syntax

The conditional directive looks like: `<div ${when(isVisible())}>content</div>`. This places a directive call inside an interpolation position within the element open tag.

**Why:** Thane templates are plain tagged template literals, not a custom parsed language. There is no JSX transpiler, no Vue-style single-file component parser, and no special pre-processor. The `when()` directive works because the compiler detects it at the AST level as a specific function call pattern in a specific position. Custom attribute syntax like `*ngIf` or `v-if` would require a full HTML parser that understands non-standard attribute forms. The current approach requires zero custom tokenization and integrates naturally with the TypeScript type system.

---

### Template Variables Must Be Locally Declared (THANE410)

`html` tagged template variables used in a component's template must be declared in the same file. You cannot import an `html` template from another file and use it inside a component's `html` template.

**Why:** The compiler performs static analysis file-by-file. It reads bindings, signal calls, and child component mounts from the source of a single file at a time. Cross-file template injection would require the compiler to follow import chains and merge binding analysis across files, which is significantly more complex and would break the single-pass compilation model.

---

### `vm.runInContext` / `new Function` in the Compiler

The compiler uses Node.js's `vm.runInContext` for compile-time function evaluation (CTFE) and `new Function()` for output validation in the JS optimizer.

**Why:** CTFE allows the compiler to evaluate simple expressions (prop defaults, static config) from component source code at compile time, reducing runtime overhead. Only developer-authored source code is evaluated — never user input. The sandbox has no access to Node.js APIs (`fs`, `net`, etc.) — only basic JS globals (`Math`, `JSON`, `String`, etc.). This is a standard and well-understood pattern for build-time code evaluation.

---

### Internal APIs Exported from `thane/runtime`

`__registerComponent`, `__registerComponentLean`, `__enableComponentStyles`, `__dc`, `__bindIf`, `__bindIfExpr`, and `createKeyedReconciler` are exported from the `thane/runtime` sub-path. They are not in the main `thane` public export.

**Why:** Compiler-generated code imports these functions directly. They must be importable at runtime. Moving them to a sub-path (`thane/runtime`) keeps the main `thane` export surface clean while making them available to the compiler's output. Users never need to import from `thane/runtime` — only the compiler does.

---

### `__b` Binding Property Name

The compiler injects a binding initializer as `__b` on the component's return object.

**Why:** Bundle size. A `Symbol` key would require the symbol to be importable from the runtime and referenced in every compiled component — adding bytes. A longer string like `__thane_bindings__` adds bytes to every compiled template. The double-underscore convention is a strong signal that this is an internal property. The probability of a user accidentally naming a return property `__b` is extremely low. This is an accepted trade-off.

---

## Runtime Constraints

### Light DOM (No Shadow DOM)

Components render as regular DOM elements with class-based scoped CSS. There is no Shadow DOM, no `attachShadow()`, and no encapsulation boundary.

**Why:** Shadow DOM has significant trade-offs — form participation (inputs inside shadow roots don't work with `<form>` by default), global CSS can't reach in without CSS custom properties, event retargeting is unintuitive, and devtools experience is degraded. Light DOM preserves natural CSS cascade, standard form semantics, and makes components invisible to the browser's DOM inspection tools in the way users expect. CSS scoping is handled by injecting a unique class onto the component's host element and wrapping all component styles with `.selector { ... }` via CSS Nesting.

---

### CSS Nesting Required for Scoped Styles

Component `styles` use CSS Nesting to scope rules to the component boundary. This requires Chrome 120+, Firefox 117+, Safari 17.2+, Edge 120+.

**Why:** CSS Nesting is the cleanest way to implement class-scoped styles without a preprocessor, a runtime style injection engine, or a custom CSS parser. The alternatives — postCSS transform, selector prepending via a regex — add complexity and have edge cases with pseudo-selectors, media queries, and `:is()`. Targeting evergreen browsers that all support CSS Nesting is a deliberate choice aligned with the framework's general target of modern browsers.

---

### Browser Targets: Chrome 120+, Firefox 117+, Safari 17.2+, Edge 120+

The compiled output targets only modern evergreen browsers.

**Why:** Supporting older browsers requires polyfills for `adoptedStyleSheets`, CSS Nesting, optional chaining, nullish coalescing, and other features used throughout the runtime and compiled output. Adding polyfills increases bundle size and defeats the framework's core value proposition of minimal runtime overhead. The target versions were chosen as the minimum that supports CSS Nesting.

---

### Production Builds Drop All `console.*` Calls

When building with `--prod`, esbuild's `drop: ['console', 'debugger']` option removes all `console.log`, `console.warn`, `console.error`, etc. calls from the output.

**Why:** Console calls are the single most common source of unintended information leakage in production bundles (API responses, user data, internal state). Dropping them reduces bundle size and eliminates accidental debug output. Developers who need runtime logging in production should use a structured logging library instead of `console.*`.

---

### `thane dev` Requires Bun

The development server (`thane dev`, `thane serve`) uses Bun-native APIs (`Bun.file`, `Bun.serve`) and is not compatible with Node.js.

**Why:** Bun's built-in HTTP server is faster to start and has better integration with Bun's file-serving primitives. The dev server is a development-only tool; production deployment uses standard static file hosting. The build pipeline itself (`tsc`, esbuild, the compiler plugins) works under Node.js — only the serve/watch mode requires Bun.

---

## API Constraints

### `defineComponent` Setup Function Cannot Be `async`

The setup function passed to `defineComponent` must be synchronous.

**Why:** The setup function runs once per component instance at mount time. The component's DOM is cloned and bindings are initialized synchronously in one pass. If setup were async, the component would need to render in a loading state, resolve the promise, then re-render — which requires a two-phase rendering model that the current architecture doesn't support. Data fetching should be handled via signals: initialize with a loading state, fetch in `onMount`, update the signal when data arrives.

---

### No `ref` API for Direct Element Access

There is no `ref=""` or `createRef()` mechanism to obtain a typed handle to a specific element inside a component template.

**Why:** Element references require the compiler to statically register named elements in the template at compile time and expose them in the component context. The current binding compiler is focused on reactive bindings (signals → DOM). Adding refs would require a new compiler pass, a new context API, and a TypeScript type mechanism to make refs typed. This is a missing feature, not a deliberate omission — it is on the backlog.

---

### No `context` / `provide` / `inject` System

There is no way to pass data from an ancestor component to a deeply nested descendant without threading it through every intermediate component as props.

**Why:** This is a feature gap rather than a deliberate choice. Module-level signals serve as an effective pattern for shared reactive state (declare a signal in a module, import it in any component that needs it), but this is not formally documented or idiomatically established.

---

### Router Global Functions Have No Runtime Implementation

`navigate()`, `navigateBack()`, and `getRouteParam()` are declared as globals in the runtime type definitions but have no runtime implementation exported from `thane`.

**Why:** The routes precompiler injects selector strings into route config objects at compile time (CTFE). The routing runtime — URL matching, history API integration, outlet rendering — is expected to be provided by the user or a companion router library. This is a documentation and architecture gap rather than a fully deliberate design: the intent was to provide a full router but it was not completed.

---

### Selector Minification Uses Sequential Names

In production builds, component selectors are minified to short alphabetic names (`a-a`, `a-b`, `b-a`, etc.) using a sequential counter. There is no collision detection against third-party element names.

**Why:** For self-contained applications built entirely with Thane, all custom element names are known to the minifier and replaced consistently. If the application uses third-party web components with names like `a-a` or `b-b`, those would collide with minified Thane component names. In practice, third-party components use descriptive names (e.g. `my-element`, `vaadin-grid`) that are far longer than the minified names. This is an accepted risk.

---

### JS Output Optimizer is esbuild-Format-Dependent

The post-build optimizer (`js-output-optimizer`) applies regex-based transforms to minified esbuild output. These transforms can silently become no-ops if esbuild changes its minification format.

**Why:** The transforms are conservative and each has a syntax validation fallback — if a transform produces invalid JS, the original output is restored. The savings are small (~0.5–1%) but consistent. The risk is that a future esbuild update changes its minification format and the transforms stop matching, becoming dead code. This is acceptable given the fallback behavior.
