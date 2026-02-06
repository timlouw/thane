# Thane Framework — Comprehensive Code Scoring

> Reviewed: February 2026  
> Reviewer: Expert-level analysis of compiler and runtime  
> Scale: 1–10 (10 = production-grade, battle-tested)

---

## Executive Summary

| Area | Score | Notes |
|------|-------|-------|
| **Overall Architecture** | 8/10 | Clean plugin-based esbuild pipeline; good separation of concerns |
| **Runtime** | 7/10 | Solid signal primitive and DOM binding; some robustness gaps |
| **Compiler — Reactive Binding** | 5/10 | Most complex file (2,767 lines); massive code duplication, uses `eval()` |
| **Compiler — HTML Parser** | 7/10 | Proper hand-rolled state machine parser; good edge-case handling |
| **Compiler — Component Precompiler** | 7/10 | Good AST usage with CTFE; `vm.runInContext` has security edge |
| **Compiler — Dead Code Eliminator** | 3/10 | Regex-based on minified output; brittle; stub functions |
| **Compiler — Minification** | 6/10 | Works but selector minifier uses naive global regex replacement |
| **Compiler — Routes Precompiler** | 8/10 | Clean AST-based extraction; well-scoped |
| **Compiler — Register Component Stripper** | 8/10 | Proper AST-based code removal |
| **Compiler — HTML Bootstrap Injector** | 7/10 | AST-based; solid but `injectBootstrapHTML` is a no-op |
| **Compiler — Global CSS Bundler** | 8/10 | Simple, correct, does its job |
| **Compiler — Post-Build Processor** | 6/10 | Module-level mutable state; mixed concerns |
| **Compiler — Type Checker** | 5/10 | Shells out to `tsc --noEmit`; no error propagation to esbuild |
| **Utilities** | 8/10 | Well-factored AST utils; good source editor; caching |
| **Types & Error Handling** | 7/10 | Good type definitions; error codes defined but underused |
| **CLI** | 7/10 | Clean argument parsing; good help text |
| **Pipeline Architecture** | 6/10 | Two parallel systems (pipeline-runner unused vs direct esbuild plugins) |
| **Test Coverage** | 3/10 | Only `signal.test.ts` exists; no compiler tests |
| **Documentation** | 7/10 | Good JSDoc comments throughout; README present |

---

## Detailed Scoring by File/Module

### 1. Runtime — `signal.ts` — Score: 8/10

**Strengths:**
- Clean, minimal signal implementation
- Lazy subscriber array initialization (`null` until first subscribe)
- Fast notification loop with cached length
- Returns unsubscribe function (proper cleanup pattern)

**Weaknesses:**
- `subscribers.splice(idx, 1)` in unsubscribe is O(n); for signals with many subscribers, this could become a bottleneck
- No batching/transaction mechanism for multiple signal updates
- Strict reference equality (`value !== newValue`) means object/array mutations are invisible — this is intentional but could surprise users with deep objects
- No error boundary around subscriber callbacks — one throwing subscriber kills all subsequent subscribers

---

### 2. Runtime — `component.ts` — Score: 6/10

**Strengths:**
- Clean registration pattern with factory functions
- Scoped styles via `:host` → `.selector` replacement
- Static template cloning when available (compiler-optimized path)
- `mountComponent` with proper selector extraction

**Weaknesses:**
- `el.getElementById` is implemented via `el.querySelector('#${id}')` — vulnerable to CSS selector injection if `id` contains special characters (e.g., dots, colons)
- `createComponentHTMLSelector` and `generateComponentHTML` duplicated between compiler and runtime
- `registerGlobalStyles` appends to `textContent` which causes full style recalc each time a component registers
- No component lifecycle hooks (onMount, onDestroy, etc.)
- No component unmount/cleanup mechanism — `componentFactories` map grows forever
- Style registration uses `registeredStyles.has(selector)` but first registration uses the css string not the selector — inconsistent check

---

### 3. Runtime — `dom-binding.ts` — Score: 7/10

**Strengths:**
- Well-structured event delegation system with modifier support
- Efficient keyed reconciliation with multiple fast paths (swap, single removal, complete replacement)
- `__bindRepeatTpl` with template cloning and DOM path navigation — genuinely excellent optimization
- Container detach optimization during bulk creation
- Comment marker approach for mixed-content text bindings
- Lazy initialization of conditional content bindings

**Weaknesses:**
- `__bindRepeat` and `__bindRepeatTpl` duplicate ~200 lines of reconciliation logic — should share a core reconciler
- The keyed reconciliation general case re-reads `managedItems` after splice operations which could cause index misalignment in edge cases
- No `requestAnimationFrame` batching for rapid signal updates — each signal update triggers immediate DOM work
- `getTempEl()` reuses a single template element which is not safe if used re-entrantly (shouldn't happen in practice, but fragile)
- `__findEl` builds a compound CSS selector `#${id},[data-bind-id="${id}"]` — `id` is compiler-generated so safe, but architecturally fragile
- `__bindNestedRepeat` doesn't support keyed reconciliation (always index-based)

---

### 4. Compiler — `reactive-binding-compiler.ts` — Score: 5/10

**Strengths:**
- Correctly handles complex nested scenarios (when inside repeat, repeat inside repeat, whenElse)
- Uses the HTML parser AST rather than pure regex for template analysis
- Generates efficient binding code with consolidated subscriptions
- Static template optimization for repeat blocks is well-designed
- Properly handles event modifiers and delegation

**Weaknesses:**
- **2,767 lines in a single file** — the longest file by far; should be split into at least 5 modules
- **Uses `eval()` for evaluating initial conditional values** — appears at least 6 times across the file. While only evaluating compiler-controlled expressions, this is a code smell and potential security issue. Should use a safe expression evaluator or the TypeScript AST
- **Massive code duplication**: `processHtmlTemplateWithConditionals`, `processItemTemplateRecursively`, and `processSubTemplateWithNesting` all share ~70% identical logic for handling conditionals, whenElse, and bindings. This is the single biggest maintainability problem in the codebase
- **Regex fallback for item bindings**: `itemExprRegex` and `attrItemRegex` use regex to find item bindings in templates instead of leveraging the HTML parser AST
- `analyzeTextBindingContext` manually scans HTML backwards/forwards with character-by-character parsing instead of using the already-parsed AST tree
- `addIdsToNestedElements` uses regex-based tag matching that could match wrong elements in edge cases
- `generateInitBindingsFunction` is ~400 lines and generates code as string concatenation — should use a proper code builder
- Several `RegExp` objects created inside loops (e.g., `new RegExp(...)` per signal per iteration) — should be cached
- The `processConditionalElementHtml` function uses regex to strip event attributes but the parser already identified them

---

### 5. Compiler — `html-parser.ts` — Score: 7/10

**Strengths:**
- Proper hand-rolled state machine parser (not regex-based)
- Handles template literal expressions inside HTML (`${...}` with nested braces, backticks)
- Correctly tracks element hierarchy, attributes, text nodes
- Good set of utility functions (walkElements, findElements, etc.)
- Handles self-closing tags, void elements, comments
- `parseWhenElseExpression` and `parseRepeatExpression` properly handle nested template literals

**Weaknesses:**
- No error recovery — malformed HTML silently produces wrong parse trees
- Doesn't handle HTML entities at all
- Comment handling is simplistic (just skips `<!-- ... -->`) — doesn't handle conditional comments or CDATA
- `findBindingsInText` creates new RegExp objects per call
- The `ATTR_EQ` state has a special case for unquoted `${...}` values but doesn't handle all edge cases (e.g., `${expr} more text`)
- No source map or position tracking for error reporting back to the user
- `injectIdIntoFirstElement` uses a simple regex that could break with unusual whitespace

---

### 6. Compiler — `component-precompiler.ts` — Score: 7/10

**Strengths:**
- Proper AST-based analysis of component definitions and imports
- CTFE (Compile-Time Function Evaluation) system for evaluating props at build time
- Correct handling of import transformations (named → side-effect)
- Sandboxed evaluation via `vm.createContext` with limited API surface
- Iterative resolution of interdependent class properties

**Weaknesses:**
- `vm.runInContext` with 1000ms timeout is overly generous; 100ms would be safer
- `evaluateExpressionCTFE` falls through to `vm.runInContext` for any unrecognized expression — could execute arbitrary code at build time
- The `findComponentCallsCTFE` function manually scans backwards/forwards for `${` and `}` markers instead of using span positions from the AST
- `extractClassPropertiesCTFE` returns `undefined` for unresolvable properties which is also the sentinel for "failed to evaluate" — ambiguous
- Source file is re-parsed via `sourceCache.parse()` even when already cached via `sourceCache.get()`

---

### 7. Compiler — `dead-code-eliminator.ts` — Score: 3/10

**Strengths:**
- Good concept — eliminating dead conditionals and console statements
- Performance measurement and logging

**Weaknesses:**
- **Entirely regex-based** operating on minified/bundled output — extremely fragile
- `analyzeSignals` looks for pattern `f(this,"_name",T(value))` — any change to esbuild's minification strategy breaks this entirely
- `eliminateDeadConditionals` looks for `A(e,this._name,"b0",...)` — same fragility
- `inlineStaticBindings` is a no-op (logs but doesn't actually inline)
- `removeUnusedVars` is a complete stub (empty function body)
- `eliminateConsole` regex `console.\w+\([^)]*\)` doesn't handle nested parentheses, string arguments with parens, or multi-line calls
- `simplifyEmptyCallbacks` runs the same regex twice
- Operates on concatenated bundle output instead of per-file pre-minification — wrong stage in pipeline

---

### 8. Compiler — `minification/selector-minifier.ts` — Score: 6/10

**Strengths:**
- Clean `SelectorMap` class with bidirectional lookup
- Deterministic minified selector generation

**Weaknesses:**
- `applySelectorsToSource` does naive global regex replacement which could match selectors inside string literals, comments, or unrelated contexts
- `extractSelectorsFromSource` only finds `selector: 'xxx'` pattern — misses selectors from other contexts
- No protection against minified selectors colliding with existing HTML element names or reserved words
- `generateMinifiedSelector` always produces names with a hyphen (required for custom elements) — but the format `a-a`, `a-b` etc. could conflict with utility class names

---

### 9. Compiler — `minification/template-minifier.ts` — Score: 6/10

**Strengths:**
- Properly handles template literals with nested expressions
- Distinguishes HTML, CSS, and plain text content
- Handles string literals and comments correctly (doesn't minify them)

**Weaknesses:**
- `minifyHTML` removes all comments including those used as binding markers (`<!--b0-->`)
- `minifyCSS` is duplicated between `global-css-bundler.ts` and `template-minifier.ts`
- `minifyTemplateContent` heuristic for detecting HTML vs CSS could misfire on edge cases
- Building result as `string[]` with character-by-character `push` then `.join('')` is slower than direct string concatenation for small templates

---

### 10. Compiler — `post-build-processor.ts` — Score: 5/10

**Strengths:**
- Comprehensive build output handling (hash management, assets, compression)
- Live reload via SSE
- Proper gzip and brotli compression

**Weaknesses:**
- **Module-level mutable state** (`totalBundleSizeInBytes`, `fileSizeLog`, `serverStarted`, `sseClients`, `config`, `bootstrapConfig`) — not safe for concurrent builds
- Mixed concerns: file copying, compression, server, HTML injection, size reporting all in one file
- `compressAndServe` creates a new Brotli compressor per request with quality 11 — extremely CPU-intensive for on-the-fly compression in dev mode
- `watchAndRecursivelyCopyAssetsIntoDist` doesn't debounce file system events
- `gzipDistFiles` mixes async `createReadStream` for gzip with sync `readFileSync` + `brotliCompressSync` for brotli — inconsistent and blocks the event loop
- Error handlers silently swallow errors in `recursivelyCopyAssetsIntoDist` and `processMetafileAndUpdateHTML`
- `promptForPort` uses `readline` which conflicts with process.stdin if other tools are using it

---

### 11. Compiler — `type-checker/tsc-type-checker.ts` — Score: 5/10

**Strengths:**
- Simple, non-blocking type checking via child process

**Weaknesses:**
- Uses `exec` (shells out to `tsc`) instead of the TypeScript compiler API — extra process spawn per build
- No error propagation to esbuild — type errors are logged but build continues with no diagnostic feedback
- `isRunning` guard prevents concurrent checks but also means type errors from the second build in watch mode are silently skipped
- No caching of previous results — re-checks everything every time

---

### 12. Compiler — Utilities — Score: 8/10

**`ast-utils.ts` — 8/10:**
- Clean, well-organized AST utility functions
- Good separation of concerns (detection, extraction, traversal)
- Proper TypeScript AST usage throughout
- `toCamelCase` duplicated between `ast-utils.ts` and `file-utils.ts`

**`cache.ts` — 7/10:**
- Simple but effective source file cache
- `parse()` method doesn't cache — always creates new SourceFile (by design, but worth noting)
- No cache size limits or eviction policy

**`source-editor.ts` — 9/10:**
- Clean, well-documented position-based editing
- Correct bottom-to-top edit application
- Good utility functions for line/column conversion

**`html-parser.ts` — 7/10:** (scored above)

**`logger.ts` — 8/10:**
- Clean structured logging with multiple levels
- Good overload support for tag-based logging
- Proper ANSI color handling

**`plugin-helper.ts` — 7/10:**
- Good quick-check functions to avoid expensive AST parsing
- `extendsComponentQuick` is a simple string check which could false-positive on comments/strings

---

### 13. Pipeline Architecture — Score: 6/10

**Strengths:**
- Well-defined plugin order
- Configuration-based toggle system
- Debug tap for intermediate output inspection

**Weaknesses:**
- **Two parallel plugin systems**: `pipeline-runner.ts` defines a registration-based pipeline but `build.ts` directly uses esbuild plugins — the pipeline runner appears unused in production
- `pipeline-config.ts` defines toggle types but `build.ts` hardcodes plugin arrays
- `createPipelineConfig` creates `basePluginToggles` but never uses it
- The pipeline runner and the actual build don't share any plugin resolution logic

---

### 14. CLI — Score: 7/10

**Strengths:**
- Clean argument parsing
- Good help text with examples
- Version detection from package.json
- Sensible defaults

**Weaknesses:**
- Manual arg parsing instead of a library — won't handle `--flag=value` syntax
- No input validation on `--app` value
- No error message for unknown flags
- `--debug-tap` flag is parsed but `debugTap` isn't actually wired into the build config properly (it's defined but the build.ts doesn't use the pipeline-runner)

---

### 15. Test Coverage — Score: 3/10

- Only `signal.test.ts` exists (685 lines, thorough for signals)
- **Zero tests** for: HTML parser, reactive binding compiler, component precompiler, template minifier, selector minifier, dead code eliminator, routes precompiler, DOM binding, component registration
- This is the single biggest risk for production readiness

---

## Risk Assessment

| Risk | Severity | Area |
|------|----------|------|
| `eval()` usage in compiler | 🔴 High | reactive-binding-compiler |
| No compiler tests | 🔴 High | Overall |
| Dead code eliminator regex fragility | 🔴 High | dead-code-eliminator |
| Module-level mutable state | 🟡 Medium | post-build-processor |
| Massive file size (2,767 lines) | 🟡 Medium | reactive-binding-compiler |
| Code duplication in template processing | 🟡 Medium | reactive-binding-compiler |
| Reconciliation logic duplication | 🟡 Medium | dom-binding |
| Selector injection via getElementById | 🟡 Medium | component.ts |
| No subscriber error boundaries | 🟡 Medium | signal.ts |
| Comment markers removed by minifier | 🟡 Medium | template-minifier |
| Unused pipeline runner system | 🟢 Low | pipeline-runner |
| `toCamelCase` duplication | 🟢 Low | ast-utils, file-utils |
| CSS minification duplication | 🟢 Low | global-css-bundler, template-minifier |
