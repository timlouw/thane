# Thane Framework — Weakness Assessment (v0.0.26)

> Evaluated: February 9, 2026  
> Codebase: 53 files, ~9,599 lines (runtime: ~1,190, compiler: ~8,409)  
> Version: 0.0.26

---

## What Changed: v0.0.25 → v0.0.26

v0.0.26 is a **compiler quality pass** — no runtime changes, no output changes, identical benchmark results (1.06× weighted mean, 9.36 KB bundle). All changes are internal to the compiler, improving maintainability, correctness, and code organisation.

### Changes

| Change | Category | Files |
|---|---|---|
| **Cache staleness check** — `SourceFileCache.get()` now validates entries against `fs.stat()` mtime before returning | 🛡️ Correctness | `cache.ts` |
| **Dead code removal** — removed unused `directoryExists` function and its barrel export | 🧹 Cleanup | `file-utils.ts`, `index.ts` |
| **Codegen delegation helpers** — extracted ~170 lines of inline delegation code into 3 top-level functions + 2 interfaces | 🏗️ Architecture | `codegen.ts` |
| **Repeat-analysis decomposition** — extracted ~150 lines from `processItemTemplateRecursively` into 3 helper functions + 3 types | 🏗️ Architecture | `repeat-analysis.ts` |
| **Component precompiler scan dedup** — replaced 20-line duplicated fallback scan with single `createBuildContext()` call | 🧹 Cleanup | `component-precompiler.ts` |
| **JS output optimizer validation** — added `isValidJS()` syntax check; optimizer reverts to original on transform failure | 🛡️ Correctness | `js-output-optimizer.ts` |

### Line Count Changes

| File | v0.0.25 | v0.0.26 | Δ |
|---|---|---|---|
| `cache.ts` | 42 | 54 | +12 |
| `file-utils.ts` | 90 | 83 | −7 |
| `codegen.ts` | 892 | 999 | +107 (extracted helpers add lines but reduce function length) |
| `repeat-analysis.ts` | 842 | 913 | +71 (extracted helpers add type defs + signatures) |
| `component-precompiler.ts` | 447 | 433 | −14 |
| `js-output-optimizer.ts` | 107 | 110 | +3 |

### Fixed Weaknesses (from v0.0.25)

- ✅ **cache.ts "no staleness check"** — now validates mtime before returning cached entries
- ✅ **codegen.ts "inline DelegatedEvent interface inside generateInitBindingsFunction"** — `DelegatedEvent`, `PartitionedEvents`, `partitionItemEvents`, `buildDelegatedListenerStatements`, `buildNonDelegatableEventStatements` are now top-level
- ✅ **repeat-analysis.ts "processItemTemplateRecursively is 370+ lines"** — classification, text binding collection, and attribute binding collection extracted into `classifyParsedBindings`, `collectItemTextBindings`, `collectItemAttrBindings`
- ✅ **component-precompiler.ts "two separate code paths"** — fallback scan now delegates to `createBuildContext()` instead of duplicating the logic
- ✅ **js-output-optimizer "no verification that transforms produce valid JS"** — `isValidJS()` validates output and reverts on failure
- ✅ **file-utils.ts dead `directoryExists`** — removed (was exported but never called)

### Additional Fixes Found During v0.0.26 Audit

- ✅ **index.ts "paren-depth tracking to find closing `)` of `defineComponent(`"** — now uses AST (`dcCallNode.getEnd() - 1`) instead of manual paren counting
- ✅ **index.ts "`return\s*\{` regex to find the return object"** — now uses AST (`ts.isReturnStatement` + `ts.isObjectLiteralExpression`) for reliable injection
- ✅ **html-bootstrap-injector "duplicates component scanning logic"** — now accepts `BuildContext` and delegates to it; fallback scan remains for standalone use
- ✅ **tagged-templates VS Code extension** — `extensions/tagged-templates/` provides HTML/CSS syntax highlighting in tagged template literals (configurable tag → language mappings)

---

## Weaknesses by Section

### 1. Signal Implementation (`signal.ts` — 72 lines)

- No error boundary around subscriber callbacks — one throwing subscriber kills all subsequent notifications
- No batching/transaction mechanism — multiple signal updates in sequence trigger separate DOM passes
- Object/array mutations invisible (reference equality) — intentional design choice but could surprise developers

---

### 2. Component System (`component.ts` — 300 lines)

- `componentFactories` Map grows forever — no deregistration mechanism
- `createHostElement` uses `document.getElementById` for target-based rendering — only works for top-level mount, not nested
- `createComponentHTMLSelector` generates a `<div>` wrapper — semantic mismatch if the component template has a different root element
- No SSR or multiple document context support — `document.adoptedStyleSheets` is global

---

### 3. DOM Binding & Reconciler (`dom-binding.ts` — 727 lines)

- General reorder uses forward-pass `insertBefore` — O(n) DOM ops worst case; LIS algorithm would minimize moves
- `new Set()` created for key collection on every general reconciliation pass (mitigated by reusable `_keySet` for removal phase)
- `getTempEl()` single shared `<template>` element — architecturally fragile for re-entrant scenarios
- Cleanup arrays grow unboundedly per managed item (push-only, never compacted) — though direct-update items bypass this entirely

---

### 4. Reactive Binding Compiler (6 files, ~3,442 lines)

Files: `index.ts` (439), `codegen.ts` (999), `template-processing.ts` (540), `template-utils.ts` (381), `types.ts` (170), `repeat-analysis.ts` (913)

- `codegen.ts` is now 999 lines — the extracted helpers add top-level code but the main `generateInitBindingsFunction` is still large due to the optimized repeat path, conditional rendering, and whenElse codegen
- `repeat-analysis.ts` is 913 lines — `processItemTemplateRecursively` is shorter after extraction (~220 lines of function body) but still coordinates many concerns (conditionals, whenElse, nested repeats, text bindings, attr bindings, event classification, template edits)

---

### 5. Component Precompiler (`component-precompiler.ts` — 433 lines)

- CTFE evaluation is limited to statically-resolvable expressions — dynamic computed properties silently fall back to no-op
- `vm.runInContext` sandboxing doesn't prevent infinite loops (only timeout), resource exhaustion, or side-effectful global access within the sandbox
- CTFE supports string/number/boolean/object/array props via `evaluateExpressionCTFE` — but no support for passing signals to child components at compile time

---

### 6. HTML Parser (5 files, ~1,256 lines)

Files: `types.ts` (174), `parser-core.ts` (503), `binding-detection.ts` (348), `html-utils.ts` (184), `index.ts` (47)

- Error recovery is basic — malformed HTML produces undefined behaviour rather than diagnostics
- `types.ts` has grown to 174 lines — accumulating entity support and binding types

---

### 7. Thane Linter (5 files, ~291 lines)

- Only 2 lint rules exist (`no-default-export-component`, `component-property-order`) — no validation of HTML directive usage (`when`, `repeat`, `whenElse`, `@event` syntax)
- No directive validation rules despite the infrastructure being in place

---

### 8. JS Output Optimizer (`js-output-optimizer.ts` — 110 lines)

- Still regex-based on concatenated output — positionally fragile by nature
- `new Function()` validation catches syntax errors but cannot detect semantic changes (e.g., a transform that produces valid JS with different behaviour)

---

### 9. Minification (3 files, ~350 lines)

Files: `minification.ts` (83), `selector-minifier.ts` (95), `template-minifier.ts` (172)

- `SelectorMap` is module-level mutable state (via `BuildContext`) — not re-entrant safe
- Selector name generation always produces 3+ character names (`a-a`, `a-b`, etc.) — could start with single-character names for better compression

---

### 10. Post-Build Processor (5 files, ~487 lines)

Files: `post-build-processor.ts` (143), `file-copy.ts` (71), `compression.ts` (57), `dev-server.ts` (140), `console-reporting.ts` (76)

- `dev-server.ts` uses raw `http.createServer` with no security headers, CORS config, or graceful shutdown
- File-copy paths are hardcoded patterns — no user configuration for additional static assets
- Compression runs synchronously on each file — no parallel processing

---

### 11. CLI (5 files, ~305 lines)

Files: `build.ts` (106), `cli-common.ts` (140), `thane.ts` (9), `types.ts` (45), `index.ts` (5)

- No `--watch` for `index.html` — esbuild's watch only covers the dependency graph
- No incremental build support — full rebuild on every change
- No user-facing configuration file (e.g., `thane.config.ts`) — all options are CLI flags or hardcoded

---

### 12. Other Compiler Plugins

| Plugin | Lines | Weaknesses |
|---|---|---|
| **Routes Precompiler** | 126 | Hardcoded to `router/routes.ts` path; no support for nested/sub-routers |
| **Global CSS Bundler** | 33 | — |
| **HTML Bootstrap Injector** | 232 | — (now accepts `BuildContext` and delegates to it; fallback scan path remains for standalone use) |
| **Type Checker** | 72 | Runs full `tsc` program creation on every build — no incremental checking |

---

### 13. Compiler Utilities

| Utility | Lines | Weaknesses |
|---|---|---|
| **ast-utils.ts** | 515 | Large single file covering many concerns (component extraction, signal detection, expression manipulation, HTML generation) |
| **source-editor.ts** | 56 | — |
| **cache.ts** | 54 | — |
| **logger.ts** | 181 | `error()` ignores `silent` level — always prints regardless of log level setting |
| **constants.ts** | 35 | — |
| **file-utils.ts** | 83 | `collectFilesRecursively` silently swallows all directory read errors |
| **colors.ts** | 19 | — |
| **plugin-helper.ts** | 13 | — |
| **index.ts** | 40 | — |

---

### 14. Test Coverage

- `signal.test.ts` exists (514 lines, thorough for signals)
- **Zero tests** for: HTML parser, reactive binding compiler (including event delegation), component precompiler, template minifier, selector minifier, JS output optimizer, routes precompiler, DOM binding, reconciler, component registration, Thane Linter rules
- The benchmark suite is the only validation for the compiled output pipeline
- The event delegation codegen, direct update path, AST-based expression utilities, and template-utils are all untested despite being critical infrastructure
- **Single biggest risk** to production readiness

---

### 15. Bundle Size (9.36 KB uncompressed)

- Brotli compressed size (3.8 KB) is 2.71× vanillajs-lite (1.4 KB) — compression ratio is lower because the runtime includes the full reconciler
- No code-splitting or lazy-loading support for multi-page apps

---

### 16. Developer Experience

- No `ctx.props` reactivity — props are typed but static (compile-time only via CTFE)
- No async data loading pattern documented (fetch in `onMount` → signal update → `when()` reveal)
- No DevTools integration — no signal inspector, no component tree viewer

---

## Risk Summary

| Risk | Severity |
|---|---|
| No compiler/runtime tests — all new infrastructure untested | 🔴 High |
| No signal batching — multiple updates trigger separate DOM passes | 🟡 Medium |
| Run memory 1.72× vanilla — per-row ManagedItem overhead | 🟡 Medium |
| Large compiler files (`codegen.ts` 999, `repeat-analysis.ts` 913) | 🟡 Medium |
| No `ctx.props` reactivity — blocks cross-component signal passing | 🟡 Medium |
| Reconciler general reorder O(n) — LIS would minimize DOM moves | 🟢 Low |
| Dev server has no security headers or graceful shutdown | 🟢 Low |
