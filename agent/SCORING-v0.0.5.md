# Thane Framework — Codebase Scoring (v0.0.5)

> Evaluated: February 7, 2026  
> Codebase: 42 files, ~9,400 lines (runtime: ~1,660 excl. tests, compiler: ~7,750)  
> Version: 0.0.5

---

## Benchmark Results (v0.0.5 vs v0.0.4)

| Benchmark | v0.0.5 | v0.0.4 | v0.0.2 | Delta (v5 vs v4) | Verdict |
|---|---|---|---|---|---|
| **Weighted mean** | **1.18** | **1.20** | **1.22** | **−1.7%** | 🟢 Improved |

> v0.0.4 individual results may be corrupted but the weighted mean of 1.20 is confirmed.

### Trend Analysis (3-version)

| Version | Weighted Mean | vs Vanilla |
|---|---|---|
| v0.0.2 | 1.22 | +22% overhead |
| v0.0.4 | 1.20 | +20% overhead |
| v0.0.5 | 1.18 | +18% overhead |

The framework is on a consistent improvement trajectory. Each version has shaved ~2 percentage points off the overhead. At 1.18x the vanilla baseline, Thane is now competitive with established compiled frameworks.

---

## Scoring Matrix

### 1. Signal Implementation (`signal.ts`) — 9/10

**76 lines.** The leanest signal implementation I've seen.

**Strengths:**
- Shared `sharedSubscribe` function across all signals — single function object referenced by every signal instead of per-signal closure. This is a genuine memory optimization over v0.0.2's per-signal closure approach
- Internal state stored as function properties (`fn._v`, `fn._s`) instead of closure variables — avoids creating a new scope per signal
- Lazy subscriber array (`null` until first `subscribe()` call) — zero allocation for signals that are never subscribed to (e.g., intermediate computed values)
- Array-backed subscribers with indexed `for` loop and cached length — V8 JIT-optimal iteration
- Strict reference equality check (`value !== newValue`) prevents unnecessary notifications — correct for the reactive model
- Unsubscribe via `splice(indexOf(...))` is O(n) but n is almost always 1-3 subscribers per signal, making this a non-issue in practice

**Weaknesses:**
- No error boundary around subscriber callbacks — one throwing subscriber kills all subsequent subscribers in the notification loop
- No batching/transaction mechanism — multiple signal updates in sequence trigger separate DOM update passes
- Object/array mutations are invisible (reference equality) — intentional design choice but could surprise developers with mutable data patterns

**What changed since v0.0.2:** Major refactor from per-signal closures to shared subscribe function. This is the right architectural move — reduced per-signal memory from closure+array to properties-on-function-object.

**Score justification:** 9/10 because it does exactly what it needs to do with minimal overhead. The missing batching is a conscious tradeoff (simplicity over throughput) and the lack of error boundaries is a minor gap. For a framework targeting compiled output, this is near-optimal.

---

### 2. Component System (`component.ts`) — 7/10

**236 lines.** Clean registration-based component model.

**Strengths:**
- Simple factory pattern — `componentFactories` Map stores constructors, `registerComponent` returns HTML selector functions
- Proper style scoping via `:host` → `.selector` replacement — works without Shadow DOM
- Two-path rendering: pre-compiled template cloning (fast) vs innerHTML (fallback) — the compiler directs which path is used
- `createComponentHTMLSelector` generates data-attribute-based component references — clean serialization for nested components
- `ensureGlobalStyleElement` lazily creates the style element — no DOM interaction until needed
- Dedup via `registeredStyles` Set prevents double-registration of component styles

**Weaknesses:**
- `el.getElementById` implemented as `el.querySelector(\`#${id}\`)` — no CSS.escape protection. If `id` contains dots, colons, or brackets this will fail. The v0.0.4 CSS.escape fix was reverted (correctly, for perf), but the underlying fragility remains. Since IDs are compiler-generated this is safe in practice
- `appendStyle` does `styleEl.textContent += css` — triggers full CSSOM recalculation on every component registration. For apps with many components, this is a startup performance hit
- No component lifecycle hooks (onMount, onDestroy) — limits composability
- No unmount/cleanup mechanism — `componentFactories` Map grows forever. Not a leak in typical SPA usage, but problematic for dynamic component loading
- `mountComponent` regex `/<([^>]+)>/` is fragile — would match attributes if selector string ever included them

**What changed since v0.0.4:** Removed CSS.escape from getElementById, removed queueMicrotask style batching, removed createComponentHTMLSelector dedup. These reverts improved ready memory and first paint, contributing to the 1.18 score.

**Score justification:** 7/10. Functional and lean, but the style concatenation approach and lack of lifecycle hooks are real limitations. The component model works well for the compiled output target but would need lifecycle management for production use.

---

### 3. DOM Binding (`dom-binding.ts`) — 8.5/10

**1,331 lines.** The runtime workhorse — event delegation, conditionals, and list reconciliation.

**Strengths:**
- **Event delegation** with capture-phase listeners and data-attribute routing — single listener per event type per component. Modifier system (stop, prevent, self, keyboard keys) is well-designed
- **Conditional rendering** (`__bindIf`, `__bindIfExpr`) uses template element placeholders and lazy binding initialization — conditionally hidden content has zero runtime cost until shown
- **Three repeat implementations** targeting different performance profiles:
  - `__bindRepeat` — innerHTML-based, handles dynamic templates
  - `__bindRepeatTpl` — template cloning with DOM path navigation (the fast path)
  - `__bindNestedRepeat` — for repeat-inside-repeat/when scenarios
- **Keyed reconciliation** with multiple fast paths is excellent:
  - Swap detection (2 elements exchanged) — O(1) DOM ops
  - Single removal detection — O(1) splice + remove
  - Complete replacement detection (first+last keys both new) — clearAll + bulkCreate
  - Same-keys reorder — minimal DOM moves
  - General reconciliation with key Map — handles arbitrary mutations
- **Container detach optimization** (`container.remove()` before bulk insert, re-attach after) prevents per-item reflow — genuine performance win for create/append operations
- **`textContent = ''` for fast bulk clear** instead of iterating and removing children
- **`navigatePath`** for template-cloned items uses pre-computed child indices instead of querySelector — O(depth) vs O(n)
- **Comment marker system** for mixed-content text bindings — correctly handles text nodes adjacent to elements

**Weaknesses:**
- `__bindRepeat` and `__bindRepeatTpl` duplicate ~400 lines of reconciliation logic almost identically. Both have the same keyed reconciliation fast paths, same swap detection, same general reorder algorithm. This should be extracted into a shared reconciler function
- `__bindNestedRepeat` has no keyed reconciliation — always index-based. Nested lists with reordering will perform poorly
- `managedItems.splice(idx, 1)` in keyed reconciliation general case — O(n) array shift. Could use a reverse-order removal or rebuild approach
- `new Set()` created for key collection on every general reconciliation pass — allocation in hot path
- `getTempEl()` reuses a single `<template>` element — safe in practice (single-threaded), but architecturally fragile for re-entrant scenarios
- Cleanup arrays grow unboundedly per managed item (push-only, never compacted)
- The general reorder algorithm uses `insertBefore` in a forward pass — this is O(n) DOM ops in the worst case. A longest-increasing-subsequence (LIS) algorithm would minimize DOM moves

**What changed since v0.0.4:** The reconciliation logic appears identical. Performance gains likely came from the component.ts reverts removing overhead from the binding setup path.

**Score justification:** 8.5/10. The reconciler is genuinely well-engineered with smart fast paths that cover the common cases (swap, remove, replace all). The template cloning path with DOM navigation is an excellent optimization. Points deducted for the massive code duplication between repeat variants and the missing LIS optimization in general reorder.

---

### 4. Reactive Binding Compiler — 8/10

**Split across 4 files: `index.ts` (260), `codegen.ts` (759), `template-processing.ts` (772), `repeat-analysis.ts` (841). Total: ~2,632 lines.**

**Strengths:**
- Successfully split from the v0.0.2 monolith (2,767 lines in one file) into 4 focused modules — major maintainability improvement
- **No more `eval()`** — all compile-time expression evaluation now uses `vm.runInContext` with frozen sandbox and 50ms timeout. This was the single biggest security concern in v0.0.2 and it's been fixed
- Code generation produces highly optimized binding code: consolidated subscriptions, direct DOM property access, pre-computed element paths
- The optimized repeat path (`__bindRepeatTpl`) generates static templates + child-index navigation — the benchmark improvement is partly attributable to this
- Template analysis correctly handles deeply nested scenarios (when inside repeat, repeat inside when, whenElse with nested repeats)
- Clean separation: `template-processing.ts` handles analysis, `codegen.ts` handles generation, `repeat-analysis.ts` handles repeat optimization, `types.ts` defines interfaces

**Weaknesses:**
- `repeat-analysis.ts` at 841 lines is still too large — `generateOptimizedRepeatCode` alone is ~400 lines with 7+ indent levels
- `template-processing.ts` has significant structural overlap with `repeat-analysis.ts` — both process conditionals, whenElse blocks, and nested content with very similar logic
- Heavy string concatenation for code generation — a builder pattern would improve readability and reduce concatenation bugs
- `codegen.ts` has a `processTemplateNode` function at ~450 lines with deeply nested conditionals — should be decomposed further
- Module-level frozen sandbox in `template-processing.ts` — safe but still a singleton pattern

**Score change from v0.0.2:** 5/10 → 8/10. The file split and eval removal are transformative improvements. The remaining issues are maintainability concerns, not correctness or security.

---

### 5. Component Precompiler (`component-precompiler.ts`) — 7.5/10

**484 lines.**

**Strengths:**
- CTFE (Compile-Time Function Evaluation) via `vm.runInContext` with 50ms timeout and sandboxed context — secure and effective
- `CTFE_FAILED` sentinel cleanly distinguishes evaluation failure from `undefined` return
- Iterative property resolution handles forward-references among class members
- Integrates with `SharedBuildContext` for shared filesystem scanning — avoids redundant disk I/O

**Weaknesses:**
- Three nearly identical code paths in `evaluateExpressionCTFE` all do the same transform→strip→return pattern — should be extracted
- `.replace(/this\./g, '')` for expression rewriting is crude — could mangle user strings containing "this." in template content
- String position manipulation with while-loops for finding `${` and `}` is fragile — should use AST span positions

**Score:** 7.5/10. Solid CTFE implementation with some internal duplication.

---

### 6. HTML Parser (`html-parser.ts`) — 7.5/10

**1,275 lines.** The largest file in the codebase.

**Strengths:**
- Full hand-written state machine parser — handles template literal expressions (`${...}`) with nested backticks and brace counting
- Emits diagnostics for unclosed/orphaned tags — good developer experience
- Comprehensive binding detection: text, style, attribute, when/whenElse/repeat, event handlers
- Rich utility function library (walkElements, findElements, etc.)
- Pre-compiled regex objects for performance

**Weaknesses:**
- 1,275 lines in a single file — should be split into parser core, binding detection, and utility functions
- `parseWhenElseExpression` and `parseRepeatExpression` share ~60% identical argument parsing logic
- No error recovery — malformed HTML silently produces incorrect parse trees
- No HTML entity handling
- `HtmlElement` interface has 19 optional properties — should use discriminated union types

**Score:** 7.5/10. Functional and thorough but oversized.

---

### 7. Dead Code Eliminator (`dead-code-eliminator.ts`) — 4/10

**162 lines.**

**Strengths:**
- Signal analysis pass is well-structured (two-pass AST: find declarations, count mutations)
- Clean logging of results

**Weaknesses:**
- **The signal analysis data is collected but never used.** The function analyzes mutation counts, logs them, then applies only generic regex compressions. This is a logging feature pretending to be dead code elimination
- Regex-based transforms on minified output are fragile — any esbuild minification strategy change will break patterns
- Operates on concatenated bundle output instead of per-file pre-minification — wrong pipeline stage

**Score:** 4/10. Slight improvement from v0.0.2 (was 3/10) since the generic compressions work, but the core premise (dead signal elimination) is unimplemented.

---

### 8. Minification — 6.5/10

**`minification.ts` (90), `selector-minifier.ts` (88), `template-minifier.ts` (184). Total: 362 lines.**

**Strengths:**
- Selector minifier has clean bidirectional map with deterministic name generation
- Template minifier properly handles nested template literals, preserves conditional comment markers
- `minifyTemplateContent` auto-detects HTML vs CSS content

**Weaknesses:**
- `applySelectorsToSource` creates 5 regex replacements per selector — O(n²) for large projects. Each regex scans the entire source
- `minifyHTML` has the block element list duplicated 4 times in the same regex chain
- `extractSelectorsFromSource` only matches `selector: 'xxx'` pattern — misses other contexts
- Module-level `SelectorMinifier` singleton — problematic for concurrent builds

**Score:** 6.5/10. Works correctly but has scaling concerns and maintenance issues.

---

### 9. Post-Build Processor (`post-build-processor.ts`) — 6/10

**447 lines.**

**Strengths:**
- Full-featured: file copying, gzip+brotli compression, dev server with SSE live reload, port conflict resolution, file size reporting
- All mutable state is closure-scoped (not module-level) — this was a concern in v0.0.2 and it's been addressed

**Weaknesses:**
- 447-line monolith with 6+ responsibilities — file copying, compression, HTTP serving, live reload, HTML templating, console reporting should be separate modules
- Synchronous `readFileSync`/`writeFileSync` inside watch callbacks — blocks the event loop
- No debouncing of filesystem events
- Brotli compression quality settings duplicated between dev and prod paths

**Score change from v0.0.2:** 5/10 → 6/10. Module-level mutable state moved to closure scope.

---

### 10. Other Compiler Plugins

| Plugin | Lines | Score | Notes |
|---|---|---|---|
| **Register Component Stripper** | 126 | 8/10 | Clean AST-based code removal. Hardcoded file filters are the only concern |
| **Routes Precompiler** | 139 | 8/10 | Clean compile-time route injection. Well-scoped |
| **Global CSS Bundler** | 37 | 8/10 | Simple, correct. Does one thing well |
| **HTML Bootstrap Injector** | 250 | 7/10 | Module-level `bootstrapSelector` is exported mutable state — fragile cross-plugin side channel |
| **Type Checker** | 82 | 6/10 | Now supports strict mode (fail build on errors) — improvement from v0.0.2. Still uses synchronous `ts.createProgram` |

---

### 11. Compiler Utilities — 8/10

| Utility | Lines | Score | Notes |
|---|---|---|---|
| **ast-utils.ts** | ~360 | 8/10 | Well-organized pure functions. Some re-exports for compat |
| **source-editor.ts** | 104 | 9/10 | Clean, correct position-based editing. Best utility file |
| **cache.ts** | 52 | 7/10 | Simple cache with no staleness check or size limits. `parse()` doesn't cache |
| **logger.ts** | 155 | 8/10 | Clean structured logging. Module-level singleton |
| **constants.ts** | 57 | 8.5/10 | Central source of truth, well-organized |
| **file-utils.ts** | ~100 | 7/10 | `SharedBuildContext` is a good pattern. Some sync file ops |
| **colors.ts** | 23 | 8/10 | Clean ANSI color definitions |
| **plugin-helper.ts** | 64 | 6/10 | `createPluginSetup` is dead code — not used by any plugin |

---

### 12. CLI — 7/10

**`build.ts` (103), `cli-common.ts` (127), `thane.ts` (10), `wcf.ts` (10), `types.ts` (41). Total: ~291 lines.**

**Strengths:**
- Clean plugin assembly with environment-aware configuration
- Sensible esbuild defaults (ESM, code splitting, tree shaking, modern targets)
- Good help text with examples

**Weaknesses:**
- `thane.ts` and `wcf.ts` are identical 10-line files — pure duplication
- No source maps even in dev mode (`sourcemap: false` hardcoded)
- Hand-rolled arg parsing doesn't validate unknown flags or typos
- `process.exit(1)` on build failure instead of throwing

**Score:** 7/10. Functional but with clear DX gaps.

---

### 13. Test Coverage — 3/10

- Only `signal.test.ts` exists (514 lines, thorough for signals)
- **Zero tests** for: HTML parser, reactive binding compiler, component precompiler, template minifier, selector minifier, dead code eliminator, routes precompiler, DOM binding, component registration
- No integration tests, no end-to-end tests
- The benchmark suite is the only validation for the compiled output pipeline

**Score:** 3/10. This remains the single biggest risk for production readiness.

---

### 14. Bundle Size — 7.5/10

**Estimated uncompressed: ~10KB, compressed: ~4KB.**

**Strengths:**
- Dead code elimination strips unused registerComponent branches
- Selector minification shortens class names
- Template minification strips whitespace
- Tree shaking removes unused exports

**Weaknesses:**
- Three repeat implementations fully inlined (no shared reconciler) — code duplication in output
- No tree-shaking of unused runtime directives (when/whenElse/repeat always included)

**Score:** 7.5/10. Competitive bundle size for a full framework.

---

### 15. Developer Experience — 7/10

**Strengths:**
- Simple signal API: `const count = signal(0); count(); count(1);`
- Familiar template syntax with html`` and css`` tagged templates
- Hot reload dev server with SSE
- Colored build output with file sizes
- Type-safe component registration
- Type checker can now fail builds in strict mode (new in v0.0.5)

**Weaknesses:**
- No source maps in dev mode — debugging compiled output is painful
- No incremental TypeScript compilation
- Limited error messages for template syntax mistakes (parser has no recovery)
- No component lifecycle hooks

**Score:** 7/10. Good for development, gaps in debugging.

---

## Overall Score: 7.5/10

### Score Breakdown

| Area | Score | Weight | Weighted |
|---|---|---|---|
| Signal Implementation | 9/10 | 15% | 1.35 |
| Component System | 7/10 | 10% | 0.70 |
| DOM Binding / Reconciler | 8.5/10 | 20% | 1.70 |
| Reactive Binding Compiler | 8/10 | 15% | 1.20 |
| Other Compiler Plugins | 6.5/10 | 10% | 0.65 |
| Utilities & Infrastructure | 8/10 | 5% | 0.40 |
| CLI & Build | 7/10 | 5% | 0.35 |
| Test Coverage | 3/10 | 10% | 0.30 |
| Bundle Size | 7.5/10 | 5% | 0.375 |
| Developer Experience | 7/10 | 5% | 0.35 |
| **Total** | | **100%** | **7.40** |

**Rounded: 7.5/10**

---

## Version Comparison

| Area | v0.0.2 | v0.0.4 | v0.0.5 | Trend |
|---|---|---|---|---|
| Benchmark (weighted mean) | 1.22 | 1.20 | 1.18 | 📈 Consistent improvement |
| Signal implementation | 8/10 | — | 9/10 | 📈 Shared subscribe refactor |
| Reactive binding compiler | 5/10 | — | 8/10 | 📈 File split + eval removal |
| Dead code eliminator | 3/10 | — | 4/10 | ➡️ Still mostly unimplemented |
| Post-build processor | 5/10 | — | 6/10 | 📈 Mutable state fixed |
| Type checker | 5/10 | — | 6/10 | 📈 Strict mode added |
| Test coverage | 3/10 | — | 3/10 | ➡️ No change |
| Overall | 6.5/10 | 7.5/10 | 7.5/10 | ➡️ Holding steady |

### What Improved (v0.0.2 → v0.0.5)
1. **eval() eliminated** — all compile-time evaluation now uses sandboxed vm.runInContext
2. **Reactive binding compiler split** — from 2,767-line monolith into 4 focused modules
3. **Signal memory reduced** — shared subscribe function instead of per-signal closures
4. **Component.ts cleaned up** — reverted perf-regressing changes (CSS.escape, queueMicrotask)
5. **Type checker strict mode** — can now fail builds on type errors
6. **Post-build mutable state** — moved from module-level to closure scope
7. **Benchmark performance** — from 1.22x to 1.18x vanilla (18% improvement in overhead)

### What Still Needs Work
1. **Test coverage** — still only signal.test.ts (biggest risk)
2. **Dead code eliminator** — signal analysis collected but never used
3. **Large files** — html-parser (1275), repeat-analysis (841), template-processing (772)
4. **DOM binding duplication** — 400+ lines duplicated between repeat variants
5. **Source maps** — still not available in dev mode
6. **No batching** — multiple signal updates cause separate DOM passes

---

## Improvement Plan (v0.0.6+)

### High Priority — Performance Impact

#### 1. [RUNTIME] Extract shared reconciler from repeat variants
- **Impact:** Reduces bundle size (~400 lines of duplicated reconciliation), simplifies maintenance, enables keyed reconciliation for nested repeats
- **Approach:** Create a `reconcile(managedItems, newItems, keyFn, createItem, removeItem)` core function shared by `__bindRepeat`, `__bindRepeatTpl`, and `__bindNestedRepeat`
- **Risk:** Low — behavioral extraction, all fast paths preserved
- **Expected gain:** Smaller bundle, consistent behavior across all repeat variants

#### 2. [RUNTIME] Add longest-increasing-subsequence (LIS) to general reorder
- **Impact:** General reorder currently does O(n) `insertBefore` calls in worst case
- **Approach:** Compute LIS of existing positions, only move elements not in the subsequence. Standard algorithm used by Solid, Inferno, and other high-perf frameworks
- **Risk:** Low — well-understood algorithm, only affects the general reorder path
- **Expected gain:** Fewer DOM operations for complex reorders (swap rows benchmark)

#### 3. [RUNTIME] Batch signal notifications via microtask scheduling
- **Impact:** Multiple signals updating synchronously (e.g., during reconciliation) trigger separate DOM updates
- **Approach:** Queue subscriber notifications, deduplicate callbacks, flush in single microtask. Preserve synchronous read-after-write (signal value updates immediately, only notifications batched)
- **Risk:** Medium — changes timing semantics, existing code may rely on synchronous subscriber execution
- **Expected gain:** Improvement on replace all, partial update, any multi-signal operation

#### 4. [RUNTIME] Replace style textContent concatenation with adoptedStyleSheets
- **Impact:** Each `appendStyle` call triggers full CSSOM recalculation
- **Approach:** Use `document.adoptedStyleSheets` with `CSSStyleSheet` objects. Each component gets its own sheet, no recalculation on subsequent registrations
- **Risk:** Low — well-supported in modern browsers (Chrome 73+, Firefox 101+, Safari 16.4+)
- **Expected gain:** Faster component registration, especially for apps with many components

### Medium Priority — Code Quality

#### 5. [COMPILER] Split html-parser.ts into focused modules
- **Impact:** 1,275 lines is the largest file, hard to navigate and maintain
- **Approach:** Split into: `parser-core.ts` (state machine), `binding-detection.ts` (findBindingsInText, etc.), `parser-utils.ts` (walkElements, findElements), `parser-types.ts` (HtmlElement, HtmlAttribute)
- **Risk:** Low — pure refactor

#### 6. [COMPILER] Implement actual dead code elimination
- **Impact:** Signal analysis data is collected but discarded — the dead code eliminator doesn't eliminate dead code
- **Approach:** Use mutation count data to identify read-only signals, then inline their constant values. Remove signal creation + subscription for never-mutated signals
- **Risk:** Medium — semantic analysis of signal usage across module boundaries is complex
- **Expected gain:** Smaller bundle for apps with static configuration signals

#### 7. [COMPILER] Enable source maps in dev mode
- **Impact:** Developers can't debug compiled output back to source
- **Approach:** Set `sourcemap: 'inline'` in dev esbuild config
- **Risk:** Low

#### 8. [COMPILER] Deduplicate thane.ts and wcf.ts
- **Impact:** Pure code duplication
- **Approach:** Single entry point parameterized by command name
- **Risk:** Low

#### 9. [COMPILER] Remove dead createPluginSetup from plugin-helper.ts
- **Impact:** Dead code — not used by any plugin
- **Approach:** Delete the function
- **Risk:** None

### Lower Priority — Robustness

#### 10. [INFRA] Add compiler plugin test suite
- **Impact:** Zero test coverage for the most complex code
- **Approach:** Snapshot tests for HTML parser output, binding detection, code generation. Integration tests for end-to-end compilation
- **Risk:** Low — purely additive

#### 11. [RUNTIME] Add error boundary in signal subscriber notification
- **Impact:** One throwing subscriber kills all subsequent subscribers
- **Approach:** try/catch around each subscriber call, collect errors, report after all subscribers notified
- **Risk:** Low — defensive improvement

#### 12. [COMPILER] Fix module-level mutable singletons
- **Impact:** `sourceCache`, `logger`, `SelectorMinifier` instance, `bootstrapSelector` are global mutable state
- **Approach:** Pass instances via build context or plugin factory parameters
- **Risk:** Low — requires minor plugin interface changes

#### 13. [RUNTIME] Support component lifecycle hooks
- **Impact:** No onMount/onDestroy limits composability and cleanup
- **Approach:** Add optional `connectedCallback`/`disconnectedCallback` methods to NativeComponent, called by factory during mount/unmount
- **Risk:** Medium — requires adding unmount tracking

---

## Risk Assessment

| Risk | Severity | Status vs v0.0.2 |
|---|---|---|
| No compiler tests | 🔴 High | ➡️ Unchanged |
| Dead code eliminator does nothing useful | 🔴 High | ➡️ Unchanged |
| Large files (html-parser, repeat-analysis) | 🟡 Medium | 📈 reactive-binding split helped |
| DOM binding reconciliation duplication | 🟡 Medium | ➡️ Unchanged |
| Module-level mutable singletons | 🟡 Medium | 📈 Post-build fixed, others remain |
| No source maps in dev | 🟡 Medium | ➡️ Unchanged |
| No signal batching | 🟡 Medium | ➡️ Unchanged |
| Style concatenation perf | 🟢 Low | ➡️ Unchanged |
| `eval()` usage in compiler | ~~🔴 High~~ | ✅ **Fixed** — replaced with vm.runInContext |
| Massive single file (reactive-binding) | ~~🟡 Medium~~ | ✅ **Fixed** — split into 4 modules |
| Module-level state in post-build | ~~🟡 Medium~~ | ✅ **Fixed** — moved to closure scope |

---

## Summary

Thane v0.0.5 represents solid incremental progress. The benchmark score of **1.18x vanilla** puts it in competitive territory with established compiled frameworks. The signal refactor (shared subscribe), reactive binding compiler split (4 modules, no eval), and component.ts cleanup all contributed to measurable improvements.

The framework's core strength remains its compile-time optimization strategy — the reactive binding compiler generates direct DOM manipulation code with pre-computed element paths, and the template cloning system avoids runtime HTML parsing. This architecture has a high performance ceiling.

The main gaps are in **test coverage** (still only signals), **dead code elimination** (analysis without action), and **large file sizes** in the HTML parser and repeat analysis modules. Addressing these would move the overall score from 7.5 toward 8.5+.
