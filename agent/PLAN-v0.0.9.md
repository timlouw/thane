# Thane v0.0.9 — Improvement Plan

> Created: February 9, 2026  
> Based on: SCORING-v0.0.8.md identified weaknesses  
> Strategy: Runtime changes benchmarked individually; compiler/non-runtime changes batched

---

## Phase Structure

Changes are split into two phases:

- **Phase A — Runtime Changes (benchmark between each)**: These touch `signal.ts`, `component.ts`, or `dom-binding.ts` — code that runs in the browser. Each change is applied and benchmarked individually before proceeding to the next. If a regression is detected, the change is reverted or reworked.

- **Phase B — Compiler / Build-Time Changes (no benchmark needed)**: These touch the compiler pipeline, parser, minification, and post-build processing — code that runs at build time only. These can be batched since they don't affect runtime performance (only compile time and output correctness).

---

## Phase A — Runtime Changes

> ⚠️ Apply one at a time. Benchmark after each. Revert if regression detected.

### A1. `adoptedStyleSheets` for Style Registration

**File:** `component.ts` (lines 95–100)

**Current:**
```typescript
const appendStyle = (cssText: string): void => {
  const styleEl = ensureGlobalStyleElement();
  styleEl.textContent += cssText + '\n';
};
```

Every call to `appendStyle` does `textContent +=`, which triggers the browser to:
1. Serialize the entire existing stylesheet to string
2. Concatenate the new CSS
3. Re-parse the entire combined string
4. Trigger a full CSSOM recalculation

With 10 components, the 10th registration re-parses all 9 previous components' CSS. This is O(n²) in total parse work.

**Proposed fix:**
```typescript
const appendStyle = (cssText: string): void => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
};
```

Each call creates an independent `CSSStyleSheet` object and appends it to the document's `adoptedStyleSheets` array. Each stylesheet is parsed exactly once — O(n) total. No re-parsing of previous styles.

This also eliminates `ensureGlobalStyleElement` entirely — no `<style>` element needed.

**Performance impact:** Likely neutral for the benchmark (only 1 component = 1 style registration). Will matter for real apps with many components. Should be safe to benchmark.

**Note — `ensureGlobalStyleElement` concern:** The scoring file mentions "creates a single `<style>` element — could become a bottleneck with many components due to textContent concatenation." This is the **same issue** — `adoptedStyleSheets` fixes both problems at once. The `<style>` element, `globalStyleEl`, and `ensureGlobalStyleElement` can all be removed.

---

### A2. `componentFactories` Map Cleanup

**File:** `component.ts` (line 130)

**Current:** `componentFactories.set(selector, factory)` is called in `defineComponent()` but entries are never removed. If components are dynamically created/destroyed, the Map grows forever.

**Proposed fix:** This is actually low priority — in practice, `defineComponent()` is called once per component *definition* (at module load time), not once per *instance*. The Map stores factory functions, not instances. For a typical app with 50 components, the Map has 50 entries forever — negligible memory.

The real cleanup gap is `mountComponent` — it creates instances but returns only the root element with no `destroy()` handle. The `__onDestroy` callback is stored on the internal `ComponentInstance` but nothing external can call it.

**Proposed fix:** Add a `destroyComponent(root)` function that looks up the instance, calls `__onDestroy`, and removes the element:

```typescript
const mountedInstances = new WeakMap<ComponentRoot, ComponentInstance>();

export function destroyComponent(root: ComponentRoot): void {
  const instance = mountedInstances.get(root);
  if (instance?.__onDestroy) instance.__onDestroy();
  root.remove();
  mountedInstances.delete(root);
}
```

Using a `WeakMap` means instances are GC'd automatically when the root element is GC'd — no unbounded growth.

**Performance impact:** Neutral — adds a WeakMap set in the mount path (one allocation). The WeakMap is only consulted on destroy.

---

### A3. `data-thane` vs `data-thane-component` Attributes

**Files:** `component.ts` (lines 130, 311)

There are two data attributes being set:

1. **`data-thane="selector"`** — Set by `createHostElement()` on the actual host `<div>` when a component is instantiated:
   ```typescript
   el.setAttribute('data-thane', selector);
   ```
   **Purpose:** Marks a live component instance in the DOM. Used by the selector minifier (`selector-minifier.ts`) to find and replace selector names in HTML output. Also potentially useful for devtools/debugging.

2. **`data-thane-component="selector"`** — Set by `createComponentHTMLSelector()` in the HTML string returned for CTFE (compile-time function evaluation):
   ```typescript
   return `<div data-thane-component="${selector}" ${propsString}></div>`;
   ```
   **Purpose:** This generates an HTML string for when one component references another in its template. The component-precompiler's CTFE evaluates the selector function to produce static HTML that gets inlined. The `data-thane-component` attribute marks where a child component *would* go — but in the current pipeline, by the time the output is built, the component's `defineComponent()` call has already registered its factory and the CTFE has already replaced the selector call with the generated HTML.

**Analysis:** `data-thane-component` is consumed at compile time by CTFE but never queried at runtime. It survives into the output only because no one strips it. Meanwhile, `data-thane` is the real runtime marker.

**Proposed fix:**
- Keep `data-thane` — it's the canonical runtime marker, used by the selector minifier
- Consolidate to use `data-thane` in `createComponentHTMLSelector` as well
- Or better: if `createComponentHTMLSelector` output is only consumed by CTFE at compile time and never makes it to the final HTML, the attribute doesn't matter. Verify this.

**Performance impact:** Removing an `setAttribute` call saves nanoseconds per component instantiation. Essentially zero impact on benchmark.

---

### A4. Signal Error Boundary

**File:** `signal.ts` (lines 60–64)

**Current code:**
```typescript
if (fn._s) {
  const subs = fn._s;
  for (let i = 0, len = subs.length; i < len; i++) {
    subs[i]!(fn._v);
  }
}
```

If subscriber `subs[2]` throws an exception, `subs[3]`, `subs[4]`, etc. never get called. The signal update is partially applied — some DOM bindings reflect the new value, others show the old value. The UI is now in an inconsistent state with no recovery path.

**The concern:** Adding a `try/catch` inside the hot loop has historically been a performance killer in older JS engines because V8 couldn't optimize functions containing `try/catch`. **This is no longer true in modern V8** (since ~V8 v6.0 / Chrome 60). V8's TurboFan compiler optimizes `try/catch` just as well as straight-line code when the `catch` path is cold (never taken).

**Proposed fix:**
```typescript
if (fn._s) {
  const subs = fn._s;
  for (let i = 0, len = subs.length; i < len; i++) {
    try {
      subs[i]!(fn._v);
    } catch (e) {
      // Log but don't stop other subscribers
      console.error(e);
    }
  }
}
```

The `console.error` will be stripped by esbuild's `drop: ['console']` in production builds, making the catch block an empty no-op in the final bundle. An empty catch block is essentially free — it's just a jump target that's never taken.

**However** — this deserves careful benchmarking. Even if V8 handles `try/catch` well, the presence of a `try/catch` in this ultra-hot loop (called thousands of times per reconciliation) could have subtle effects:
- It prevents V8 from inlining the loop body in some edge cases
- It adds an exception handler frame to the stack
- The `console.error` (before stripping) could change code size enough to affect inlining decisions

**Recommendation:** Benchmark this carefully. If there's any regression at all (even 0.5%), revert and document as an intentional design choice: "Subscribers must not throw. This is a framework invariant."

**Performance impact:** Likely neutral (modern V8), but must be verified. This is the highest-risk change in Phase A.

---

### A5. `new Set()` in General Reconciliation

**File:** `dom-binding.ts` (lines 551–554)

**Current:**
```typescript
const newKeys = new Set<string | number>();
for (let i = 0; i < newLength; i++) {
  newKeys.add(keyFn(newItems[i]!, i));
}
```

This creates a new `Set` on every general reconciliation pass. The Set is used to check which old keys are still present in the new array.

**Context:** This code only runs in the **general keyed reconciliation** path — the fallback when none of the fast paths match (single removal, same-key reorder, 2-element swap, complete replacement). In the benchmark, this path is rarely hit because the benchmark operations are all covered by fast paths.

**Proposed fix:** Replace with an array scan. For the typical case (small number of removed items), a linear scan is faster than Set allocation + hashing:

```typescript
// Check if an old key still exists in new items
const isKeyPresent = (key: string | number): boolean => {
  for (let i = 0; i < newLength; i++) {
    if (keyFn(newItems[i]!, i) === key) return true;
  }
  return false;
};
```

Or pre-allocate a flat array and use `indexOf`. But honestly, this path is cold — the fast paths handle all benchmark operations.

**Alternative:** Keep the Set but use a module-level reusable Set that's cleared between uses:
```typescript
const _keySet = new Set<string | number>();
// In reconcile:
_keySet.clear();
for (let i = 0; i < newLength; i++) _keySet.add(keyFn(newItems[i]!, i));
// ... use _keySet ...
_keySet.clear(); // release references
```

**Performance impact:** Near-zero for the benchmark (path is rarely taken). Matters for apps with complex list mutations.

---

### A6. `getTempEl()` Shared Template Element

**File:** `dom-binding.ts` (lines 103–108)

**Current:**
```typescript
let tempEl: HTMLTemplateElement | null = null;
const getTempEl = (): HTMLTemplateElement => {
  if (!tempEl) tempEl = document.createElement('template');
  return tempEl;
};
```

A single `<template>` element is reused for all HTML parsing. This works because every caller does `tpl.innerHTML = html` (which clears previous content) followed by `tpl.content.cloneNode(true)` (which clones before the next caller resets it).

**The fragility:** If a call to `getTempEl()` were to happen during another caller's use of the same element (re-entrant scenario), the second caller would overwrite the first caller's innerHTML. In practice this never happens because:
1. JavaScript is single-threaded
2. No caller does async work between `innerHTML` and `cloneNode`
3. Signal notifications are synchronous

**Proposed fix:** This is not actually broken — it's theoretically fragile but practically safe. The only real improvement would be documentation:

```typescript
/**
 * Shared template element for HTML parsing. Safe because:
 * 1. JS is single-threaded — no concurrent access
 * 2. All callers synchronously: set innerHTML → cloneNode → done
 * 3. Signal notifications are synchronous (no async between parse and clone)
 */
```

Creating a new `<template>` per use would add a DOM allocation on every repeat item creation — definitely a regression.

**Performance impact:** No change recommended. Document the invariant.

---

### A7. Cleanup Arrays — Unbounded Growth

**File:** `dom-binding.ts` — `ManagedItem.cleanups` (line 284)

**Current:** Each `ManagedItem` has a `cleanups: (() => void)[]` array that's populated during item creation. When items have event handlers or nested bindings, cleanup functions are pushed to this array. The array is only consumed when the item is removed.

**The concern:** The `cleanups` array is push-only — if an item is created with 3 event handlers, it gets 3 cleanup functions. If the item is *updated* (its signal value changes), no new cleanup functions are added — the subscriber callback just runs again. So the array doesn't grow over time for a given item.

**The real scenario where this matters:** `__bindRepeat` with `itemEventHandlers`. Each event handler pushes a cleanup function in the `createItem` factory (dom-binding.ts line 710–725). If an item is removed and recreated (as opposed to signal-updated), a new `ManagedItem` is created with a fresh `cleanups` array — so again, no unbounded growth.

**Conclusion:** The cleanups array does NOT grow unboundedly in practice. Its size is determined at item creation time and never changes. This is a false positive in the scoring — the array is only "push-only" in the sense that nothing *removes* individual cleanups, but nothing *adds* to it after creation either.

**Performance impact:** No change needed.

---

## Phase A Summary

| ID | Change | Risk | Expected Impact |
|---|---|---|---|
| A1 | `adoptedStyleSheets` | 🟢 Low | Neutral (1 component in benchmark) |
| A2 | `destroyComponent` + WeakMap | 🟢 Low | Neutral |
| A3 | Consolidate data attributes | 🟢 Low | Neutral |
| A4 | Signal error boundary | 🔴 High | Must benchmark — hot loop change |
| A5 | Reusable Set in reconciler | 🟢 Low | Neutral (cold path) |
| A6 | `getTempEl` documentation | 🟢 None | No code change |
| A7 | Cleanup arrays | 🟢 None | No code change (false positive) |

**Recommended order:** A1 → A3 → A2 → A5 → A4 (leave highest-risk for last)

---

## Phase B — Compiler / Build-Time Changes

> These changes affect compile-time only. No runtime benchmarking needed.  
> Can be applied as a batch.

### B1. Fix Paren-Depth Tracking for Comments

**File:** `reactive-binding-compiler/index.ts` (lines 385–413)

**Current:** The paren-depth scanner that finds the closing `)` of `defineComponent(` correctly skips string and template literals, but does not skip comments. A `//` comment containing `)` or a `/* */ ` block comment containing `)` would incorrectly decrement the paren depth.

**Fix:** Add comment skipping to the scanner:
```typescript
// Skip single-line comments
if (result[i] === '/' && result[i + 1] === '/') {
  i += 2;
  while (i < result.length && result[i] !== '\n') i++;
  continue;
}
// Skip block comments
if (result[i] === '/' && result[i + 1] === '*') {
  i += 2;
  while (i < result.length && !(result[i] === '*' && result[i + 1] === '/')) i++;
  i++; // skip past closing /
  continue;
}
```

---

### B2. Fix `return\s*\{` Regex Fragility

**File:** `reactive-binding-compiler/index.ts` (line 360)

**Current:** `result.match(/return\s*\{/)` matches the **first** `return {` in the entire source. If a helper closure before the component return has `return {}`, it matches the wrong one.

**Fix:** Use TypeScript AST instead of regex. Parse the `defineComponent` call, walk the setup function's body, and find the `ReturnStatement` whose expression is an `ObjectLiteralExpression`. This is reliable regardless of formatting, comments, or nested returns:

```typescript
const sourceFile = ts.createSourceFile('temp.ts', result, ts.ScriptTarget.Latest, true);
// Walk to find the defineComponent call → setup function → return statement
ts.forEachChild(sourceFile, function visit(node) {
  if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
    // Found the return object — inject __bindings here
    const insertPos = node.expression.getStart(sourceFile) + 1; // after {
    // ... inject
  }
  ts.forEachChild(node, visit);
});
```

This eliminates the regex entirely and handles all edge cases.

---

### B3. Template-Processing / Repeat-Analysis Code Sharing

**Files:** `template-processing.ts` (~842 lines), `repeat-analysis.ts` (~804 lines)

**Analysis:** These two files share ~350–400 lines of nearly identical logic across 4 patterns, each duplicated 3 times:

1. **Conditional processing loop** — parse template → find when-elements → build binding map → evaluate → push ConditionalBlock (3 copies: `processSubTemplateWithNesting`, `generateProcessedHtml`, `processRepeatItemTemplate`)
2. **WhenElse processing loop** — extract branches, call `processSubTemplateWithNesting`, merge results (3 copies)
3. **Edit application** — build edits array, sort descending, apply right-to-left (3 copies)
4. **Binding collection** — filter when/event, assign IDs, push objects (3 copies)

There's also a circular import: `template-processing.ts` imports from `repeat-analysis.ts` and vice versa.

**Fix approach:** Extract shared logic into utility functions rather than merging the files (they have distinct responsibilities — top-level template processing vs. repeat item optimization):

1. `collectConditionalBlocks(parsed, signalInitializers, idCounter, ...)` — shared conditional walker
2. `collectWhenElseBlocks(parsed, signalInitializers, idCounter, ...)` — shared whenElse walker
3. `applyEditsToTemplate(templateContent, edits)` — shared edit application
4. `extractNestedBindings(condEl, bindings, id, elementIdMap, idCounter)` — shared binding collector

**Estimated reduction:** ~250–300 lines. Breaks the circular import. Reduces the 12 copy-pasted loop bodies to 4.

**New file:** `template-utils.ts` (~150 lines) — shared utilities used by both files.

---

### B4. Regex Injection Fragility in index.ts

**File:** `reactive-binding-compiler/index.ts`

**Current fragile patterns:**
1. `result.match(/return\s*\{/)` — addressed in B2
2. `result.match(/defineComponent\s*\(/)` — could match inside a comment or string
3. `result.match(/export\s+(const|let|var|function)\s+/)` — could match re-exports

**Fix approach:** Replace all three with AST-based lookups. Since the file already imports TypeScript and uses AST elsewhere, this is consistent:

1. Find `defineComponent` call → walk AST for `CallExpression` with identifier `defineComponent`
2. Find export → walk AST for `ExportDeclaration` or `ExportAssignment`
3. Find return → walk AST for `ReturnStatement` (see B2)

All three provide exact character positions via `node.getStart()` and `node.getEnd()`, eliminating regex fragility entirely.

---

### B5. Tag-Function Stripping in Component Precompiler

**File:** `component-precompiler.ts` (lines 430–431)

**Current:**
```typescript
result = result.replace(/css`/g, '`');
result = result.replace(/html`/g, '`');
```

This replaces ALL occurrences of `css\`` and `html\`` with `` ` `` — including inside string literals. If someone writes `const x = "use html\`templates\`"`, this breaks it.

**Fix:** Use TypeScript AST to find `TaggedTemplateExpression` nodes where the tag is `html` or `css`, and remove just the tag portion using exact character positions:

```typescript
ts.forEachChild(sourceFile, function visit(node) {
  if (ts.isTaggedTemplateExpression(node)) {
    const tag = node.tag;
    if (ts.isIdentifier(tag) && (tag.text === 'html' || tag.text === 'css')) {
      // Remove the tag name (from tag start to template start)
      edits.push({ start: tag.getStart(), end: node.template.getStart(), replacement: '' });
    }
  }
  ts.forEachChild(node, visit);
});
```

This is guaranteed to only strip actual template tag functions.

---

### B6. CTFE Code Path Consolidation

**File:** `component-precompiler.ts` (lines 440–490)

**Current:** Three nearly identical code paths:
1. No component calls → `buildTransformedResult(source, source, args.path)`
2. Has component calls but no CTFE matches → `buildTransformedResult(source, source, args.path)`
3. Has CTFE matches → inline components, then `buildTransformedResult(source, modifiedSource, args.path)`

**Fix:** Paths 1 and 2 are already identical. Consolidate:
```typescript
let modifiedSource = source;

if (hasComponentCalls) {
  const componentCalls = findComponentCallsCTFE(source, sourceFile, componentDefinitions);
  if (componentCalls.length > 0) {
    // ... apply CTFE inlining to modifiedSource ...
    // ... transform imports ...
  }
}

return buildTransformedResult(source, modifiedSource, args.path);
```

One return path instead of three.

---

### B7. HTML Parser Improvements

**File:** `html-parser/parser-core.ts`

**Current concerns from scoring:**
1. "`as any` casts in parser-core" — **FALSE POSITIVE**. No `as any` casts exist in the current parser-core.ts. This was likely cleaned up in a previous version. ✅ Already resolved.
2. "Error recovery is basic" — The parser reports errors via `logger.warn` and continues, but doesn't attempt to correct malformed HTML (missing close tags, mismatched tags). This is acceptable for a compile-time parser operating on developer-authored templates.
3. "Global regexes require manual `lastIndex` reset" — The factory functions in `types.ts` (`SIGNAL_EXPR_REGEX`, etc.) mitigate this by returning fresh regex instances. This is the correct approach.

**Fix:** Minimal. Add input validation at the parser entry point to catch obviously malformed templates early with clear error messages. No structural changes needed.

---

### B8. Post-Build Compressor Improvements

**File:** `post-build-compressor.ts`

**Current:** 5 regex patterns applied to concatenated bundle output. The patterns are individually safe (each has a documented invariant), but they operate on text — if esbuild's output format changes, they silently become no-ops.

**Improvement opportunities:**

1. **Additional safe compression patterns:**
   - `{return ` → ` ` when preceded by `=>` (arrow function with unnecessary block body for single return): `=>{ return X}` → `=>X` — but this requires careful expression-vs-statement analysis, probably not safe as regex
   - `void 0` → `undefined` — actually `void 0` is shorter, esbuild already optimizes this
   - Remove trailing semicolons before EOF — safe, minor
   - Collapse `\n` sequences in minified output — safe if minification is enabled

2. **AST-based approach:** Parse the bundle with a fast JS parser (acorn or similar) and apply transforms on the AST. But this adds a dependency and build time — likely not worth it for the small gains.

3. **Validation approach:** Instead of making the transforms more robust, add **verification**: apply each regex, and if it produces output that differs from input, log what was matched and changed. This makes silent failures visible.

**Recommended:** Add 1–2 more safe patterns and a verification log. Don't switch to AST — the regex approach is appropriate for post-minification micro-optimizations.

---

### B9. Selector Minifier — `activeSelectorMap` Module-Level State

**File:** `minification.ts` (line 12)

**Current:**
```typescript
let activeSelectorMap = new SelectorMap();
```

This module-level variable is set in `build.onStart()` and read by `minifySelectorsInHTML()` (exported for use by other plugins). The problem: if two esbuild builds ran concurrently, they'd share and overwrite this variable. In practice, esbuild serializes builds, so it's safe — but it's architecturally unclean.

**How it works:** The `MinificationPlugin`'s `onStart` creates a new `SelectorMap` instance and assigns it to `activeSelectorMap`. Then `onEnd` processes output files using that same instance. Meanwhile, `minifySelectorsInHTML` (called by other plugins like the HTML bootstrap injector) reads `activeSelectorMap` to apply selector replacements to HTML files.

**Fix:** Pass the `SelectorMap` explicitly through the build context instead of module-level state:

```typescript
// In types.ts:
interface BuildContext {
  selectorMap?: SelectorMap;
}

// In minification.ts:
export const MinificationPlugin = (ctx: BuildContext): Plugin => ({
  name: NAME,
  setup(build) {
    const selectorMap = new SelectorMap();
    ctx.selectorMap = selectorMap;
    // ...
  }
});

// In html-bootstrap-injector or wherever:
export const minifySelectorsInHTML = (html: string, ctx: BuildContext): string => {
  if (!ctx.selectorMap || ctx.selectorMap.size === 0) return html;
  return applySelectorsToSource(html, ctx.selectorMap);
};
```

No module-level mutable state. Concurrent builds get independent SelectorMaps.

---

### B10. Selector Name Generation — Shorter Names

**File:** `selector-minifier.ts` (lines 1–16)

**Current:** `generateMinifiedSelector` always produces names in the format `prefix-suffix` (e.g., `a-a`, `a-b`, ... `a-z`, `b-a`, ...). The `-` is required because these are used as HTML custom element selectors and CSS class names, and **custom elements require a hyphen** per the HTML spec.

The minimum output is 3 characters: `a-a`. With 26 × 26 = 676 combinations, this handles up to 676 components before needing 4+ characters.

**Can we do better?** Not really. The HTML spec requires custom element names to contain a hyphen (`-`). CSS class selectors don't have this requirement, but since the same name is used for both the element tag and the CSS class (`.selector`), the hyphen is mandatory.

The current scheme is already optimal: `a-a` (3 chars) is the minimum possible for a valid custom element name. Going to `a-b` format means single-letter prefix + single-letter suffix + mandatory hyphen = 3 characters minimum.

**One micro-optimization:** Start the sequence at index 0 with common letters to maximize compression-friendliness:
```
a-a, a-b, ..., a-z  (26 names at 3 chars)
b-a, b-b, ..., b-z  (26 more at 3 chars)
...
z-a, z-b, ..., z-z  (26 more at 3 chars)  → 676 total at 3 chars
aa-a, aa-b, ...      (4 chars)
```

This is already what the current algorithm does. **No improvement possible** — the scoring item is inaccurate.

---

## Phase B Summary

| ID | Change | Effort | Impact |
|---|---|---|---|
| B1 | Comment-skipping in paren scanner | 🟢 Small | Correctness fix |
| B2 | AST-based `return {}` finding | 🟡 Medium | Eliminates fragile regex |
| B3 | Template/repeat code sharing | 🔴 Large | ~300 lines removed, cleaner architecture |
| B4 | AST-based regex replacement in index.ts | 🟡 Medium | Eliminates 3 fragile regexes |
| B5 | AST-based tag stripping | 🟡 Medium | Correctness fix |
| B6 | CTFE code path consolidation | 🟢 Small | Clarity improvement |
| B7 | HTML parser (no changes needed) | ✅ Done | `as any` casts already gone |
| B8 | Post-build compressor improvements | 🟢 Small | Minor compression gains |
| B9 | `activeSelectorMap` → BuildContext | 🟡 Medium | Architecture cleanup |
| B10 | Selector name generation | ✅ N/A | Already optimal |

---

## Execution Order

```
Phase A (benchmark between each):
  A1: adoptedStyleSheets          → benchmark
  A3: consolidate data attributes → benchmark
  A2: destroyComponent + WeakMap  → benchmark
  A5: reusable Set in reconciler  → benchmark
  A4: signal error boundary       → benchmark (highest risk — last)

Phase B (batch):
  B1 + B2 + B4: AST-based replacements in index.ts (do together)
  B5 + B6: component-precompiler fixes (do together)
  B3: template/repeat code sharing (largest, do alone)
  B8: post-build compressor patterns
  B9: activeSelectorMap → BuildContext
```

---

## Items Confirmed as No-Change-Needed

| Item | Reason |
|---|---|
| A6 (`getTempEl`) | Architecturally safe — JS is single-threaded, all callers are synchronous. Add a comment only. |
| A7 (cleanup arrays) | False positive — arrays are sized at creation, never grow. |
| B7 (`as any` in parser-core) | Already fixed — no `as any` casts remain. |
| B10 (selector names) | Already optimal — custom elements require a hyphen, 3 chars is minimum. |
