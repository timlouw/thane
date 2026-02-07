# Thane v0.0.5 — Improvement Plan

> Created: February 7, 2026
> Baseline: v0.0.4 (weighted mean 1.20)

---

## Phase 1 — Runtime Performance

### 1. [RUNTIME] Revert component.ts — remove CSS.escape and queueMicrotask batching, keep createComponentHTMLSelector dedup

**What to revert:**
- `CSS.escape(id)` back to raw `id` in `NativeComponent.getElementById` — this runs on every binding lookup and is unnecessary since the compiler generates safe IDs
- `queueMicrotask` style batching (`pendingStyles`, `flushPendingStyles`, `queueStyle`) — revert to direct `styleEl.textContent += css` on each `registerGlobalStyles` / `registerComponent` call

**What to keep:**
- `createComponentHTMLSelector<T>()` dedup — `registerComponent` calling the shared function instead of inlining the logic, and `generateComponentHTML` delegating to it. This is a pure code organization improvement with no perf impact (same code runs either way)

**Files:** `src/runtime/component.ts`

---

### 2. [RUNTIME] Prototype-based signal to reduce per-signal memory

**Problem:** Each `signal()` call creates a fresh closure with its own `subscribe` function object. With 1,000 rows × N signals per row, that's thousands of duplicate function allocations. Ready memory is at 1.27x.

**Approach:** Move `subscribe` to a shared prototype so all signals reference a single function object. The per-signal state (value, subscribers) would be stored on the function object itself as properties rather than closure variables.

Sketch:
```
function SignalProto() {}
SignalProto.prototype.subscribe = function(cb, skipInitial) { ... uses this._v, this._s ... }

signal<T>(init) {
const fn = function(newVal?) { ... reads/writes fn._v, fn._s ... }
Object.setPrototypeOf(fn, SignalProto.prototype)
fn._v = init
fn._s = null
return fn
}
```



**Trade-offs:**
- ✅ One `subscribe` function shared across all signals instead of N closures
- ✅ Lower memory per signal (closure variables become properties on the function object)
- ⚠️ `Object.setPrototypeOf` on a function is unusual — need to verify V8 doesn't deoptimize. Alternative: just assign `fn.subscribe = sharedSubscribe` where `sharedSubscribe` uses `this`
- ⚠️ Properties like `_v` and `_s` are now visible/enumerable — could use symbols or non-enumerable descriptors, but that adds overhead
- ⚠️ Must benchmark carefully — if V8 treats the function differently after prototype change, the hot path (signal get/set) could regress

**Files:** `src/runtime/signal.ts`, `src/runtime/types.ts`

---

## Phase 2 — Benchmark & Investigate

### 3. [RUNTIME] Investigate create rows bottleneck — template cloning is already in use

**Finding:** The benchmark's compiled output already uses `__bindRepeatTpl` (template cloning path) with pre-compiled `__tpl_b0`, element navigation paths, and `fillItem`/`initItemBindings`. The create 1k regression (1.29x) is **not** caused by innerHTML-per-item.

**Actual bottleneck candidates to profile:**
- `signal()` creation per row (1,000 closure allocations) — partially addressed by item 2
- `CSS.escape()` in every `getElementById` call during binding init — addressed by item 1
- `container.remove()` / `parentNode.insertBefore()` detach-reattach pattern — is this actually faster than just inserting while attached?
- `cloneNode(true)` on the template content — is the template complex enough that cloning is expensive?
- `keyMap.set()` per item during initial bulk create — Map insertion overhead

**Action:** After items 1 and 2 are implemented, re-benchmark. If create 1k is still weak, do targeted V8 profiling of `bulkCreate` → `createItem` to find the hotspot.

**Files:** Investigation only, no code changes yet

---

## Phase 3 — Compiler Cleanup

### 4. [COMPILER] Split reactive-binding-compiler.ts into sub-modules (Approach C)

**Current state:** 2,758 lines in a single file with ~3 copies of nested conditional-processing logic.

**Strategy:** Deduplicate first, then layer what remains. A shared `processConditionals()` function replaces the 3 near-identical copies currently in `processHtmlTemplateWithConditionals`, `processSubTemplateWithNesting`, and `processItemTemplateRecursively`.

**Proposed split:**

| Module | Contents | ~Lines |
|---|---|---|
| `types.ts` | `ConditionalBlock`, `WhenElseBlock`, `RepeatBlock`, `ItemBinding`, `ItemEvent`, `EventBinding`, `BindingInfo`, `StaticRepeatTemplate`, `OptimizationSkipReason` | ~100 |
| `template-processing.ts` | **Single** deduplicated `processConditionals()` function, `processConditionalElementHtml`, `addIdsToNestedElements`, `replaceExpressionsWithValues`, `safeEvaluateCondition` | ~400 |
| `repeat-analysis.ts` | `processItemTemplate`, `processItemTemplateRecursively`, `analyzeTextBindingContext` — calls into `template-processing.ts` for nested conditionals | ~350 |
| `codegen.ts` | All `generate*` functions: `generateProcessedHtml`, `generateBindingUpdateCode`, `generateInitialValueCode`, `groupBindingsBySignal`, `generateConsolidatedSubscription`, `generateInitBindingsFunction`, `generateStaticTemplate`, `generateStaticRepeatTemplate`, `generateUpdatedImport`, `getOptimizationSkipMessage` | ~750 |
| `transform.ts` | `transformComponentSource`, `processHtmlTemplateWithConditionals` (orchestrator), `findServicesImport`, `isThaneRuntimeImport`, `findHtmlTemplates` | ~300 |
| `index.ts` | Plugin factory, re-exports | ~30 |

**Dependency flow:** `types` ← `template-processing` ← `repeat-analysis` ← `codegen` ← `transform` ← `index`

**Files:** `src/compiler/plugins/reactive-binding-compiler/`

---

### 5. [COMPILER] Deduplicate thane.ts and wcf.ts CLI entry points

**Approach:** Extract shared `parseArgs`, `printHelp`, `main` logic into a `cli-common.ts` module. Both `thane.ts` and `wcf.ts` call the shared function with their respective name/defaults.

**Files:** `src/compiler/cli/thane.ts`, `src/compiler/cli/wcf.ts`, new `src/compiler/cli/cli-common.ts`

---

### 6. [COMPILER] Deduplicate constants between ast-utils.ts and constants.ts

**Problem:** `RUNTIME_FUNCTIONS`, `HTML_TAG_FUNCTIONS`, `SIGNAL_FUNCTION_NAME`, `SIGNAL_MODULE_SPECIFIER` are defined in both files. `constants.ts` has additional entries (`COMPONENT_REGISTER_FUNCTION`, `ROUTES_REGISTER_FUNCTION`).

**Approach:** Keep all canonical definitions in `constants.ts`. In `ast-utils.ts`, import from `constants.ts` instead of redeclaring.

**Files:** `src/compiler/utils/ast-utils.ts`, `src/compiler/utils/constants.ts`

---

### 7. [COMPILER] Make type checker configurable — option to fail build on errors

**Approach:** Add `strictTypeCheck?: boolean` to `BuildConfig` in `src/compiler/cli/types.ts`. In `tsc-type-checker.ts`, when `strictTypeCheck` is true and diagnostics contain errors, throw or return a failing result to abort the build. Default to `false` for backward compatibility.

**Files:** `src/compiler/cli/types.ts`, `src/compiler/plugins/tsc-type-checker/tsc-type-checker.ts`, `src/compiler/cli/build.ts` (pass config through)

---

### 8. [COMPILER] Share filesystem scan results between plugins

**Problem:** `componentPrecompiler` and `htmlBootstrapInjector` both independently call `walkDirectory` on `src/` and `apps/` during `onStart`.

**Approach:** Add a shared `BuildContext` object passed to all plugins. Run the filesystem scan once in `build.ts` before plugin setup, store results on the context. Plugins read from context instead of scanning.

**Files:** `src/compiler/cli/build.ts`, `src/compiler/plugins/component-precompiler/component-precompiler.ts`, `src/compiler/plugins/html-bootstrap-injector/html-bootstrap-injector.ts`, new shared context type

---

### 9. [COMPILER] Wire up ErrorCode enum to actual plugin diagnostics

**Problem:** `ErrorCode` enum with 12 codes is defined in `errors.ts` but no plugin uses them. Plugins use `console.error` or `logger.error` with free-form strings.

**Approach:** Audit each plugin's error/warning output, map to appropriate `ErrorCode`, replace with `createError(message, location, ErrorCode.XXX)` calls. Update `logger` to accept `Diagnostic` objects directly.

**Files:** `src/compiler/errors.ts`, all plugin files that emit errors/warnings

---

### 10. [COMPILER] Fix module-level mutable state in plugins

**Problem:** Three cases of shared mutable state at module scope:
- `SelectorMinifier` instance in `minification.ts`
- `bootstrapSelector` in `html-bootstrap-injector.ts`
- `isRunning` flag in `tsc-type-checker.ts`

**Approach:** Move each into the plugin factory's closure scope so each plugin instantiation gets its own state.

**Files:** `src/compiler/plugins/minification/minification.ts`, `src/compiler/plugins/html-bootstrap-injector/html-bootstrap-injector.ts`, `src/compiler/plugins/tsc-type-checker/tsc-type-checker.ts`

---

## Execution Order

| Phase | Items | Type | Risk |
|---|---|---|---|
| **Phase 1** | 1, 2 | Runtime perf | Low–Medium |
| **Phase 2** | 3 | Investigation | None |
| **Phase 3** | 4, 5, 6, 7, 8, 9, 10 | Compiler cleanup | Low |