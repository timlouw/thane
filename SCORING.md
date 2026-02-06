# Thane Framework - Performance Scoring Analysis

> Comprehensive scoring of every component in the framework's compiler and runtime.
> Scale: 1-10 (10 = optimal, 1 = needs significant improvement)

---

## Runtime

### 1. Signal System (`src/runtime/signal.ts`) — Score: 8/10

**Strengths:**
- Lazy subscriber array initialization (`null` until first subscribe) — excellent
- Direct `===` identity check for value deduplication — minimal overhead
- Cached `subs.length` in notification loop — good micro-optimization
- Synchronous notification — avoids microtask/scheduling overhead

**Weaknesses:**
- `arguments.length === 0` check on every call — `arguments` object access can be deoptimized by V8 in some contexts; using an explicit sentinel or overloaded signatures could be faster
- `splice(idx, 1)` in unsubscribe — O(n) array mutation; for large subscriber lists, this creates GC pressure from shifted elements
- Named function `reactiveFunction` is allocated per signal — the name is for debugging only and adds a small allocation overhead vs. an arrow function

---

### 2. Component System (`src/runtime/component.ts`) — Score: 7/10

**Strengths:**
- `globalStyleManager` and `registeredStyles` Set for deduplication — efficient
- Factory pattern for component instantiation — avoids repeated setup logic
- Lazy global style element creation (`ensureGlobalStyleElement`)

**Weaknesses:**
- `registerGlobalStyles` appends to `textContent` with string concatenation (`+=`) — each call triggers a full CSSOM reparse of all previously registered styles. Should batch or use `insertRule()`
- `:host` replacement uses two separate `replace()` calls with regex — could be combined into one
- `document.createElement('div')` in constructor with manual `getElementById` polyfill — the `querySelector` fallback inside `getElementById` creates a CSS selector string on every call
- `mountComponent` uses regex `match(/<([^>]+)>/)` to extract selector — fragile and could be a simple string extraction
- `Object.entries(props).map(...).join(' ')` for props serialization is done identically in three separate places — should be a shared helper

---

### 3. DOM Binding System (`src/runtime/dom-binding.ts`) — Score: 7/10

**Strengths:**
- Event delegation with data attributes — excellent pattern, minimal event listeners
- Template cloning with `__bindRepeatTpl` using pre-computed DOM paths — very fast
- Bulk DOM operations with container detach/re-attach — prevents layout thrashing
- Keyed reconciliation with fast paths for common cases (single removal, two-item swap, same-length reorder)
- Lazy `tempEl` (HTMLTemplateElement) initialization

**Weaknesses:**
- `__findEl` performs `getAttribute('data-bind-id')` on every element — DOM attribute access is slow; could cache or use a different lookup strategy
- `__findTextNode` recursively walks all child nodes — O(n) for large DOM trees; could use TreeWalker API which is faster for node-type filtering
- `bindConditional` calls `root.getElementById(id)` inside both `show()` and `hide()` — redundant lookups; the element reference could be cached
- Reconciliation duplicates the entire logic between `__bindRepeat` and `__bindRepeatTpl` — ~400 lines of near-identical code
- `managedItems.push(newManagedItems[i]!)` loop in general reorder — could use `Array.from()` or direct assignment
- `items.slice(oldLength)` in append path creates unnecessary intermediate array — could pass indices directly
- `getTempEl().innerHTML = html` reuses a single template element — this is correct but worth noting that `innerHTML` assignment is relatively slow; for hot paths, `DOMParser` or pre-compiled templates would be faster

---

## Compiler

### 4. Reactive Binding Compiler (`src/compiler/plugins/reactive-binding-compiler/`) — Score: 6/10

**Strengths:**
- Generates optimized `__bindRepeatTpl` with pre-computed DOM paths — very good optimization
- Groups bindings by signal to consolidate subscriptions — reduces listener count
- Static template generation with element path navigation — O(depth) vs O(n) querySelector
- Proper escaping of template literals in generated code

**Weaknesses:**
- `processHtmlTemplateWithConditionals` is 330+ lines with deeply nested logic — hard to maintain and likely has redundant work
- Duplicate code: `processItemTemplateRecursively`, `processSubTemplateWithNesting`, and `processConditionalElementHtml` share ~80% identical logic for handling conditionals
- `replaceExpressionsWithValues` uses a global regex replace per call — could be done in a single pass
- `analyzeTextBindingContext` manually scans backwards/forwards through HTML string — O(n) per binding; could reuse the already-parsed AST from `parseHtmlTemplate`
- Generated code uses string concatenation to build `initializeBindings` — could use an AST builder for more reliable code generation
- `RegExp` constructors inside loops (e.g., `new RegExp(...)` in signal replacement) — allocates new regex objects per iteration; should be cached
- `eval()` used for initial value evaluation — security concern and slow; could use a simple expression evaluator
- Multiple passes over `parsed.bindings` array (6+ separate `for` loops filtering by type) — could be done in a single pass with categorization

---

### 5. HTML Parser (`src/compiler/utils/html-parser.ts`) — Score: 7/10

**Strengths:**
- Hand-written state machine parser — fast, no external dependency
- Comprehensive binding detection (text, style, attr, when, whenElse, repeat, event)
- Proper handling of void elements, self-closing tags

**Weaknesses:**
- Parser state uses string literals instead of numeric constants — string comparisons are slower than number comparisons in tight loops
- `extractSignalNames` and `extractSignalName` use regex on every binding — could extract during initial parse
- Multiple `includes()` calls on strings for signal detection — could be single pass

---

### 6. Component Precompiler (`src/compiler/plugins/component-precompiler/`) — Score: 7/10

**Strengths:**
- Evaluates component functions at compile time using `vm.runInNewContext` — powerful optimization
- Properly handles component import transforms

**Weaknesses:**
- Uses Node.js `vm` module — not portable and has security implications
- Creates new source files for each component analysis

---

### 7. Pipeline System (`src/compiler/pipeline/`) — Score: 8/10

**Strengths:**
- Clean plugin architecture with ordered execution
- Debug tap system for inspecting intermediate outputs
- Configuration toggles for each plugin

**Weaknesses:**
- No parallel plugin execution where possible — some plugins could run concurrently
- No caching between builds for unchanged files

---

### 8. Dead Code Eliminator (`src/compiler/plugins/dead-code-eliminator/`) — Score: 7/10

**Strengths:**
- Identifies signals that are never modified after initialization
- Removes `when()` blocks for false-initialized, never-modified signals

**Weaknesses:**
- Pattern matching is fragile — relies on specific mangled names (`f(this,"_name",T(...))`)
- Only handles simple constant-condition elimination

---

### 9. Build System (`src/compiler/cli/`) — Score: 7/10

**Strengths:**
- Uses esbuild for fast bundling
- Supports dev mode with file watching
- Clean CLI argument parsing

**Weaknesses:**
- `thane.ts` and `wcf.ts` are nearly identical files — should share code
- No incremental build support beyond esbuild's built-in watch

---

### 10. Utility Functions (`src/compiler/utils/`) — Score: 7/10

**Strengths:**
- Source file caching (`SourceFileCache`) — avoids re-parsing
- Clean separation of concerns (AST, file, logging, editing)

**Weaknesses:**
- `applyEdits` re-sorts and applies string edits from end to start — correct but creates many intermediate strings for many edits
- `toCamelCase` creates regex on each call — should cache

---

## Overall Framework Score: 7.1/10

The framework is well-architected with good foundational patterns. The main areas for improvement are:
1. **Runtime hot-path optimizations** — signal notification, DOM lookups, style registration
2. **Compiler code deduplication** — the reactive binding compiler has significant repeated logic
3. **Generated code quality** — the output code could be more optimal in several areas
