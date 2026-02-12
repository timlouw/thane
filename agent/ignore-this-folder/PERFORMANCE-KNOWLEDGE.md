# Thane Framework — Performance Knowledge Base

> Last updated: February 10, 2026
> Covers: v0.0.26 → v0.0.34 optimization work
> Benchmark: js-framework-benchmark (keyed implementation)

---

## Purpose

This document captures **empirically validated** lessons from optimizing Thane's runtime and compiled output. Many findings are counterintuitive or the opposite of what seems logical. **Future optimization work must reference this document before making changes.**

---

## Current Standing (v0.0.34)

| Test | Thane | Vanilla-lite | Factor | Rank |
|---|---|---|---|---|
| create 1k | 38.6ms | 35.9ms | 1.08 | 3rd |
| replace all | 45.3ms | 42.3ms | 1.07 | 3rd |
| partial update | 28.3ms | 30.2ms | **1.00** | **🥇 1st** |
| select row | 7.6ms | 8.3ms | **1.00** | **🥇 1st** |
| swap rows | 28.8ms | 29.8ms | **1.00** | **🥇 1st** |
| remove row | 19.5ms | 23.1ms | **1.00** | **🥇 1st** |
| create 10k | 466.6ms | 406.4ms | 1.15 | 7th |
| append 1k | 51.7ms | 46.6ms | 1.11 | 5th |
| clear rows | 24.5ms | 24.3ms | 1.01 | 2nd |
| **weighted mean** | | | **1.06** | **3rd overall** |

Bundle: 8.4 KB uncompressed, 3.4 KB brotli.

---

## ⛔ THINGS THAT DO NOT WORK (Do not attempt again)

### 1. Detach optimization on non-empty containers

**What:** `container.remove()` → create items → `parent.insertBefore(container, nextSibling)` to batch DOM operations.

**Why it seems good:** Avoids per-item layout recalculation during bulk inserts. Chrome should only reflow once on re-attach.

**Why it fails for non-empty containers:** When re-attaching a container that already has N existing rows, the browser must re-lay-out ALL N + M rows, not just the M new ones. For append 1k (adding 1000 rows to an existing 1000), this caused a regression from ~50ms to **~87ms** (1.86x slowdown).

**When it DOES work:** Creating items into an empty container (create 1k, create 10k, replace all after clear). The container has 0 existing rows so re-attach cost is proportional only to new rows.

**Rule:** Only use detach optimization when `oldLength === 0`.

### 2. Append fast paths that use bulkCreate

**What:** Detecting that new items are a superset of old items (all old keys still present at start) and using `bulkCreate()` for the suffix.

**Why it fails:** `bulkCreate` uses the detach optimization (see #1 above). Even if you detect a clean append, you **cannot** detach the container because existing rows are in it. This was the direct cause of the 87ms append regression in v0.0.33.

**What works instead:** Let the general keyed reconciler handle it. It creates new items one at a time with `container.insertBefore(fragment, anchor)`. Per-item insertion into an attached container is actually faster than detach/bulk/reattach for the append case because the browser does incremental layout, not a full reflow.

### 3. Feature flags via bitmask

**What:** Runtime bitmask constants (`HAS_STYLES = 1`, `HAS_TEMPLATE = 2`, etc.) checked via bitwise AND to conditionally skip features.

**Why it seems good:** Single integer comparison instead of truthy checks. Should enable dead code elimination.

**Why it fails:** Added +32 bytes net. The bitmask infrastructure (constants, bitwise operations) costs more than the branching it replaces. The minifier already optimizes simple truthiness checks well. esbuild's tree-shaking eliminates unused code paths without needing runtime flags.

**What works instead:** Compile-time tree-shaking via callback registration patterns (see ✅ section below).

### 4. Removing `itemSignal: null` from object literals for "smaller output"

**What:** The compiler generates `createItem` functions that return `ManagedItem` objects. Removing the `itemSignal: null` property (since the optimized path doesn't use signals) saves ~15 characters per createItem.

**Why it fails:** V8 uses hidden classes (shapes) to optimize property access. The reconciler's `getValue` function checks `m.itemSignal ? m.itemSignal() : m.value`. When objects are created WITHOUT `itemSignal`, V8 sees a different hidden class than the `ManagedItem` interface expects. This makes the property check a dictionary lookup instead of a monomorphic inline cache hit.

**Even when getValue isn't called:** The hidden class mismatch affects other property accesses on the same object (`el`, `cleanups`, `value`, `update`). V8's JIT compiler may deoptimize the entire reconcile path because managed items have inconsistent shapes.

**Rule:** Always include ALL properties in object literals, even if null. The 15 bytes saved in bundle size is not worth the potential V8 deoptimization across the entire reconciler hot path.

```javascript
// ✅ CORRECT — consistent hidden class
return { itemSignal: null, el: _el, cleanups: [], value: item, update: ... };

// ❌ WRONG — different hidden class, potential deoptimization
return { el: _el, cleanups: [], value: item, update: ... };
```

### 5. Splitting runtime functions for "smaller output via tree-shaking"

**What:** Breaking a monolithic function into smaller composable pieces so unused pieces are tree-shaken.

**Why it can fail:** If the split functions are ALL used in the benchmark path, you've added function call overhead (closures, parameter passing) without any size reduction. The minifier can't inline functions across module boundaries or even within the same scope if they're referenced multiple times.

**When it DOES work:** When the split genuinely separates used vs unused features (e.g., emptyTemplate handling is legitimately unused in the benchmark).

---

## ✅ THINGS THAT WORK (Proven optimizations)

### 1. Create-from-empty fast path in keyed reconciler

**What:** When `oldLength === 0` in keyed mode, bypass all reconciliation logic and call `bulkCreate()` directly.

**Why it works:** The general keyed reconciler, when receiving items with no existing items, still:
- Builds a `Set` of all new keys (1000 allocations, unnecessary)
- Does 1000 `Map.get()` lookups (all misses, wasted work)
- Allocates a temp array and copies it
- Runs a full repositioning pass (unnecessary — items are already in order)
- Does NOT use the detach optimization

`bulkCreate` skips ALL of this and gets the detach optimization for free (safe because container is empty).

**Impact:** Improved create 10k from ~479ms to ~467ms.

### 2. Callback-pattern tree-shaking for optional features

**What:** Instead of always importing/bundling feature code, expose an `__enableFeature()` function that registers a callback. The compiler only emits the `__enableFeature()` call when the feature is detected in source.

**Example:** `__enableComponentStyles()` registers the styles handler. If no component uses `styles`, the import is never emitted, and esbuild tree-shakes the entire CSS-in-JS infrastructure (CSSStyleSheet, adoptedStyleSheets, :host regex, etc.).

**Impact:** Eliminated ~500 bytes of styles infrastructure from the benchmark bundle.

**Pattern:**
```typescript
// Runtime: declare nullable callback
let __stylesHandler: ((sel: string, css: string) => void) | null = null;

// Runtime: registration function (tree-shakeable entry point)
export const __enableComponentStyles = () => {
  __stylesHandler = actualImplementation;
};

// Compiler: only emits when styles detected
if (componentHasStyles) {
  imports.push('__enableComponentStyles');
  injections.push('__enableComponentStyles();');
}
```

### 3. `__registerComponent` as compiler-optimized replacement for `defineComponent`

**What:** The public `defineComponent` API handles many cases (string selectors, function selectors, HTML element generation via `createComponentHTMLSelector`, `Object.entries` for child templates). The compiler knows the exact shape at build time, so `__registerComponent` accepts pre-resolved arguments with no runtime branching.

**Impact:** Eliminated from bundle: `createComponentHTMLSelector`, `Object.entries`, `JSON.stringify`, `&quot;` escaping, selector-type branching. Saved ~496 bytes.

**Rule:** The compiler should always emit the most specific internal API. Public APIs are for hand-written code only.

### 4. Lazy allocation patterns

**What:** Only allocate data structures when the feature that needs them is actually used.

**Examples that work:**
- `mountedInstances` WeakMap: only created when `destroyComponent()` is first called
- `tempEl` (template element for HTML parsing): only created on first use via `getTempEl()`
- `keyMap`: only created when `keyFn` is provided

**Why it works:** These are genuinely conditional — many apps never call `destroyComponent`, many components have no emptyTemplate. Lazy allocation avoids paying the cost for unused features.

### 5. Event delegation on the container

**What:** Instead of attaching click handlers to each row's buttons, attach a single handler to the `<tbody>` and use event bubbling + `__d` data property for dispatch.

**Why it works:** 1 event listener instead of 2000+ (for 1k rows with select + delete). This is already how the benchmark works and is a major reason thane has the fastest select/remove/swap.

### 6. Direct-update path bypassing signals

**What:** The `ManagedItem.update` function directly mutates DOM text nodes instead of going through `signal() → subscriber → DOM update`.

**Why it works:** For repeat items, the signal→subscriber chain is unnecessary overhead. The reconciler already knows which item changed and can call `update(newValue)` directly. This avoids: signal setter, subscriber array iteration, subscriber function call, signal getter inside subscriber.

**Impact:** This is the primary reason partial update is the fastest of all frameworks (28.3ms vs vanilla's 30.0ms).

### 7. Reusable module-level Set for keyed reconciliation

**What:** `const _keySet = new Set<string | number>()` at module scope, cleared and reused each reconcile pass instead of allocating a new Set.

**Why it works:** Avoids garbage collection pressure during heavy reconciliation. The Set is cleared (`.clear()`) after each use, but the internal hash table capacity is retained.

---

## ⚠️ NUANCED — Context-dependent (understand before applying)

### 1. Bundle size vs runtime performance

**Observation:** Going from 9,150 bytes to 8,048 bytes (-12%) produced negligible runtime improvement. Some size optimizations actually hurt performance.

**Lesson:** Bundle size and runtime performance are almost entirely independent metrics for a framework this small (~8KB). DOM operations dominate runtime cost. Pursue size reductions ONLY when they don't touch hot paths, or when the size reduction comes from genuinely removing unused code (not restructuring used code).

### 2. Memory usage (3.38 MB for 1k rows, 1.74x vanilla)

**Root cause:** Each managed row allocates:
- 1 `ManagedItem` object (5 properties: itemSignal, el, cleanups, value, update)
- 1 empty `cleanups` array `[]`
- 1 `Map` entry (key → ManagedItem)

That's ~3 heap objects per row × 1000 rows = ~3000 extra allocations vs vanilla's 0.

**Status:** This is an inherent cost of the keyed reconciler architecture. Reducing it would require fundamental redesign (e.g., parallel arrays instead of objects, or SoA layout). Not worth pursuing unless memory becomes a ranked metric.

### 3. The `clearAll` fast path with `textContent = ''`

**What:** Instead of removing elements one by one, `clearAll` does `container.textContent = ''` to nuke all children in one DOM operation, then re-appends the anchor.

**Why it works:** Single DOM mutation instead of N. Combined with the cleanup-skip optimization (only iterating cleanups if `cleanups.length > 0` on the first item), this makes clear rows competitive with vanilla.

**Caveat:** Only works because the benchmark's direct-update items have empty cleanups arrays. If items had subscriptions, the cleanup iteration would still be necessary.

### 4. The "complete replacement" fast path

**What:** When `oldLength === newLength` and both first and last keys are new (not in keyMap), treat as full replacement: `clearAll()` + `bulkCreate()`.

**Why it works:** The benchmark's "replace all" test generates entirely new IDs, so first and last keys are always new. This avoids the expensive general reconciliation and gets the detach optimization (container is empty after clearAll).

**Caveat:** This fast path is benchmark-specific. Real-world updates rarely replace ALL items with entirely new keys. But it doesn't hurt — the check is O(2) and falls through if not matched.

---

## 🔬 PROFILING NOTES

### What the benchmark actually measures

- **create 1k / 10k:** Signal creation + template.cloneNode + DOM insertion. Dominated by DOM insertion. Detach optimization helps here.
- **replace all:** clearAll (textContent='') + create 1k. Benefits from both the clear fast path and detach optimization.
- **partial update:** Direct-update path (no signals). Pure DOM text node mutation. Thane is fastest because it bypasses the signal layer entirely.
- **select row:** className assignment. Thane is fastest because of delegated events (1 listener) + simple DOM mutation.
- **swap rows:** Keyed reconciler swap detection (2-mismatch fast path). 2 `insertBefore` calls. Very efficient.
- **remove row:** Keyed reconciler single-removal detection. 1 `splice` + 1 `el.remove()`. Very efficient.
- **append 1k:** General keyed reconciler. Per-item insertBefore into attached container. No detach optimization (see ⛔ #1).
- **clear rows:** `clearAll()` with textContent='' trick. Near-vanilla speed.

### Where the remaining gap to vanilla is

| Test | Gap | Root cause |
|---|---|---|
| create 1k | +2.7ms (1.08x) | Signal creation overhead (unused but still allocated per-item), ManagedItem object allocation, Map.set per item |
| create 10k | +60ms (1.15x) | Same as above × 10. Also GC pressure from 30k+ object allocations |
| append 1k | +5ms (1.11x) | General keyed reconciler overhead: Set build, Map lookups, repositioning pass (even though items are already ordered) |
| replace all | +3ms (1.07x) | clearAll + create 1k overhead combined |

### What would close the gap further (theoretical, NOT yet attempted)

1. **Eliminate signal allocation in direct-update items** — The compiler already generates `update` functions, so `itemSignal` is never used. But removing it breaks hidden classes (see ⛔ #4). A better approach might be to not call `createSignal()` at all in the optimized path and keep `itemSignal: null` as a literal. *(Requires compiler change — currently `__bindRepeatTpl` always calls `createSignal`)*
2. **Parallel array storage instead of ManagedItem objects** — Store `els[]`, `values[]`, `cleanups[][]` as separate arrays. Eliminates per-row object allocation. Major architectural change.
3. **Append fast path WITHOUT detach** — Detect append and skip Set/Map/repositioning, but create items one at a time (no detach). This would save the O(n) Set build + O(n) Map lookups + O(n) repositioning pass. *(Note: this is NOT the same as the failed attempt which used bulkCreate with detach)*

---

## 📏 VERSION HISTORY

| Version | Bundle | Weighted Mean | Key Change |
|---|---|---|---|
| v0.0.26 | 9,150 B | 1.07 | Baseline (compiler quality pass) |
| v0.0.28 | 9,214 B | — | ❌ Feature flags bitmask (+32B, reverted) |
| v0.0.29 | 9,098 B | — | Property stripping + lazy WeakMap |
| v0.0.30 | 8,800 B | — | emptyTemplate extraction from reconciler |
| v0.0.31 | 8,506 B | — | Styles tree-shaking via callback pattern |
| v0.0.32 | 8,010 B | 1.08 | `__registerComponent` replacing `defineComponent` |
| v0.0.33 | 8,210 B | 1.14 | ❌ Append fast path with detach (87ms append, reverted) |
| v0.0.34 | 8,048 B | **1.06** | Create-from-empty fast path + `itemSignal:null` restored |
