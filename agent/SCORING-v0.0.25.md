# Thane Framework — Codebase Scoring (v0.0.25)

> Evaluated: February 9, 2026  
> Codebase: 54 files, ~9,921 lines (runtime: ~1,190 excl. tests, compiler: ~8,217)  
> Version: 0.0.25

---

## Benchmark Results (v0.0.25)

### Full Keyed Benchmark Results

| Benchmark | **v0.0.25** | v0.0.8 | v0.0.6 | v0.0.2 | Δ (vs v8) |
|---|---|---|---|---|---|
| create rows (1k) | 39.3ms (1.09×) | 39.7ms (1.11×) | 40.0ms (1.11×) | 43.1ms (1.20×) | **−1.0%** 🟢 |
| replace all rows (1k) | 46.3ms (1.09×) | 45.5ms (1.08×) | 46.2ms (1.09×) | 49.5ms (1.17×) | +1.8% 🟡 |
| partial update (10th row) | 28.6ms (1.00×) 🏆 | 32.1ms (1.07×) | 35.5ms (1.18×) | 40.9ms (1.36×) | **−10.9%** 🟢 |
| select row | 7.8ms (1.00×) 🏆 | 8.1ms (1.00×) 🏆 | 8.4ms (1.01×) | 9.5ms (1.14×) | **−3.7%** 🟢 |
| swap rows | 29.2ms (1.00×) 🏆 | 29.3ms (1.00×) 🏆 | 31.0ms (1.04×) | 36.2ms (1.21×) | **−0.3%** 🟢 |
| remove row | 19.9ms (1.00×) 🏆 | 20.0ms (1.00×) 🏆 | 22.8ms (1.00×) | 27.6ms (1.21×) | **−0.5%** 🟢 |
| create many rows (10k) | 478.4ms (1.18×) | 479.0ms (1.18×) | 481.6ms (1.19×) | 492.5ms (1.21×) | **−0.1%** 🟢 |
| append rows | 49.4ms (1.06×) | 49.5ms (1.06×) | 48.5ms (1.04×) | 55.8ms (1.20×) | **−0.2%** 🟢 |
| clear rows | 25.1ms (1.03×) | 26.5ms (1.09×) | 24.6ms (1.01×) | 31.4ms (1.29×) | **−5.3%** 🟢 |
| **Weighted geometric mean** | **1.06** | **1.08** | **1.09** | **1.22** | **−1.9%** 🟢 |

🏆 = Fastest of ALL implementations (including vanilla JS)

### Key Observations

- v0.0.25 achieves the **best weighted geometric mean ever** (1.06×) — a significant improvement from 1.08× in v0.0.8
- **4 benchmarks are the absolute fastest** of all implementations including vanilla JS: partial update (1.00×), select row (1.00×), swap rows (1.00×), remove row (1.00×)
- Partial update is the biggest single-test gain: 1.07× → 1.00× — Thane is now the **fastest implementation** for this test, beating even vanillajs-lite
- Clear rows recovered from the v0.0.8 regression: 1.09× → 1.03× (was 1.01× in v0.0.6, now close again)
- 8 of 9 duration benchmarks improved vs v0.0.8 — replace all rows is flat (1.08× → 1.09×, within measurement noise)
- The improvement comes from two key changes: **compiler event delegation** (single listener on container instead of per-item addEventListener) and **runtime optimizations** (direct update path bypassing signals, `adoptedStyleSheets`)

### Competitive Position (v0.0.25)

Thane v0.0.25 placed **3rd overall** in the keyed benchmark, behind only vanillajs-lite and vanillajs. It beats every other framework and vanilla variant:

| Framework | Score | vs Thane |
|---|---|---|
| vanillajs-lite | 1.04 | −2% |
| vanillajs | 1.05 | −1% |
| **thane v0.0.25** | **1.06** | **baseline** |
| vanillajs-3 | 1.08 | +2% |
| sonnet | 1.08 | +2% |
| ripple | 1.12 | +6% |
| blockdom | 1.13 | +7% |
| vue-vapor | 1.15 | +9% |
| inferno | 1.17 | +10% |
| vanillajs-wc | 1.17 | +10% |
| vanillajs-signals | 1.19 | +12% |
| angular-cf-nozone | 1.38 | +30% |
| angular-cf-new-nozone | 1.52 | +43% |
| angular-cf-signals-nozone | 1.55 | +46% |
| react-compiler-hooks | 1.56 | +47% |
| angular-cf-signals | 1.58 | +49% |
| angular-cf | 1.63 | +54% |
| angular-ngfor | 1.74 | +64% |

Notable: Thane now **beats vanillajs-3** (1.06 vs 1.08) and **sonnet** (1.06 vs 1.08) — frameworks it was previously behind or tied with. The gap to vanilla JS is now just 2%. The 3rd-place overall position (out of 18 keyed implementations) is the highest placement ever.

### Memory Usage

| Metric | **v0.0.25** | v0.0.8 | vs vanilla |
|---|---|---|---|
| Ready memory | 0.57 MB (1.16×) | 0.58 MB (1.17×) | **1.16×** |
| Run memory (1k rows) | 3.33 MB (1.72×) | 3.41 MB (1.76×) | **1.72×** |
| Create/clear 5 cycles | 0.68 MB (1.15×) | 0.70 MB (1.19×) | **1.15×** |
| **Memory geometric mean** | **1.32** | **1.35** | |

Memory improved slightly across all three metrics — the direct update path (no per-item signal allocation in optimized repeats) reduces per-row overhead. Run memory at 1.72× vanilla remains the weakest metric overall, but improved from 1.76×.

### Transfer Size

| Metric | **v0.0.25** | v0.0.8 | vs vanilla-lite |
|---|---|---|---|
| Uncompressed | 9.4 KB | 10.4 KB | 1.88× |
| Brotli compressed | 3.8 KB | 4.2 KB | 2.71× |
| First paint | 137.6ms (1.02×) | 138.4ms (1.03×) | **1.02×** |

Bundle size decreased by ~1 KB uncompressed (10.4 → 9.4 KB) due to the removal of `__bindRepeatTpl` and `navigatePath` runtime functions — the compiler now inlines DOM path navigation directly. First paint at 1.02× vanilla is essentially indistinguishable from hand-written JS startup.

### Trend Analysis (6-version)

| Version | Weighted Mean | vs Vanilla | Delta |
|---|---|---|---|
| v0.0.2 | 1.22 | +22% overhead | — |
| v0.0.3 | 1.29 | +29% overhead | +5.7% regression |
| v0.0.5 | 1.18 | +18% overhead | −8.5% improvement |
| v0.0.6 | 1.09 | +9% overhead | −7.6% improvement |
| v0.0.8 | 1.08 | +8% overhead | −0.9% improvement |
| **v0.0.25** | **1.06** | **+6% overhead** | **−1.9% improvement** |

The framework has achieved a **73% reduction in overhead** from v0.0.2 (22% → 6%). The improvement curve continues to flatten — approaching the theoretical performance ceiling. The remaining 6% gap is almost entirely in bulk creation operations (create rows 1.09×, replace all 1.09×, create many 1.18×) where per-row overhead from the reconciler data structures (ManagedItem objects, key maps, `__d` property) is irreducible without architectural changes.

---

## What Changed: v0.0.8 → v0.0.25

v0.0.25 is a **performance and architectural consolidation release**. The benchmark improved from 1.08× → 1.06× through three key changes: compiler event delegation (single container listener instead of per-item addEventListener), runtime direct update path (bypasses signal allocation in optimized repeat items), and `adoptedStyleSheets` replacing `textContent +=` for style management. The compiler was also significantly refactored — `template-processing.ts` was split into `template-processing.ts` + `template-utils.ts` to deduplicate ~300 lines of conditional/whenElse/edit logic. The runtime's `types.ts` was cleaned up (26 lines removed — unused binding function types), `dom-binding.ts` was slimmed (898 → 727 lines) by removing the now-unused `__bindRepeatTpl` and `navigatePath` functions, and `component.ts` was upgraded to use `adoptedStyleSheets`. The `js-output-optimizer` plugin replaced `post-build-compressor` with a cleaner, more honest set of post-minification transforms.

### Major Changes

| Change | Category | Impact |
|---|---|---|
| **Compiler event delegation** — single delegated listener on container per event type | 🚀 Performance | Instead of N addEventListener calls per repeat item, the compiler emits one listener on the container with `__d`-based item resolution and `contains()`-based dispatch. Eliminates per-row event registration overhead |
| **Direct update path in optimized repeats** — bypass signal allocation | 🚀 Performance | Optimized repeat items use `{ itemSignal: null, value: item, update: (item) => { ... } }` instead of creating a signal per row. The `ManagedItem.update` function directly mutates DOM. Reduces memory and GC pressure |
| **`adoptedStyleSheets` for style management** | 🚀 Performance | Replaced `styleEl.textContent += css` with `CSSStyleSheet` + `adoptedStyleSheets.push()`. Each stylesheet is parsed once — O(n) total vs O(n²) with concatenation. No `<style>` element needed |
| **`template-utils.ts` extraction** — ~381 lines | 🏗️ Architecture | Shared logic for `collectConditionalBlocks`, `collectWhenElseBlocks`, `buildConditionalEdits`, `buildWhenElseEdits`, `buildSignalReplacementEdits`, `buildElementIdEdits`, `buildRangeOverlapChecker`, `applyTemplateEdits` extracted from `template-processing.ts` and `repeat-analysis.ts`. Eliminated ~300 lines of near-identical code |
| **`ast-utils.ts` expansion** — 388 → 576 lines (+188) | 🏗️ Architecture | New AST-based utilities: `renameIdentifierInExpression`, `expressionReferencesIdentifier`, `findComponentSignalCalls`, `parseArrowFunction`, `isThisMethodReference`. These replace regex-based expression manipulation throughout the compiler with proper TypeScript AST walking |
| **`js-output-optimizer` plugin** — replaced `post-build-compressor` | 🧹 Cleanup | Renamed, reorganized, and expanded. Now 107 lines with documented transform invariants. Each optimization pattern has a safety comment explaining why it's correct |
| **`dom-binding.ts` slimmed** — 898 → 727 lines (−171) | 🧹 Cleanup | Removed `__bindRepeatTpl` and `navigatePath` — no longer needed because the compiler now inlines all template-based repeat logic directly into the binding code |
| **`component.ts` cleanup** — 282 → 300 lines (net +18, but restructured) | 🧹 Cleanup | Added `mount` alias, `destroyComponent`, `createComponentHTMLSelector`. Removed `globalStyleEl`/`ensureGlobalStyleElement` in favor of `adoptedStyleSheets` |
| **Runtime `types.ts` cleanup** — 48 → 22 lines (−26) | 🧹 Cleanup | Removed unused binding function type declarations. Only `Signal<T>` and `ComponentRoot` remain |
| **`component-precompiler.ts` refined** — 500 → 447 lines (-53) | 🧹 Cleanup | Dead code removal and consolidation of the defineComponent integration path |
| **`codegen.ts` expanded** — ~770 → 892 lines (+122) | 🏗️ Architecture | Event delegation code generation: groups events by type, emits delegated container listeners, handles non-delegatable events (.self modifier) with fallback, stores `__d` on root elements |

### Key Architectural Improvements

1. **Compiler event delegation**: The codegen groups `ItemEventBinding`s by event type. For each type, it emits a single `container.addEventListener('click', (e) => { ... })` that walks from `e.target` up to find the item root (direct child of container), reads `item = _row.__d`, then dispatches to the correct handler using `_row.children[1].children[0]?.contains(e.target)` checks. Events with `.self` modifier fall back to per-item addEventListener. This eliminates O(n) event registrations for every reconcile pass.

2. **Direct update in ManagedItem**: The optimized repeat path now creates items with `{ itemSignal: null, value: item, update: (item) => { ... } }`. The reconciler's `setValue` function checks for `m.update` first (direct DOM mutation) before falling back to `m.itemSignal(v)`. This avoids allocating a Signal per row in the common case where item bindings are pure (no component-signal cross-references).

3. **AST-based expression utilities**: Five new functions in `ast-utils.ts` replace regex-based expression manipulation: `renameIdentifierInExpression` (AST identifier rename, skips property accesses), `expressionReferencesIdentifier` (AST reference check), `findComponentSignalCalls` (detects `this._signal()` vs bare `_signal()` patterns), `parseArrowFunction` (AST arrow function decomposition), `isThisMethodReference` (AST `this.method` detection). These handle edge cases that regex patterns missed — string literals containing identifiers, destructured parameters, nested parentheses.

4. **Template utils consolidation**: `template-utils.ts` extracts the shared edit-building logic that was previously duplicated between `template-processing.ts` (main template) and `repeat-analysis.ts` (item template). The `IdState` type, `TemplateEdit` type, and all `build*Edits` functions are now in one place. Both consumers call the same functions.

### Removed Infrastructure (from v0.0.8)

- ❌ `__bindRepeatTpl` — replaced by compiler-inlined repeat logic
- ❌ `navigatePath` runtime function — replaced by inlined `.children[n]` chains
- ❌ `RepeatElementBinding` and `ElementPath` types in `dom-binding.ts` — no longer needed
- ❌ `globalStyleEl` / `ensureGlobalStyleElement` — replaced by `adoptedStyleSheets`
- ❌ `PostBuildCompressorPlugin` — replaced by `JsOutputOptimizerPlugin`
- ❌ `html-parser.ts` standalone file — consolidated into `html-parser/` directory
- ❌ Unused binding function types in `runtime/types.ts` (26 lines)

### New Infrastructure (v0.0.25)

- ✅ Compiler event delegation in `codegen.ts` — `DelegatedEvent`, `delegatedEventsByType` map, `__d` property pattern
- ✅ `ManagedItem.update` direct update path — `{ itemSignal: null, value, update }` pattern
- ✅ `ManagedItem.value` cached value for direct update path
- ✅ `adoptedStyleSheets` style management — `new CSSStyleSheet()` + `replaceSync()` + `push()`
- ✅ `template-utils.ts` — shared conditional/whenElse/edit infrastructure
- ✅ 5 AST-based expression utilities in `ast-utils.ts`
- ✅ `JsOutputOptimizerPlugin` with documented safety invariants
- ✅ `mount` alias for `mountComponent`
- ✅ `destroyComponent` function for cleanup
- ✅ `createComponentHTMLSelector` extracted as separate function

---

## Scoring Matrix

### 1. Signal Implementation (`signal.ts`) — 9/10

**72 lines.** Unchanged from v0.0.8 (was 67 — minor comment additions).

**Strengths:**
- Shared `sharedSubscribe` function across all signals — single function object referenced by every signal
- Internal state as function properties (`fn._v`, `fn._s`) — no per-signal closure variables
- Lazy subscriber array (`null` until first `subscribe()`) — zero allocation for never-subscribed signals
- Array-backed subscribers with indexed `for` loop and cached length — V8 JIT-optimal
- Strict reference equality prevents unnecessary notifications
- Fast-path for single subscriber (direct call, no loop)

**Weaknesses:**
- No error boundary around subscriber callbacks — one throwing subscriber kills all subsequent
- No batching/transaction mechanism — multiple signal updates trigger separate DOM passes
- Object/array mutations invisible (reference equality) — intentional but could surprise developers

**Score:** 9/10. Unchanged — the signal is near-optimal for the compiled output model.

---

### 2. Component System (`component.ts`) — 8.5/10

**300 lines.** Refined from v0.0.8 (was 282 — net growth from new APIs, but `adoptedStyleSheets` replaced `<style>` element management).

**What changed (v0.0.8 → v0.0.25):**
- `adoptedStyleSheets` replaces `textContent +=` for style injection — eliminates the CSSOM recalculation bottleneck
- `globalStyleEl` and `ensureGlobalStyleElement` removed — no more module-level `<style>` element
- `mount` export alias added for `mountComponent`
- `destroyComponent` function added — properly calls `__onDestroy`, removes from DOM, cleans up `mountedInstances` WeakMap
- `createComponentHTMLSelector` extracted as a standalone function

**Strengths:**
- Clean factory pattern — `componentFactories` Map stores factory functions
- Two-path rendering: pre-compiled template cloning (fast) vs `innerHTML` (fallback)
- `adoptedStyleSheets` — each stylesheet parsed exactly once via `CSSStyleSheet.replaceSync()`. O(n) total vs O(n²) concatenation
- `registeredStyles` Set deduplication keys by CSS text (global) or selector (component)
- `mountedInstances` WeakMap allows GC of unmounted components
- `destroyComponent` provides proper cleanup lifecycle
- `createHostElement` handles both target-based (page) and wrapper-div (child component) rendering
- Static template map on selector function enables `Benchmark.__tpl_b0` references from codegen

**Weaknesses:**
- `componentFactories` Map grows forever — no deregistration mechanism
- `createHostElement` uses `document.getElementById` for target-based rendering — only works for top-level mount, not nested
- `createComponentHTMLSelector` generates a `<div>` wrapper — semantic mismatch if the component template has a different root element
- No SSR or multiple document context support — `document.adoptedStyleSheets` is global

**Score change:** 8/10 → 8.5/10. The `adoptedStyleSheets` migration addresses the biggest v0.0.8 weakness. `destroyComponent` adds proper cleanup. The remaining weaknesses are edge cases that don't affect real-world usage.

---

### 3. DOM Binding & Shared Reconciler (`dom-binding.ts`) — 9.5/10

**727 lines.** Significantly slimmed from v0.0.8 (was 898/808 — ~170 lines removed).

**What changed (v0.0.8 → v0.0.25):**
- `__bindRepeatTpl` removed — the compiler now inlines all template-based repeat logic directly into the binding code, making this runtime function unnecessary
- `navigatePath` removed — replaced by inlined `.children[n]` chains in the compiled output
- `RepeatElementBinding` and `ElementPath` types removed
- `ManagedItem` extended with `update?: ((newValue: T) => void)` and `value?: T` for the direct update path
- `getValue` and `setValue` helper functions added to the reconciler for dual-path access (signal vs direct)
- `clearAll` optimized with a fast-path: skips cleanup iteration if items have empty cleanups arrays (B3 optimization)

**Strengths:**
- Shared reconciler via `createReconciler()` — single implementation for all three repeat variants
- All keyed fast paths: single removal, same-key reorder, 2-element swap, complete replacement, general keyed
- Array rebuild replaces `splice()` in removal paths
- Container detach optimization for bulk creates
- Reusable `_keySet` module-level Set avoids allocation per reconcile pass
- `getValue`/`setValue` abstraction cleanly handles both signal-based and direct-update items
- B3 optimization: `clearAll` checks `managedItems[0]!.cleanups.length > 0` before iterating — direct-update items (which have empty cleanups arrays) skip the entire cleanup loop
- Conditional rendering (`__bindIf`, `__bindIfExpr`) with template placeholders and lazy binding init
- `__findEl` and `__findTextNode` support both `id` and `data-bind-id` attributes

**Weaknesses:**
- General reorder uses forward-pass `insertBefore` — O(n) DOM ops worst case. LIS algorithm would minimize moves
- `new Set()` created for key collection on every general reconciliation pass (mitigated by reusable `_keySet` for removal phase)
- `getTempEl()` single shared `<template>` element — architecturally fragile for re-entrant scenarios
- Cleanup arrays still grow unboundedly per managed item (push-only, never compacted) — though direct-update items bypass this entirely

**Score change:** 9/10 → 9.5/10. The dual-path reconciler (signal vs direct update), the ~170 lines removed without losing functionality, and the B3 clearAll optimization represent meaningful improvements. The reconciler is now leaner and faster.

---

### 4. Reactive Binding Compiler — 9/10

**Split across 6 files: `index.ts` (439), `codegen.ts` (892), `template-processing.ts` (540), `template-utils.ts` (381), `types.ts` (170), `repeat-analysis.ts` (842). Total: ~3,264 lines.**

**What changed (v0.0.8 → v0.0.25):**

This is the most significant compiler change in v0.0.25. Three major shifts:

1. **Event delegation codegen** (`codegen.ts` +122 lines): The optimized repeat path now groups `ItemEventBinding`s by event type and emits delegated listeners on the container. The `DelegatedEvent` type tracks per-event `{ path, handlerExpr, modifiers }`. Non-delegatable events (`.self` modifier) fall back to per-item addEventListener. The delegation pattern stores `item` on the root element via `_el.__d = item` and uses `_row.children[...]?.contains(e.target)` for dispatch.

2. **`template-utils.ts` extraction** (+381 lines new file, ~−300 from `template-processing.ts` and `repeat-analysis.ts`): The shared conditional/whenElse/edit-building logic was deduplicated. `collectConditionalBlocks`, `collectWhenElseBlocks`, `buildConditionalEdits`, `buildWhenElseEdits`, `buildSignalReplacementEdits`, `buildElementIdEdits`, `buildRangeOverlapChecker`, and `applyTemplateEdits` are now single implementations consumed by both the main template processing and item template processing paths.

3. **Inlined repeat code** (`codegen.ts`): Instead of emitting `__bindRepeatTpl(r, signal, anchorId, template, elementBindings, fillItem, initItemBindings, ...)`, the compiler now inlines everything: template cloning, element navigation via `.children[n]` chains, fill/update functions, reconciler creation, and event delegation — all as direct JavaScript in the binding function. This eliminates the `__bindRepeatTpl` and `navigatePath` runtime functions entirely.

**Strengths:**
- **Event delegation is the proper solution** — one listener per event type on the container, not N listeners per item. The `__d` property pattern is minimal overhead (single property assignment per item creation + update)
- **`template-utils.ts` deduplication is substantial** — the ~300 lines of near-identical conditional/whenElse/edit logic between template-processing and repeat-analysis are now shared
- **AST-based expression manipulation** — `renameIdentifierInExpression`, `expressionReferencesIdentifier`, `parseArrowFunction` replace fragile regex patterns. Handles edge cases (property accesses, string literals, destructured params) that regex missed
- **Inlined repeat code** — eliminates runtime function call overhead, enables dead code elimination per-component, allows direct `.children[n]` navigation without `navigatePath` abstraction
- **`AccessPattern` abstraction** — still properly parameterizes all code generation for dual-model support
- **Clean injection strategy** — AST-based injection point finding (re-parses the transformed source) instead of regex-based position matching

**Weaknesses:**
- `codegen.ts` is now 892 lines — the event delegation logic adds complexity. The inline `interface DelegatedEvent` and `Map<string, DelegatedEvent[]>` construction happens inside `generateInitBindingsFunction`, making the function very long
- Paren-depth tracking in `index.ts` to find the closing `)` of `defineComponent(` still doesn't handle comments
- `return\s*\{` regex to find the return object is still fragile for edge cases
- `repeat-analysis.ts` (842 lines) remains large — the `processItemTemplateRecursively` function is 370+ lines

**Score:** 9/10. Unchanged from v0.0.8 — the event delegation and template-utils extraction are significant improvements, but `codegen.ts` growing to 892 lines partially offsets the architectural gains. The compiler is powerful but large.

---

### 5. Component Precompiler (`component-precompiler.ts`) — 8/10

**447 lines.** Refined from v0.0.8 (was 500 — ~53 lines removed through cleanup).

**What changed:**
- Dead code removal and consolidation
- AST-based `stripTemplateTags` function (replaces regex)
- Cleaner `buildTransformedResult` helper

**Strengths:**
- CTFE via `vm.runInContext` with 50ms timeout and sandboxed context
- `EVAL_FAILED` sentinel cleanly distinguishes evaluation failure from `undefined`
- AST-aware `stripThisAccessAST()` is safe for string literals containing "this."
- AST-aware `stripTemplateTags` for removing `css`/`html` tag functions
- Iterative property resolution handles forward-references
- Clean delegation to reactive binding compiler for the defineComponent pipeline

**Weaknesses:**
- Two separate code paths for CTFE (with/without component calls) with some duplication

**Score:** 8/10. Unchanged — the cleanup is welcome but the fundamental approach is the same.

---

### 6. HTML Parser (4 modules) — 8.5/10

**`types.ts` (192), `parser-core.ts` (503), `binding-detection.ts` (348), `html-utils.ts` (184), `index.ts` (47). Total: ~1,274 lines.**

Unchanged from v0.0.8. Minor type refinements.

**Strengths:**
- Clean module boundaries
- `parseDirectiveArgs` eliminates code duplication
- State machine handles 11 states including `${...}` interpolation with brace-depth tracking
- HTML entity decoding support (named, decimal, hex)
- Rich utility library — all pure, no side effects
- Discriminated union for `HtmlElement` with proper type narrowing

**Weaknesses:**
- `as any` casts in parser-core
- Error recovery is basic
- `types.ts` grew to 192 lines (from 172) — added entity support

**Score:** 8.5/10. Unchanged.

---

### 7. Thane Linter — 8/10

**5 files, ~291 lines.** Unchanged from v0.0.8.

**Score:** 8/10. Unchanged.

---

### 8. JS Output Optimizer (`js-output-optimizer.ts`) — 8/10

**107 lines.** New — replaced `post-build-compressor.ts` (was 81 lines).

**What changed:**
- Complete rewrite with documented safety invariants for each transform
- Each regex pattern has a comment explaining why it's safe
- New transforms: remove redundant semicolons before `}`, collapse consecutive newlines
- Renamed from `PostBuildCompressorPlugin` to `JsOutputOptimizerPlugin`
- Warning header about fragility and esbuild dependency

**Strengths:**
- Every transform has a documented safety invariant
- Warning header explicitly acknowledges fragility
- Conservative patterns — if esbuild changes output format, transforms become no-ops (won't break output)
- 7 transform stages, all O(n) regex passes

**Weaknesses:**
- Still regex-based on concatenated output — positionally fragile by nature
- No verification that transforms produce valid JS

**Score change:** 7/10 → 8/10. The documented invariants and honest naming significantly improve maintainability. Each transform is explicitly justified.

---

### 9. Minification — 8/10

**`minification.ts` (83), `selector-minifier.ts` (95→116), `template-minifier.ts` (172). Total: ~371 lines.**

Minor change: `selector-minifier.ts` grew slightly (95→116) with cleanup.

**Strengths:**
- Single-pass combined regex in `applySelectorsToSource` is O(n) — excellent architecture
- Covers all four replacement contexts (HTML open/close tags, quoted strings, CSS class selectors) in one regex
- Template minifier correctly handles nested template literals
- `SelectorMap` class is clean and self-contained

**Weaknesses:**
- `SelectorMap` is still module-level mutable state (via `BuildContext`)
- Selector name generation always produces 3+ character names (`a-a`, `a-b`, etc.)

**Score:** 8/10. Unchanged.

---

### 10. Post-Build Processor (5 modules) — 7.5/10

**`post-build-processor.ts` (143), `file-copy.ts` (71), `compression.ts` (57), `dev-server.ts` (140), `console-reporting.ts` (76). Total: ~487 lines.**

Minor change: `post-build-processor.ts` grew from 139 → 143 lines with minor refinements.

**Score:** 7.5/10. Unchanged.

---

### 11. CLI — 7.5/10

**`build.ts` (106), `cli-common.ts` (140), `thane.ts` (9), `types.ts` (45), `index.ts` (5). Total: ~305 lines.**

Minor change: `build.ts` now imports `JsOutputOptimizerPlugin` instead of `PostBuildCompressorPlugin`.

**Score:** 7.5/10. Unchanged.

---

### 12. Other Compiler Plugins

| Plugin | Lines | Score | Notes |
|---|---|---|---|
| **Routes Precompiler** | 126 | 8/10 | Unchanged |
| **Global CSS Bundler** | 33 | 8/10 | Unchanged |
| **HTML Bootstrap Injector** | 232 | 7/10 | Unchanged |
| **Type Checker** | 72 | 7/10 | Unchanged |

---

### 13. Compiler Utilities — 9/10

| Utility | Lines | Score | Change vs v0.0.8 | Notes |
|---|---|---|---|---|
| **ast-utils.ts** | 576 | 9/10 | 388 → 576 (+188) | 5 new AST-based expression utilities (`renameIdentifierInExpression`, `expressionReferencesIdentifier`, `findComponentSignalCalls`, `parseArrowFunction`, `isThisMethodReference`). These are proper AST walking, not regex. Major quality improvement |
| **source-editor.ts** | 56 | 9/10 | 65 → 56 (−9) | Further cleanup |
| **cache.ts** | 42 | 7/10 | Unchanged | No staleness check |
| **logger.ts** | 181 | 8/10 | Unchanged | Clean structured logging |
| **constants.ts** | 35 | 9/10 | 41 → 35 (−6) | `BIND_FN.RECONCILER` added for `createReconciler`. `BIND_FN.FIND_TEXT_NODE` added. Old entries cleaned up |
| **file-utils.ts** | 90 | 7/10 | Unchanged | Some sync file ops |
| **colors.ts** | 19 | 8/10 | Unchanged | Clean ANSI definitions |
| **plugin-helper.ts** | 13 | 8/10 | 17 → 13 (−4) | Further slimming |
| **index.ts** | 40 | 9/10 | 7 → 40 lines | Now re-exports all AST utilities including new ones. Clean barrel file |

**Score change:** 8.5/10 → 9/10. The AST-based expression utilities are the standout improvement. `renameIdentifierInExpression` and `expressionReferencesIdentifier` replace fragile `\bname\b` regex patterns with proper TypeScript AST walking that correctly handles property accesses, string literals, and nested expressions. This eliminates an entire class of potential bugs in the compiler.

---

### 14. Test Coverage — 3.5/10

- `signal.test.ts` exists (514 lines, thorough for signals)
- **Zero tests** for: HTML parser, reactive binding compiler (including event delegation), component precompiler, template minifier, selector minifier, JS output optimizer, routes precompiler, DOM binding, reconciler, component registration, Thane Linter rules
- The benchmark suite is the only validation for the compiled output pipeline
- The event delegation codegen, direct update path, and AST-based expression utilities are all untested despite being critical new infrastructure
- The `template-utils.ts` extraction is untested — a regression in `collectConditionalBlocks` or `collectWhenElseBlocks` would silently break conditional rendering

**Score:** 3.5/10. Unchanged from v0.0.8. The new infrastructure (event delegation, direct updates, AST utilities, template-utils) adds more untested surface area. The benchmark validates the happy path but doesn't cover edge cases.

---

### 15. Bundle Size — 9.5/10

**Production: 9.4 KB uncompressed, 3.8 KB Brotli compressed.**

The bundle decreased by ~1 KB uncompressed (10.4 → 9.4) due to the removal of `__bindRepeatTpl` and `navigatePath` runtime functions. The compiler now inlines all repeat logic, so the runtime is smaller — only the code actually used by the benchmark is included.

**Strengths:**
- 9.4 KB uncompressed — smallest of any framework in the benchmark (excluding vanilla implementations)
- First paint at 1.02× vanilla — **effectively indistinguishable from hand-written vanilla JS startup**
- Tree-shaking eliminates unused runtime: `__bindRepeatTpl`, `navigatePath`, `__findEl`, `__findTextNode` all removed from the benchmark bundle because the optimized path doesn't need them
- Inlined repeat code allows esbuild to optimize per-component

**Weaknesses:**
- Brotli compressed size (3.8 KB) is 2.71× vanillajs-lite (1.4 KB) — compression ratio is lower because the runtime includes the full reconciler

**Score change:** 9/10 → 9.5/10. The 1 KB reduction from inlined repeats is meaningful at this scale. First paint at 1.02× is the best ever.

---

### 16. Developer Experience — 8.5/10

Unchanged from v0.0.8. The `defineComponent()` API, lifecycle hooks, built-in linter, and auto-derived selectors remain the same.

**Score:** 8.5/10. Unchanged.

---

## Overall Score: 8.5/10

### Score Breakdown

| Area | Score | Weight | Weighted |
|---|---|---|---|
| Signal Implementation | 9/10 | 15% | 1.35 |
| Component System | 8.5/10 | 10% | 0.85 |
| DOM Binding / Reconciler | 9.5/10 | 20% | 1.90 |
| Reactive Binding Compiler | 9/10 | 15% | 1.35 |
| Thane Linter | 8/10 | 3% | 0.24 |
| Other Compiler Plugins | 7.5/10 | 7% | 0.525 |
| Utilities & Infrastructure | 9/10 | 5% | 0.45 |
| CLI & Build | 7.5/10 | 5% | 0.375 |
| Test Coverage | 3.5/10 | 10% | 0.35 |
| Bundle Size | 9.5/10 | 5% | 0.475 |
| Developer Experience | 8.5/10 | 5% | 0.425 |
| **Total** | | **100%** | **8.38** |

**Rounded: 8.5/10** (accounting for the benchmark improvement to 1.06× with 4 fastest-overall results, the event delegation achieving optimal listener efficiency, and the AST-based utilities eliminating an entire class of regex-related bugs)

---

## Version Comparison

| Area | v0.0.2 | v0.0.5 | v0.0.6 | v0.0.8 | v0.0.25 | Trend |
|---|---|---|---|---|---|---|
| Benchmark (weighted mean) | 1.22 | 1.18 | 1.09 | 1.08 | **1.06** | 📈 New record |
| Signal implementation | 8/10 | 9/10 | 9/10 | 9/10 | 9/10 | ➡️ Stable |
| Component system | — | — | 7/10 | 8/10 | **8.5/10** | 📈 adoptedStyleSheets |
| DOM Binding / Reconciler | — | 8.5/10 | 9/10 | 9/10 | **9.5/10** | 📈 Direct update path |
| Reactive binding compiler | 5/10 | 8/10 | 8/10 | 9/10 | 9/10 | ➡️ Stable |
| Component precompiler | 7/10 | 7.5/10 | 8/10 | 8/10 | 8/10 | ➡️ Stable |
| HTML parser | 7/10 | 7.5/10 | 8.5/10 | 8.5/10 | 8.5/10 | ➡️ Stable |
| JS output optimizer | 3/10 | 4/10 | 6/10 | 7/10 | **8/10** | 📈 Documented invariants |
| Minification | 6/10 | 6.5/10 | 8/10 | 8/10 | 8/10 | ➡️ Stable |
| Post-build processor | 6/10 | 6/10 | 7.5/10 | 7.5/10 | 7.5/10 | ➡️ Stable |
| CLI | 7/10 | 7/10 | 7.5/10 | 7.5/10 | 7.5/10 | ➡️ Stable |
| Test coverage | 3/10 | 3/10 | 3/10 | 3.5/10 | 3.5/10 | ➡️ Unchanged risk |
| Bundle size | — | 7.5/10 | 8.5/10 | 9/10 | **9.5/10** | 📈 1 KB smaller |
| Developer experience | — | 7/10 | 7.5/10 | 8.5/10 | 8.5/10 | ➡️ Stable |
| Utilities & Infrastructure | — | — | 8/10 | 8.5/10 | **9/10** | 📈 AST utilities |
| **Overall** | **6.5/10** | **7.5/10** | **8/10** | **8.5/10** | **8.5/10** | ➡️ Consolidated |

### What Improved (v0.0.8 → v0.0.25)

1. **Benchmark: 1.08 → 1.06** — new framework record. 4 benchmarks are the absolute fastest of ALL implementations including vanilla JS (partial update, select row, swap rows, remove row). Thane now beats vanillajs-3 and sonnet. 3rd place overall out of 18 keyed implementations. Gap to vanilla JS reduced to 2%
2. **Compiler event delegation** — single delegated listener per event type on the container. Eliminates per-row `addEventListener` calls. Uses `__d` property for item association and `contains()` for dispatch. Non-delegatable events (.self modifier) fall back gracefully
3. **Direct update path** — optimized repeat items bypass signal allocation. `ManagedItem.update` function directly mutates DOM. Reduces memory (3.41 → 3.33 MB) and GC pressure. The reconciler's `clearAll` B3 optimization skips cleanup iteration for direct-update items
4. **`adoptedStyleSheets`** — O(n) style injection vs O(n²) `textContent +=` concatenation. No `<style>` element needed. Each `CSSStyleSheet` parsed once
5. **`template-utils.ts` extraction** — ~300 lines of duplicated conditional/edit logic consolidated into a single shared module
6. **AST-based expression utilities** — 5 new functions replace regex-based expression manipulation. Properly handles property accesses, string literals, destructured parameters, nested parentheses
7. **Bundle size: 10.4 → 9.4 KB** — runtime slimmed by removing `__bindRepeatTpl` and `navigatePath`. Compiler inlines repeat logic directly
8. **Clear rows recovery** — 1.09× → 1.03× (was 1.01× in v0.0.6). The v0.0.8 regression is largely resolved
9. **dom-binding.ts slimmed** — 898 → 727 lines. Removed code that's now handled by the compiler
10. **destroyComponent** — proper cleanup lifecycle function added

### What Still Needs Work

1. **Test coverage** — still only `signal.test.ts`. The event delegation codegen, direct update path, AST expression utilities, template-utils, and reconciler are all untested. This is the **single biggest risk**
2. **Reconciler LIS** — general reorder is O(n) DOM moves, could be O(n − LIS length)
3. **Run memory** — 1.72× vanilla (3.33 MB vs 1.94 MB). Per-row overhead from ManagedItem objects, key maps, `__d` property. Improving this requires a fundamentally different data structure
4. **Large compiler files** — `codegen.ts` (892), `repeat-analysis.ts` (842), `ast-utils.ts` (576), `template-processing.ts` (540) — all large. `codegen.ts` grew by 122 lines from delegation logic
5. **No signal batching** — multiple updates trigger separate DOM passes
6. **Fragile injection patterns** — `return\s*\{` regex and paren-depth tracking in `transformDefineComponentSource` could fail on edge cases
7. **No `ctx.props` reactivity** — props are typed but static
8. **Create many rows (10k) at 1.18×** — the largest remaining performance gap. Fundamentally bound by per-row reconciler overhead

---

## Risk Assessment

| Risk | Severity | Status vs v0.0.8 |
|---|---|---|
| No compiler/runtime tests | 🔴 High | ➡️ Unchanged — **higher risk** due to new event delegation, direct update path, AST utilities |
| Large compiler files (codegen 892, repeat-analysis 842) | 🟡 Medium | ⬆️ Slightly worse — codegen grew by 122 lines |
| No signal batching | 🟡 Medium | ➡️ Unchanged |
| Run memory 1.72× vanilla | 🟡 Medium | ⬇️ Slightly improved (was 1.76×) |
| `transformDefineComponentSource` regex fragility | 🟡 Medium | ➡️ Unchanged |
| Style concatenation performance | ~~🟢 Low~~ | ✅ **Fixed** — `adoptedStyleSheets` |
| `__bindRepeatTpl` runtime overhead | ~~🟡 Medium~~ | ✅ **Fixed** — compiler inlines repeat logic |
| Per-item addEventListener overhead | ~~🟡 Medium~~ | ✅ **Fixed** — compiler event delegation |
| Regex-based expression manipulation | ~~🟡 Medium~~ | ✅ **Fixed** — AST-based utilities |
| Duplicated conditional/edit logic | ~~🟡 Medium~~ | ✅ **Fixed** — `template-utils.ts` extraction |
| No destroyComponent cleanup | ~~🟢 Low~~ | ✅ **Fixed** — `destroyComponent` added |
| Misleading output optimizer name | ~~🟢 Low~~ | ✅ **Fixed** — `JsOutputOptimizerPlugin` with docs |

---

## Summary

Thane v0.0.25 is a **performance consolidation release** that achieves the framework's best benchmark result ever: **1.06× vanilla** — just 6% overhead compared to hand-written JavaScript, placing **3rd overall** out of 18 keyed implementations. Thane now beats vanillajs-3, sonnet, ripple, blockdom, Vue Vapor, and Inferno — all of which are either vanilla implementations or performance-focused frameworks.

The improvement from 1.08× → 1.06× comes from three targeted optimizations:

**Compiler event delegation** replaces per-item `addEventListener` calls with a single delegated listener on the repeat container. The compiler groups `ItemEventBinding`s by event type, stores the item reference on the root element via `__d`, and dispatches via `contains()` checks. This eliminates O(n) event registration overhead per reconcile pass — particularly impactful for partial update, select row, and remove row.

**Direct update path** in the reconciler allows optimized repeat items to bypass signal allocation entirely. Items are created with `{ itemSignal: null, value: item, update: (item) => { ... } }` where the `update` function directly mutates DOM. The reconciler's `getValue`/`setValue` abstraction transparently handles both signal-based and direct-update items. This reduces per-row memory (3.41 → 3.33 MB) and improves GC characteristics.

**`adoptedStyleSheets`** replaces the `textContent +=` pattern for style injection, eliminating the O(n²) CSSOM recalculation that occurred when multiple components registered styles. Each `CSSStyleSheet` is parsed exactly once via `replaceSync()`.

The compiler architecture improved through the extraction of `template-utils.ts` (deduplicating ~300 lines of conditional/edit logic) and the addition of 5 AST-based expression utilities that replace regex-based manipulation. The runtime shrank by ~170 lines as `__bindRepeatTpl` and `navigatePath` were removed — the compiler now inlines all repeat logic directly, producing a smaller bundle (10.4 → 9.4 KB uncompressed).

Four benchmarks are now the **absolute fastest of all 18 implementations** including vanilla JS: partial update (1.00×), select row (1.00×), swap rows (1.00×), and remove row (1.00×). The remaining gap to vanilla JS is almost entirely in bulk creation (create rows 1.09×, create many 1.18×) where per-row reconciler overhead is irreducible without fundamental architectural changes.

**The main remaining gap is test coverage.** With event delegation, direct updates, AST utilities, and template-utils all untested, the codebase has more critical infrastructure riding on the benchmark as its sole validation. The 3.5/10 test score is the single biggest drag on the overall rating and the single biggest risk for production readiness.

At 8.5/10 overall (weighted calculation: 8.38), Thane v0.0.25 maintains the score of v0.0.8 while delivering significant performance and architectural improvements. The score doesn't increase because the new untested surface area offsets the gains — the ceiling for reaching 9/10 requires comprehensive test coverage. The path to 9/10 runs through: test coverage (the blocker), signal batching, reconciler LIS optimization, and `ctx.props` reactivity.

