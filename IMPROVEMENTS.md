# Thane Framework — Proposed Improvements

> Scope: Improve **compiler robustness, output code quality, and runtime performance** without changing the developer-facing API or input syntax.  
> Priority: 🔴 Critical → 🟡 Important → 🟢 Nice-to-have

---

## Table of Contents

1. [Compiler — Reactive Binding Compiler](#1-compiler--reactive-binding-compiler)
2. [Compiler — Dead Code Eliminator](#2-compiler--dead-code-eliminator)
3. [Compiler — HTML Parser](#3-compiler--html-parser)
4. [Compiler — Template Minifier](#4-compiler--template-minifier)
5. [Compiler — Selector Minifier](#5-compiler--selector-minifier)
6. [Compiler — Component Precompiler](#6-compiler--component-precompiler)
7. [Compiler — Post-Build Processor](#7-compiler--post-build-processor)
8. [Compiler — Type Checker](#8-compiler--type-checker)
9. [Compiler — Pipeline Architecture](#9-compiler--pipeline-architecture)
10. [Runtime — Signal](#10-runtime--signal)
11. [Runtime — Component](#11-runtime--component)
12. [Runtime — DOM Binding](#12-runtime--dom-binding)
13. [General Code Quality](#13-general-code-quality)

---

## 1. Compiler — Reactive Binding Compiler

### 🔴 1.1 — Eliminate `eval()` for Conditional Initial Values

**Problem:** `eval()` is used ~6 times to evaluate initial conditional expressions like `!this._loading()` at compile time. This is a security concern and an anti-pattern.

**Current code (appears multiple times):**
```ts
let initialValue = false;
try {
  initialValue = Boolean(eval(evalExpr));
} catch (e) {}
```

**Proposed fix:** Create a safe expression evaluator using the TypeScript AST or a simple recursive descent parser that only handles the operators actually used in `when()` expressions (`!`, `&&`, `||`, comparison operators, truthiness):

```ts
const evaluateConditionExpression = (
  expr: string, 
  signalValues: Map<string, any>
): boolean => {
  // Replace signal calls with their values
  let resolved = expr;
  for (const [name, value] of signalValues) {
    resolved = resolved.replaceAll(`this.${name}()`, JSON.stringify(value));
  }
  
  // Parse into a mini AST and evaluate safely
  // Supports: !, &&, ||, ===, !==, >, <, >=, <=, true, false, numbers, strings
  return safeEvaluateBoolean(resolved);
};
```

Alternatively, use TypeScript's own type checker or `ts.transpile()` in a constrained scope.

**Impact:** Eliminates all `eval()` calls from the codebase. No change to developer experience.

---

### 🔴 1.2 — Extract Shared Template Processing Logic (DRY)

**Problem:** Three functions — `processHtmlTemplateWithConditionals`, `processItemTemplateRecursively`, and `processSubTemplateWithNesting` — share ~70% identical code for handling conditionals, whenElse, bindings, and event processing.

**Proposed fix:** Extract a single `processTemplateBindings()` function that accepts a context object specifying the processing mode:

```ts
interface TemplateProcessingContext {
  mode: 'top-level' | 'item-template' | 'sub-template';
  itemVar?: string;
  indexVar?: string;
  parentId?: string;
}

const processTemplateBindings = (
  templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  startingId: number,
  context: TemplateProcessingContext,
): ProcessedTemplateResult => {
  // Single implementation handling all three modes
};
```

**Impact:** Reduces the file by ~800 lines. Makes bug fixes apply to all template processing modes simultaneously. No change to output.

---

### 🟡 1.3 — Split Into Multiple Modules

**Problem:** 2,767 lines in a single file is unmaintainable.

**Proposed structure:**
```
reactive-binding-compiler/
  index.ts                    — Plugin entry point, esbuild onLoad
  template-processor.ts       — processHtmlTemplateWithConditionals (unified)
  conditional-processor.ts    — Conditional/whenElse/when processing
  repeat-processor.ts         — Repeat block processing  
  binding-code-generator.ts   — generateInitBindingsFunction, generateBindingUpdateCode
  event-processor.ts          — Event binding extraction and code generation
  import-updater.ts           — Import analysis and rewriting
  static-template-optimizer.ts — generateStaticRepeatTemplate
  types.ts                    — All the interfaces (ConditionalBlock, RepeatBlock, etc.)
```

**Impact:** Each file becomes <400 lines. Much easier to reason about, test, and debug.

---

### 🟡 1.4 — Use HTML Parser AST for Item Binding Detection

**Problem:** `itemExprRegex` and `attrItemRegex` use regex to find item variable references in repeat templates instead of using the already-parsed AST.

**Current:**
```ts
const itemExprRegex = new RegExp(`\\$\\{([^}]*\\b${itemVar}\\b[^}]*)\\}`, 'g');
```

**Proposed:** Use the `ParsedTemplate` bindings to find text/attribute bindings that reference the item variable, since the parser already extracts all `${...}` expressions:

```ts
// The parser already identified all bindings — filter for item references
const itemTextBindings = parsed.bindings.filter(b => 
  b.type === 'text' && b.fullExpression.includes(itemVar)
);
```

**Impact:** More robust binding detection, handles edge cases the regex misses.

---

### 🟡 1.5 — Cache RegExp Objects Created in Loops

**Problem:** Multiple `new RegExp(...)` calls inside loops (per signal, per binding):

```ts
for (const sigName of signalNames) {
  const sigRegex = new RegExp(`this\\.${sigName}\\(\\)`, 'g');  // Created per iteration
  evalExpr = evalExpr.replace(sigRegex, ...);
}
```

**Proposed:** Pre-compile regex patterns or use `String.replaceAll()`:

```ts
for (const sigName of signalNames) {
  evalExpr = evalExpr.replaceAll(`this.${sigName}()`, JSON.stringify(initialVal ?? false));
}
```

**Impact:** Minor performance improvement in compilation speed (not runtime).

---

### 🟡 1.6 — Replace `analyzeTextBindingContext` with AST-Based Analysis

**Problem:** `analyzeTextBindingContext` manually scans HTML backwards/forwards character by character to determine if a text binding is the sole content of its parent element.

**Proposed:** Use the already-parsed HTML AST to check the parent element's children:

```ts
const isSoleContent = (element: HtmlElement, bindingStart: number): boolean => {
  // Check if parent has exactly one text child containing the binding
  return element.textContent.length === 1 && 
         element.children.length === 0;
};
```

**Impact:** Simpler, more correct, no manual parsing needed.

---

## 2. Compiler — Dead Code Eliminator

### 🔴 2.1 — Rewrite to Operate on Pre-Minified AST

**Problem:** The entire dead code eliminator operates on minified/bundled output using regex patterns that match esbuild's specific minification output. This is fundamentally fragile — any esbuild version update could break every regex.

**Proposed:** Move dead code elimination to operate **before minification**, at the per-file AST level during the reactive-binding compilation phase:

```ts
// During reactive binding compilation, when we know a signal is never modified:
// Instead of emitting: __bindIf(r, this._loading, 'b0', `...`, () => [...])
// Emit nothing (eliminate the binding entirely)

// For static signals (never set), inline the value directly in the template:
// Instead of: __bindText(r, this._label, 'b0')
// Emit: r.getElementById('b0').textContent = 'Hello'  (no subscription)
```

The dead code eliminator's signal analysis logic (`analyzeSignals`) is already close to what the reactive binding compiler does with `findSignalInitializers`. Merge them.

**Impact:** Eliminates all fragile regex matching. Dead code elimination becomes robust across esbuild versions.

---

### 🟡 2.2 — Implement `inlineStaticBindings` and `removeUnusedVars`

**Problem:** Both functions are stubs (no-ops). They log but don't actually transform anything.

**Proposed:** Either implement them or remove them. Since we're moving to AST-based DCE (above), the implementations would live in the reactive binding compiler where we have full AST access.

**Impact:** Smaller bundle sizes when signals are never modified.

---

### 🟡 2.3 — Fix `eliminateConsole` Regex

**Problem:** Current regex `console.\w+\([^)]*\)` doesn't handle:
- Nested parentheses: `console.log(fn())`
- String args with parens: `console.log("hello (world)")`
- Multi-line calls
- Template literals in args

**Proposed:** Since this runs post-bundle, use esbuild's built-in `drop: ['console']` option (already used in prod builds). Remove the manual implementation entirely.

**Impact:** The prod build config already has `drop: ['console']` — this plugin's console removal is redundant.

---

## 3. Compiler — HTML Parser

### 🟡 3.1 — Add Error Recovery and Diagnostics

**Problem:** Malformed HTML produces silently incorrect parse trees.

**Proposed:** Track and report parse errors without aborting:

```ts
interface ParsedTemplate {
  roots: HtmlElement[];
  bindings: BindingInfo[];
  html: string;
  diagnostics: ParseDiagnostic[];  // NEW
}

interface ParseDiagnostic {
  message: string;
  position: number;
  severity: 'error' | 'warning';
}
```

Report: unclosed tags, mismatched closing tags, orphaned closing tags, attributes without values in unexpected positions.

**Impact:** Developers get meaningful error messages instead of mysterious broken output.

---

### 🟡 3.2 — Protect Comment Markers from Minification

**Problem:** `<!--b0-->` comment markers used for text binding in mixed content are stripped by `minifyHTML`'s comment removal regex: `<!--(?!\[)[\s\S]*?-->`.

**Proposed:** Modify the minifier to preserve binding comment markers:

```ts
// In minifyHTML:
.replace(/<!--(?!b\d+)(?!\[)[\s\S]*?-->/g, '')  // Preserve <!--b0--> markers
```

**Impact:** Fixes a potential production bug where text bindings in mixed content stop working after minification.

---

### 🟢 3.3 — Pre-compile Regex in `findBindingsInText`

**Problem:** `exprRegex`, `whenElseRegex`, `repeatRegex` are created per call.

**Proposed:** Move to module-level constants with `RegExp` reset before use:

```ts
const EXPR_REGEX = /\$\{this\.(\w+)\(\)\}/g;
// In findBindingsInText:
EXPR_REGEX.lastIndex = 0;
```

**Impact:** Minor performance improvement.

---

## 4. Compiler — Template Minifier

### 🟡 4.1 — Deduplicate CSS Minification

**Problem:** `minifyCSS` is implemented in both `global-css-bundler.ts` and `template-minifier.ts` with slightly different logic.

**Proposed:** Export a single `minifyCSS` from a shared utility and import it in both files.

**Impact:** Single source of truth for CSS minification behavior.

---

### 🟢 4.2 — Use String Concatenation Instead of Array Join

**Problem:** `minifyTemplatesInSource` builds a result array character by character then joins. For source files, direct string concatenation or a `StringBuilder` pattern would be more efficient.

**Proposed:** Use a simple index-tracking approach:

```ts
let lastIndex = 0;
const chunks: string[] = [];
// For each template found, push the unchanged prefix + minified template
chunks.push(source.substring(lastIndex, templateStart));
chunks.push(minified);
lastIndex = templateEnd;
```

**Impact:** Cleaner code; minor performance improvement.

---

## 5. Compiler — Selector Minifier

### 🟡 5.1 — Context-Aware Selector Replacement

**Problem:** `applySelectorsToSource` does naive global regex replacement that could match inside string literals or unrelated contexts.

**Proposed:** Parse the source to distinguish between:
1. HTML template literals (replace in tag names and attribute values)
2. JavaScript string literals containing selectors (replace)
3. Other code (don't replace)

```ts
// Instead of blind global replace, process template literals and known patterns:
const applySelectorsToSource = (source: string, selectorMap: SelectorMap): string => {
  // Process template literals
  return processTemplateLiterals(source, (content) => {
    // Only replace in HTML/CSS contexts
    return replaceSelectorsInHtml(content, selectorMap);
  });
};
```

**Impact:** Eliminates false positives in selector replacement.

---

### 🟢 5.2 — Validate Generated Selectors Against Reserved Names

**Problem:** Generated minified selectors like `a-a` could theoretically conflict with real custom element names used in the project.

**Proposed:** Check generated selectors against the set of known component selectors before assigning.

**Impact:** Prevents theoretical naming collision.

---

## 6. Compiler — Component Precompiler

### 🟡 6.1 — Reduce `vm.runInContext` Timeout

**Problem:** 1000ms timeout is excessive for evaluating simple expressions.

**Proposed:** Reduce to 50ms:

```ts
const result = vm.runInContext(`(${code})`, context, { timeout: 50 });
```

**Impact:** Faster failure detection for non-evaluable expressions.

---

### 🟡 6.2 — Fix Ambiguous `undefined` Return

**Problem:** `evaluateExpressionCTFE` returns `undefined` for both "failed to evaluate" and "value is literally undefined", making it impossible to distinguish.

**Proposed:** Use a sentinel value:

```ts
const EVAL_FAILED = Symbol('EVAL_FAILED');

const evaluateExpressionCTFE = (...): any => {
  // ...
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return undefined;
  // ...
  return EVAL_FAILED;  // Instead of undefined
};
```

**Impact:** Correct handling of properties intentionally set to `undefined`.

---

### 🟡 6.3 — Use AST Span Positions Instead of Manual Search

**Problem:** `findComponentCallsCTFE` manually scans backwards for `${` and forwards for `}`:

```ts
let searchStart = exprStart - 1;
while (searchStart >= 0 && source.substring(searchStart, searchStart + 2) !== '${') {
  searchStart--;
}
```

**Proposed:** Use the template span's position from the TypeScript AST, which already gives you the exact boundaries of each `${...}` expression:

```ts
// The TemplateSpan node already has exact start/end positions
const spanStart = span.getStart(sourceFile) - 2; // Includes ${
const spanEnd = span.getEnd(); // After }
```

**Impact:** More correct, faster, no scanning needed.

---

## 7. Compiler — Post-Build Processor

### 🟡 7.1 — Eliminate Module-Level Mutable State

**Problem:** Module-level variables (`totalBundleSizeInBytes`, `fileSizeLog`, `config`, `serverStarted`, etc.) make the module non-reentrant and unsafe for concurrent/repeated builds.

**Proposed:** Move all state into the plugin's `setup` closure:

```ts
export const PostBuildPlugin = (options: PostBuildOptions): Plugin => {
  let totalBundleSizeInBytes = 0;
  const fileSizeLog: { fileName: string; sizeInBytes: number }[] = [];
  // ... all state lives here
  
  return {
    name: NAME,
    setup(build) {
      // Use closure variables instead of module globals
    },
  };
};
```

**Impact:** Safe for concurrent builds; no stale state between watch rebuilds.

---

### 🟡 7.2 — Use Async Brotli Compression

**Problem:** `gzipDistFiles` uses `fs.readFileSync` + `zlib.brotliCompressSync` which blocks the event loop.

**Proposed:** Use `zlib.brotliCompress` (async version):

```ts
await new Promise<void>((resolve, reject) => {
  zlib.brotliCompress(content, options, (err, result) => {
    if (err) return reject(err);
    fs.writeFile(brotliPath, result, (err) => err ? reject(err) : resolve());
  });
});
```

**Impact:** Non-blocking compression; better dev server responsiveness during production builds.

---

### 🟢 7.3 — Lower Brotli Quality for Dev Server

**Problem:** On-the-fly compression in `compressAndServe` uses Brotli quality 11 (maximum) which is very CPU-intensive.

**Proposed:** Use quality 4-6 for on-the-fly serving:

```ts
const brotli = zlib.createBrotliCompress({
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: config.isProd ? 11 : 4,
  },
});
```

**Impact:** Much faster response times during development.

---

## 8. Compiler — Type Checker

### 🟡 8.1 — Use TypeScript API Instead of Shelling Out

**Problem:** `exec('tsc --noEmit')` spawns a child process, has no caching, and doesn't propagate errors to esbuild's diagnostic system.

**Proposed:** Use the TypeScript compiler API with incremental/project references:

```ts
import ts from 'typescript';

const runTypeCheck = (configPath: string): ts.Diagnostic[] => {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return ts.getPreEmitDiagnostics(program);
};
```

**Impact:** Faster type checking, proper error integration, incremental checking support.

---

## 9. Compiler — Pipeline Architecture

### 🟡 9.1 — Unify or Remove Unused Pipeline Runner

**Problem:** `pipeline-runner.ts` defines a complete plugin registration and execution system that is never used — `build.ts` directly configures esbuild plugins.

**Proposed:** Either:
- **Option A:** Wire `build.ts` to use `pipeline-runner.ts` for consistent plugin management
- **Option B:** Remove `pipeline-runner.ts` and `pipeline-config.ts` to eliminate dead code

**Impact:** Removes confusion about which plugin system is authoritative.

---

## 10. Runtime — Signal

### 🟡 10.1 — Add Error Boundary for Subscriber Callbacks

**Problem:** If a subscriber callback throws, all subsequent subscribers are not notified.

**Proposed:** Wrap each callback in a try/catch:

```ts
if (subscribers) {
  const subs = subscribers;
  for (let i = 0, len = subs.length; i < len; i++) {
    try {
      subs[i]!(value);
    } catch (e) {
      // Log error but continue notifying other subscribers
      console.error('[thane] Signal subscriber error:', e);
    }
  }
}
```

**Impact:** One broken subscriber doesn't break others. More robust in production.

---

### 🟢 10.2 — O(1) Unsubscribe

**Problem:** `subscribers.splice(idx, 1)` is O(n).

**Proposed:** Use a Set or mark-and-sweep approach:

```ts
// Option 1: Use Set (simple)
const subscribers = new Set<(val: T) => void>();

// Option 2: Mark deleted, compact lazily (fastest for hot paths)
let subscribers: ((val: T) => void)[] = [];
// On unsubscribe: set slot to null, compact on next notification
```

**Impact:** Better performance for signals with many subscribers (e.g., shared state in large apps).

---

### 🟢 10.3 — Add `peek()` Method

**Problem:** Currently no way to read a signal without potentially triggering tracking in future computed signal implementations.

**Proposed:** Add a `peek` property:

```ts
(reactiveFunction as Signal<T>).peek = (): T => value;
```

**Impact:** Future-proofs the API for computed signals / effects. No breaking change.

---

## 11. Runtime — Component

### 🟡 11.1 — Fix `getElementById` CSS Injection

**Problem:** `el.querySelector('#${id}')` is vulnerable if `id` contains CSS selector special characters.

**Proposed:** Use `CSS.escape()`:

```ts
el.getElementById = (id: string): HTMLElement | null => {
  if (el.id === id) return el;
  return el.querySelector(`#${CSS.escape(id)}`);
};
```

Since IDs are compiler-generated (e.g., `b0`, `b1`), this is currently safe but fragile.

**Impact:** Defense in depth against future changes to ID generation.

---

### 🟡 11.2 — Batch Style Registration

**Problem:** `registerGlobalStyles` appends to `styleEl.textContent` one CSS string at a time, each causing a full style recalculation.

**Proposed:** Batch style additions:

```ts
let pendingStyles: string[] = [];
let flushScheduled = false;

export function registerGlobalStyles(...styles: string[]): void {
  for (const css of styles) {
    if (!registeredStyles.has(css)) {
      registeredStyles.add(css);
      pendingStyles.push(css);
    }
  }
  if (!flushScheduled && pendingStyles.length > 0) {
    flushScheduled = true;
    queueMicrotask(() => {
      const styleEl = ensureGlobalStyleElement();
      styleEl.textContent += pendingStyles.join('\n');
      pendingStyles = [];
      flushScheduled = false;
    });
  }
}
```

**Impact:** Significantly fewer style recalcs during page load when many components register simultaneously.

---

### 🟡 11.3 — Deduplicate `generateComponentHTML`

**Problem:** `generateComponentHTML` exists in both `component.ts` (runtime) and `ast-utils.ts` (compiler) with identical logic.

**Proposed:** Since the compiler version is used at build time and the runtime version at runtime, keep both but extract the shared logic pattern into a comment showing they must stay in sync. Or, since the compiler never imports from runtime, mark the runtime one as the canonical implementation and have the compiler version reference it in comments.

**Impact:** Prevents future drift between the two implementations.

---

## 12. Runtime — DOM Binding

### 🟡 12.1 — Share Reconciliation Logic Between `__bindRepeat` and `__bindRepeatTpl`

**Problem:** The keyed reconciliation algorithm is duplicated entirely (~200 lines) between the string-based and template-based repeat bindings.

**Proposed:** Extract a generic reconciler:

```ts
interface ReconcilerCallbacks<T> {
  createItem: (item: T, index: number, refNode: Node) => ManagedItem<T>;
  removeItem: (managed: ManagedItem<T>) => void;
  updateItem: (managed: ManagedItem<T>, newItem: T) => void;
}

const reconcileItems = <T>(
  managedItems: ManagedItem<T>[],
  newItems: T[],
  callbacks: ReconcilerCallbacks<T>,
  keyFn?: KeyFn<T>,
  keyMap?: Map<string | number, ManagedItem<T>>,
  container: ParentNode,
  anchor: Element,
): void => {
  // Single reconciliation implementation
};
```

**Impact:** ~200 fewer lines; bug fixes apply to both repeat modes.

---

### 🟡 12.2 — Add `requestAnimationFrame` Batching for DOM Updates

**Problem:** Each signal update triggers immediate DOM manipulation. If a component updates 5 signals in sequence, it causes 5 separate DOM writes.

**Proposed:** Add optional batching:

```ts
let pendingUpdates: (() => void)[] = [];
let batchScheduled = false;

const scheduleUpdate = (update: () => void) => {
  pendingUpdates.push(update);
  if (!batchScheduled) {
    batchScheduled = true;
    requestAnimationFrame(() => {
      batchScheduled = false;
      const updates = pendingUpdates;
      pendingUpdates = [];
      for (const u of updates) u();
    });
  }
};
```

**Note:** This changes timing semantics and should be opt-in. Synchronous updates are often desirable for tests and simple cases.

**Impact:** Better performance for components with many simultaneous signal updates.

---

### 🟢 12.3 — Add Keyed Reconciliation to `__bindNestedRepeat`

**Problem:** Nested repeats always use index-based reconciliation.

**Proposed:** Accept optional `keyFn` parameter in `__bindNestedRepeat` and use the shared reconciler (from 12.1).

**Impact:** Better performance for nested lists with item additions/removals.

---

## 13. General Code Quality

### 🟡 13.1 — Add Compiler Test Suite

**Problem:** Zero compiler tests. This is the biggest risk factor for production readiness.

**Proposed test files:**
```
src/compiler/
  __tests__/
    html-parser.test.ts          — Parse various HTML templates, verify AST
    reactive-binding.test.ts     — Transform components, verify output code
    component-precompiler.test.ts — CTFE evaluation, import transformation
    template-minifier.test.ts    — Minify HTML/CSS templates
    selector-minifier.test.ts    — Selector registration and replacement
    routes-precompiler.test.ts   — Route extraction and injection
```

Minimum coverage targets:
- HTML parser: test all parser states, void elements, nested expressions
- Reactive binding: test each binding type (text, style, attr, when, whenElse, repeat, events)
- Template minifier: test HTML vs CSS detection, expression preservation

**Impact:** Confidence that compiler changes don't break output.

---

### 🟡 13.2 — Remove `toCamelCase` Duplication

**Problem:** `toCamelCase` is defined in both `ast-utils.ts` and `file-utils.ts`.

**Proposed:** Remove from `file-utils.ts` and import from `ast-utils.ts` (which is already the canonical location).

**Impact:** Single source of truth.

---

### 🟢 13.3 — Remove or Integrate `injectBootstrapHTML` No-Op

**Problem:** `injectBootstrapHTML` in `html-bootstrap-injector.ts` is called during post-build but its body is `return htmlContent` — a pure no-op.

**Proposed:** Either implement the intended behavior (injecting the bootstrap component's HTML into index.html for SSR-like first paint) or remove the call.

**Impact:** Removes dead code path.

---

### 🟢 13.4 — Wire `--debug-tap` CLI Flag to Pipeline

**Problem:** `--debug-tap` is parsed in the CLI but the build system doesn't actually use the pipeline runner that supports debug tapping.

**Proposed:** Either:
- Add debug tap support to the direct esbuild plugin approach used in `build.ts`
- Or wire `build.ts` to use the pipeline runner

**Impact:** The `--debug-tap` feature actually works.

---

## Summary of Changes by Priority

### 🔴 Critical (do first)
1. **1.1** — Eliminate `eval()` from reactive binding compiler
2. **2.1** — Rewrite dead code eliminator to operate on AST (not minified regex)
3. **3.2** — Protect comment markers from minification

### 🟡 Important (do next)
4. **1.2** — Extract shared template processing logic (DRY)
5. **1.3** — Split reactive-binding-compiler.ts into modules
6. **1.4** — Use HTML parser AST for item binding detection
7. **10.1** — Add error boundary for signal subscriber callbacks
8. **11.2** — Batch style registration
9. **12.1** — Share reconciliation logic between repeat binding modes
10. **7.1** — Eliminate module-level mutable state in post-build
11. **13.1** — Add compiler test suite

### 🟢 Nice-to-have (do when convenient)
12. **1.5** — Cache RegExp objects
13. **5.1** — Context-aware selector replacement
14. **8.1** — Use TypeScript API for type checking
15. **9.1** — Unify or remove unused pipeline runner
16. **10.2** — O(1) signal unsubscribe
17. **12.2** — Optional rAF batching for DOM updates
18. **13.2–13.4** — Remove duplications and dead code
