# Thane Framework — Codebase Scoring (v0.0.4)

> Evaluated: February 7, 2026
> Codebase: 37 files, ~10,500 lines (runtime: ~1,830 excl. tests, compiler: ~8,000)

---

## Benchmark Results (v0.0.4 vs v0.0.2)

| Benchmark | v0.0.4 | v0.0.2 | Delta | Verdict |
|---|---|---|---|---|
| Create 1k rows | 46.2ms (1.29) | 43.1ms (1.20) | +7.2% | 🔴 Regressed |
| Replace all rows | 49.9ms (1.18) | 49.5ms (1.17) | +0.8% | 🟡 Flat |
| Partial update | 39.0ms (1.30) | 40.9ms (1.36) | **−4.6%** | 🟢 Improved |
| Select row | 8.6ms (1.04) | 9.5ms (1.14) | **−9.5%** | 🟢 Improved |
| Swap rows | 34.8ms (1.17) | 36.2ms (1.21) | **−3.9%** | 🟢 Improved |
| Remove row | 26.7ms (1.16) | 27.6ms (1.19) | **−3.3%** | 🟢 Improved |
| Create 10k rows | 489.8ms (1.21) | 492.5ms (1.21) | −0.5% | 🟡 Flat |
| Append 1k rows | 53.2ms (1.14) | 55.8ms (1.20) | **−4.7%** | 🟢 Improved |
| Clear rows | 28.8ms (1.19) | 31.4ms (1.29) | **−8.3%** | 🟢 Improved |
| **Weighted mean** | **1.20** | **1.22** | **−1.6%** | 🟢 Better |
| Ready memory | 0.62MB (1.27) | 0.57MB (1.16) | +9.5% | 🔴 Regressed |
| Run memory | 3.45MB (1.78) | 3.41MB (1.76) | +1.2% | 🟡 Flat |
| First paint | 187.8ms (1.40) | 164.3ms (1.23) | +14.3% | 🔴 Regressed |

### Key Observations
- v0.0.4 has the best weighted geometric mean of all three versions (1.20)
- 6 of 9 duration benchmarks improved vs v0.0.2, select row improved significantly
- Create 1k rows regressed — this is the initial render path (innerHTML parsing + binding setup)
- Ready memory and first paint regressed — likely caused by component.ts changes (queueMicrotask batching, CSS.escape)
- The runtime code is essentially identical to v0.0.2 except: CSS.escape in getElementById, queueMicrotask style batching, createComponentHTMLSelector dedup, keyFn param on __bindNestedRepeat

---

## Scoring Matrix

### 1. Runtime Performance — 7.5/10

**Strengths:**
- Signal implementation is extremely lean (~68 lines, zero dependencies)
- Array-backed subscribers with indexed for-loop — optimal for V8 JIT
- No unnecessary allocations in hot paths (signal get/set)
- DOM reconciler has excellent fast paths: swap detection, bulk replace detection, single-remove detection
- Container detach optimization for bulk insertions prevents per-item reflow
- Template cloning path (`__bindRepeatTpl`) avoids innerHTML parsing per item
- Event delegation avoids per-element listener overhead
- `textContent = ''` for fast bulk clear

**Weaknesses:**
- Create 1k rows at 1.29x slowdown — innerHTML parsing + signal creation per row is the bottleneck
- Ready memory at 1.27x — each signal creates a closure + array overhead
- No subscriber notification batching (multiple signals changing in sequence cause separate DOM updates)
- `CSS.escape()` called in getElementById hot path — adds overhead to every binding lookup
- Reconciler creates `new Set()` for key collection on every general reconciliation
- `managedItems.splice(idx, 1)` in general keyed reconciliation — O(n) array shift
- Cleanup arrays grow unboundedly per item (push-only)

### 2. Compiler Architecture — 8/10

**Strengths:**
- Clean esbuild plugin architecture with clear sequential pipeline
- Compile-time function evaluation (CTFE) for component calls — eliminates runtime overhead
- Sophisticated reactive binding compiler generates optimal subscription code
- Template pre-compilation with DOM navigation paths eliminates runtime querySelector
- Source file caching across plugins prevents redundant I/O and parsing
- Custom HTML parser purpose-built for template syntax with proper diagnostics

**Weaknesses:**
- Reactive binding compiler is 2,758 lines in a single file — maintenance risk
- Duplicate filesystem scans (component-precompiler and html-bootstrap-injector both scan src/)
- Duplicate constants across ast-utils.ts and constants.ts
- CLI files thane.ts and wcf.ts are near-identical copies
- Module-level mutable state in several plugins (minification, bootstrap injector, type checker)
- Pipeline directory is empty (referenced in structure but no files exist)
- Type checker doesn't fail the build on errors — silent type violations get bundled
- ErrorCode enum defined but never used by any plugin

### 3. Code Quality & Documentation — 8/10

**Strengths:**
- Consistent JSDoc documentation on all public APIs
- Well-typed interfaces (Signal, ComponentConfig, Diagnostic, etc.)
- Clean error handling patterns with graceful fallbacks
- Comprehensive test suite for signals (49 tests, 103 assertions)
- Clear separation: runtime knows nothing about the compiler
- Proper TypeScript strict mode

**Weaknesses:**
- No tests for compiler plugins, dom-binding, or component
- Reactive binding compiler has significant internal code duplication (~3 copies of nested conditional handling)
- Template minifier's inline element detection uses hardcoded block-element list
- Blunt backtick replacement pattern (`.replace(/\x60/g, '\`')`) used across plugins could corrupt strings

### 4. Bundle Size — 7/10

**Strengths:**
- Uncompressed 10.1KB, compressed 4.0KB — competitive
- Dead code elimination strips unused registerComponent branches
- Selector minification shortens class names
- Template minification strips whitespace

**Weaknesses:**
- Slightly larger than v0.0.2 (10.1 vs 9.9KB uncompressed) — queueMicrotask/CSS.escape additions
- Three repeat implementations are fully inlined (no shared reconciler) — code duplication in output
- No tree-shaking of unused runtime exports (when/whenElse/repeat always included)

### 5. Developer Experience — 7/10

**Strengths:**
- Simple signal API: `const count = signal(0); count(); count(1);`
- Familiar template syntax with html`` and css`` tagged templates
- Hot reload dev server with SSE
- Colored build output with file sizes
- Type-safe component registration

**Weaknesses:**
- No source maps in dev mode
- Type checker errors don't fail the build
- No incremental TypeScript compilation (full program created each time)
- CLI argument parsing doesn't validate values
- Limited content type support in dev server

---

## Overall Score: 7.5/10

The framework demonstrates strong engineering fundamentals with a sophisticated compile-time optimization strategy. The runtime is lean and fast, competitive at 1.20x the vanilla JS baseline. The main gaps are in the create/initial-render path, memory overhead per signal, and compiler maintainability.

---

## Improvement Plan (v0.0.5+)

Improvements are categorized: **[RUNTIME]** changes affect benchmark performance, **[COMPILER]** changes affect build quality/DX, **[INFRA]** changes affect maintainability.

### High Priority — Performance Impact

#### 1. [RUNTIME] Revert component.ts to v0.0.2 (remove CSS.escape, queueMicrotask batching, createComponentHTMLSelector dedup)
- **Impact**: Ready memory regressed +9.5%, first paint regressed +14.3%
- **Approach**: Revert all three component.ts changes — CSS.escape adds cost to every getElementById call in the hot path, queueMicrotask adds startup overhead, createComponentHTMLSelector dedup changes call patterns
- **Risk**: Low — straightforward revert
- **Expected gain**: Restore v0.0.2 ready memory (0.57→0.62MB) and first paint (164→188ms)

#### 2. [RUNTIME] Batch signal notifications with microtask scheduling
- **Impact**: When multiple signals update synchronously (e.g., during reconciliation), each triggers separate DOM updates
- **Approach**: Queue subscriber notifications, deduplicate callbacks, flush in a single microtask. Must preserve synchronous read-after-write semantics (signal value updates immediately, only notifications are batched)
- **Risk**: Medium — changes timing semantics, may break assumptions about synchronous subscriber execution
- **Expected gain**: Improvement on replace all, partial update, any multi-signal update operation

#### 3. [RUNTIME] Reduce per-signal memory allocation
- **Impact**: Ready memory at 1.27x, run memory at 1.78x
- **Approach**: Explore alternatives — WeakMap-backed state, shared subscriber registry indexed by signal ID, or prototype-based signal objects instead of per-instance closures
- **Risk**: High — fundamental signal architecture change, must not regress hot-path performance
- **Expected gain**: Lower memory footprint across all benchmarks

#### 4. [RUNTIME] Optimize create rows — ensure template cloning path is used
- **Impact**: Create 1k at 1.29x is the weakest benchmark
- **Approach**: Verify the benchmark app's repeat directive compiles to `__bindRepeatTpl` (template cloning) rather than `__bindRepeat` (innerHTML per item). If it already does, profile to identify the actual bottleneck in the create path
- **Risk**: Low — compiler-side investigation
- **Expected gain**: Template cloning is ~2-3x faster than innerHTML parsing per item

#### 5. [RUNTIME] Use flat parallel arrays for managed items instead of object-per-item
- **Impact**: Object allocation per managed item ({itemSignal, el, cleanups}) creates GC pressure at scale
- **Approach**: Store item data in parallel typed arrays: signals[], elements[], cleanups[][] indexed by position. Reduces object count and improves cache locality
- **Risk**: Medium — more complex code, harder to maintain
- **Expected gain**: Lower GC pressure, better memory utilization for large lists

### Medium Priority — Build Quality & DX

#### 6. [COMPILER] Split reactive-binding-compiler.ts into sub-modules
- **Impact**: 2,758 lines is a maintenance risk, code duplication within the file
- **Approach**: Extract into: analysis.ts (template parsing, binding detection), codegen.ts (code generation), repeat-codegen.ts (repeat-specific generation), types.ts (interfaces)
- **Risk**: Low — pure refactor, no behavioral change

#### 7. [COMPILER] Deduplicate thane.ts and wcf.ts CLI entry points
- **Impact**: DRY violation, double maintenance burden
- **Approach**: Extract shared CLI logic into a common function parameterized by name/defaults
- **Risk**: Low

#### 8. [COMPILER] Deduplicate constants between ast-utils.ts and constants.ts
- **Impact**: Confusing dual source of truth for RUNTIME_FUNCTIONS, HTML_TAG_FUNCTIONS, etc.
- **Approach**: Keep canonical definitions in constants.ts only, import in ast-utils.ts
- **Risk**: Low

#### 9. [COMPILER] Enable source maps in dev mode
- **Impact**: Developer experience — currently no way to debug compiled output back to source
- **Approach**: Set `sourcemap: 'inline'` or `sourcemap: true` in dev esbuild config
- **Risk**: Low

#### 10. [COMPILER] Make type checker configurable — option to fail build on errors
- **Impact**: Type errors currently silently pass through and get bundled
- **Approach**: Add `strictTypeCheck` boolean to BuildConfig, fail build when enabled
- **Risk**: Low

#### 11. [COMPILER] Share filesystem scan results between plugins
- **Impact**: component-precompiler and html-bootstrap-injector both independently scan src/ and apps/
- **Approach**: Run scan once in build setup, pass results to plugins via shared context object
- **Risk**: Low — requires minor plugin interface change

#### 12. [COMPILER] Use incremental TypeScript compilation in type checker
- **Impact**: Full ts.createProgram on every build start is slow for large projects
- **Approach**: Use `ts.createIncrementalProgram` or `ts.createSolutionBuilder` and cache between builds
- **Risk**: Medium — incremental API has different semantics and edge cases

### Lower Priority — Code Health

#### 13. [COMPILER] Wire up ErrorCode enum to actual plugin diagnostics
- **Impact**: Error codes are defined but unused — plugins use free-form diagnostic strings
- **Approach**: Replace string diagnostics with createError(message, location, ErrorCode.XXX) calls
- **Risk**: Low

#### 14. [INFRA] Add compiler plugin test suite
- **Impact**: Zero test coverage for the most complex code (reactive binding compiler, template minifier, HTML parser)
- **Approach**: Unit tests with snapshot testing for template parsing, binding detection, code generation
- **Risk**: Low — purely additive, no code changes

#### 15. [COMPILER] Fix module-level mutable state in plugins
- **Impact**: SelectorMinifier instance, bootstrapSelector, isRunning flag are module-level — not safe for concurrent/multiple instantiation
- **Approach**: Move state into plugin factory closure or pass via plugin context
- **Risk**: Low
