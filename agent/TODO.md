# Thane TODO — v0.0.7 Improvement Plan

> Based on v0.0.6 scoring (8/10, benchmark 1.09× vanilla)  
> Prioritized by impact on performance, correctness, and production readiness

Items are organized into 3 groups to minimize rework.
Group A and Group B can run in parallel. Group C (final pass) must run AFTER both A and B are complete.
When iterating, run the tests, do a build, pack the package, and test the output in the benchmark folder.

---

## GROUP A — Runtime Performance & Correctness

These changes target the remaining benchmark gaps and runtime robustness.
Run memory (1.75×) and general reorder (no LIS) are the two weakest areas.

### A1. Longest Increasing Subsequence (LIS) for General Reorder
- [ ] The shared reconciler's general reorder path currently does O(n) `insertBefore` calls in the worst case. Implement LIS to compute the longest subsequence of already-correctly-positioned elements, then only move elements NOT in that subsequence. This is the standard algorithm used by Solid, Inferno, and Vue Vapor.
- [ ] This primarily affects the `swap rows` benchmark (currently 1.04× — already fast due to the 2-element swap fast path, but general reorder would benefit complex list mutations).
- [ ] The LIS function should be a pure utility: `lis(arr: number[]): number[]` returning indices of the longest increasing subsequence.
- **Risk:** Low — well-understood algorithm, only affects the general reorder fallback path.
- **Expected impact:** Fewer DOM operations for complex reorders.

### A2. Signal Notification Batching
- [ ] Multiple signals updating synchronously (e.g., during reconciliation setup, or user code doing `a(1); b(2); c(3);`) trigger separate DOM update passes. Implement microtask-based batching: queue subscriber notifications, deduplicate callbacks, flush in a single microtask.
- [ ] **Critical constraint:** signal value must update immediately on write (`a(1); a()` must return `1`). Only *notifications* are batched, not value updates.
- [ ] Add a `batch(() => { ... })` escape hatch for explicit synchronous batching when microtask timing is insufficient.
- [ ] This should improve `replace all rows`, `partial update`, and any multi-signal operation.
- **Risk:** Medium — changes timing semantics. Existing compiled output may implicitly rely on synchronous subscriber execution. Test thoroughly.
- **Expected impact:** 2-5% improvement on multi-update benchmarks.

### A3. Error Boundary in Signal Notification
- [ ] One throwing subscriber currently kills all subsequent subscribers in the notification loop. Wrap each subscriber call in try/catch, collect errors, report after all subscribers have been notified.
- [ ] Use `queueMicrotask(() => { throw collectedError })` to surface errors without swallowing them — they'll appear in the console as unhandled errors but won't break the notification loop.
- **Risk:** Low — purely defensive improvement.

### A4. Replace Style Concatenation with adoptedStyleSheets
- [ ] `appendStyle()` in `component.ts` currently does `styleEl.textContent += css` which triggers full CSSOM recalculation on every component registration. Replace with `document.adoptedStyleSheets` using `CSSStyleSheet` objects.
- [ ] Each component gets its own `CSSStyleSheet` — no recalculation when additional components register.
- [ ] Browser support: Chrome 73+, Firefox 101+, Safari 16.4+ — all within the framework's `es2022` target.
- [ ] Fallback to `textContent +=` for environments without `adoptedStyleSheets` (SSR, JSDOM, older browsers).
- **Risk:** Low — well-supported API, clean fallback path.
- **Expected impact:** Faster component registration startup, especially for apps with many components.

---

## GROUP B — Compiler Quality & Dead Code Cleanup

These changes improve code quality, remove dead code, and fix naming inconsistencies.
They do NOT affect benchmark performance.

### B1. Rename Dead Code Eliminator
- [ ] Rename file from `dead-code-eliminator.ts` to `post-build-compressor.ts`.
- [ ] Rename export from `DeadCodeEliminatorPlugin` to `PostBuildCompressorPlugin`.
- [ ] Update all imports in `build.ts` and `plugins/index.ts`.
- [ ] The file already documents itself as "Post-Build Compressor" internally — make the external names match.
- **Risk:** None — pure rename.

### B2. Remove Dead Runtime Exports
- [ ] Remove `globalStyleManager` from `component.ts` and `index.ts` — no-op stub, zero callers.
- [ ] Remove `generateComponentHTML` from `component.ts` — duplicates `createComponentHTMLSelector`. Check compiler codegen doesn't reference it first.
- [ ] Remove unused type exports from `types.ts`: `ItemEventHandlerMap`, `TrackByFn` — never imported outside their own declaration.
- [ ] Remove `SelectorMap.getOriginal()` and `SelectorMap.getMinified()` from `selector-minifier.ts` — never called, only `.register()` and `.entries()` are used. Remove the reverse map that only exists to support `getOriginal()`.
- **Risk:** Low — verify no external consumers import these. Check `client.d.ts` for type re-exports.

### B3. Remove Dead Compiler Utilities
- [ ] Remove `createPluginSetup` from `plugin-helper.ts` — dead code, never called by any plugin.
- [ ] Remove duplicate `normalizeSelector` from `plugin-helper.ts` — identical function exists in `ast-utils.ts` (which is the version actually imported).
- [ ] Remove unused exports from `source-editor.ts`: `applyEdits`, `createInsertEdit`, `createDeleteEdit`, `createReplaceEdit` — never imported externally (only used within the file itself, and the file's main function `SourceEditor` class handles everything).
- [ ] Remove unused exports from `ast-utils.ts` — identify via `list_code_usages` which exported functions have zero external importers.
- **Risk:** Low — pure deletion of unreferenced code.

### B4. Fix Global Regex Fragility in HTML Parser Types
- [ ] The pre-compiled regexes in `html-parser/types.ts` use the `/g` flag and are exported as module-level constants. Consumers must manually reset `lastIndex` before each use — this is fragile and has caused bugs in other projects.
- [ ] Replace with factory functions: `createExpressionRegex()` instead of `EXPRESSION_REGEX`. Each call returns a fresh regex with `lastIndex = 0`.
- [ ] Alternatively, remove the `/g` flag where it's not needed and use `match()` instead of `exec()` in loops.
- **Risk:** Low — verify all consumers are updated.

### B5. Consistent Error Reporting in Binding Detection
- [ ] `binding-detection.ts` uses `console.error` for invalid `trackBy` warnings. Replace with the framework's `Logger` from `utils/logger.ts` for consistent error reporting.
- [ ] Check other compiler files for raw `console.log`/`console.error` usage that should go through the logger.
- **Risk:** None.

---

## GROUP C — Testing & Future Architecture (after A and B)

These tasks require the stable codebase from Groups A and B.

### C1. HTML Parser Test Suite
- [ ] The HTML parser is the most complex untested code (1,315 lines across 4 modules). Create snapshot tests for:
  - Basic HTML parsing (elements, attributes, text content, void elements)
  - Template expression handling (`${...}` with nested backticks and braces)
  - Binding detection (text bindings, style bindings, attribute bindings, event bindings)
  - Directive parsing (`when`, `whenElse`, `repeat` with various argument patterns)
  - Error diagnostics (unclosed tags, orphaned closing tags, malformed HTML)
  - HTML entity decoding
  - Edge cases: self-closing tags, implicit void elements, mixed content
- [ ] Use Bun's test runner. Snapshot format: input HTML string → parsed AST JSON.
- **Risk:** None — purely additive.

### C2. Reconciler Test Suite
- [ ] The reconciler is the most performance-critical runtime code. Create unit tests covering:
  - Keyed fast paths: single removal, same-key reorder, 2-element swap, complete replacement
  - General keyed reconciliation: partial overlap, all-new items, mixed insert/delete
  - Index-based reconciliation: grow, shrink, same length update
  - Empty template show/hide
  - Nested repeat keyed support
  - Edge cases: empty array, single item, duplicate keys
- [ ] Tests should use JSDOM or a minimal DOM mock. Verify DOM state after each reconciliation.
- **Risk:** Low — requires JSDOM or `happy-dom` as dev dependency.

### C3. Compiler Codegen Test Suite
- [ ] Create integration tests that compile a `.ts` component file through the full pipeline and verify the output JavaScript:
  - Component with text bindings
  - Component with `when`/`whenElse`
  - Component with `repeat` (keyed and non-keyed)
  - Component with event handlers and modifiers
  - Component with nested repeats
  - Component with CTFE-resolved props
- [ ] Test format: input `.ts` source → expected output `.js` (snapshot comparison).
- **Risk:** Low — purely additive, but requires test fixture management.

### C4. Reactive Binding Compiler File Size Reduction
- [ ] `repeat-analysis.ts` (840 lines) and `template-processing.ts` (841 lines) are the two largest compiler files and share structural overlap in conditional/nested content processing.
- [ ] Audit both files for extractable shared logic. The `whenElse` and nested `repeat` processing paths are likely candidates.
- [ ] `generateOptimizedRepeatCode` in `repeat-analysis.ts` is ~400 lines with 7+ indent levels — decompose into smaller functions.
- [ ] Target: reduce each file to under 600 lines.
- **Risk:** Medium — these are the most complex compiler files and changes could introduce subtle code generation bugs. Run benchmark after each refactor step.

### C5. Run Memory Optimization Investigation
- [ ] Run memory at 1.75× vanilla is the weakest benchmark metric. Each row creates: a `Signal` function object (with `_v`, `_s` properties), a closure for `createItem`, a `ManagedItem` object `{ itemSignal, el, cleanups }`, and a cleanup array.
- [ ] Investigate whether `ManagedItem` can be stored as a flat typed array (signal index, element reference, cleanup count) instead of individual objects — this would reduce GC pressure.
- [ ] Investigate whether the `keyMap` can use a pre-allocated array with hash-based indexing instead of a Map — Maps have overhead for small-to-medium collections.
- [ ] **Report findings before implementing** — some optimizations may reduce code clarity for minimal memory savings.
- **Risk:** Medium — micro-optimizations may not be worth the complexity. Profile first.

---

## Priority Summary

| Priority | Task | Impact | Risk |
|---|---|---|---|
| 🔴 High | A1. LIS for reorder | Performance | Low |
| 🔴 High | C1. HTML parser tests | Correctness confidence | None |
| 🔴 High | C2. Reconciler tests | Correctness confidence | Low |
| 🟡 Medium | A2. Signal batching | Performance (2-5%) | Medium |
| 🟡 Medium | A4. adoptedStyleSheets | Startup performance | Low |
| 🟡 Medium | B1. Rename dead code eliminator | Code clarity | None |
| 🟡 Medium | B2. Remove dead runtime exports | Code hygiene | Low |
| 🟡 Medium | B3. Remove dead compiler utils | Code hygiene | Low |
| 🟢 Low | A3. Signal error boundary | Robustness | Low |
| 🟢 Low | B4. Global regex fragility | Correctness | Low |
| 🟢 Low | B5. Consistent error reporting | Code quality | None |
| 🟢 Low | C3. Codegen test suite | Correctness confidence | Low |
| 🟢 Low | C4. Compiler file size reduction | Maintainability | Medium |
| 🟢 Low | C5. Memory optimization investigation | Performance (memory) | Medium |

---

