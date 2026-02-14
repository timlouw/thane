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

### 4. Append fast path WITHOUT detach (non-detach variant)

**What:** Detect that new items are a superset of old items (all old keys at same positions) and skip the general reconciliation path. Create only the new suffix items one at a time via `insertBefore(frag, anchor)` without detaching the container.

**Why it seems good:** Avoids building the `_keySet` Set (1000 `.add()` calls), 1000 `Map.get()` lookups, and the full repositioning pass. Should save O(n) overhead on the existing items since only the new suffix needs creation.

**Why it fails:** The detection loop itself costs O(n) — checking `keyFn(newItems[i], i) !== keyFn(managedItems[i].value, i)` for all existing rows. This overhead is comparable to what the general reconciler does anyway (it also iterates old items once). The net effect is near-zero runtime improvement with +230 bytes of bundle size.

**Tested in:** v0.0.48. Bundle went from 6.47 KB to 6.70 KB prod. Benchmark showed no measurable improvement on append 1k.

**Lesson:** The general keyed reconciler is already efficient for pure-append cases because: (1) all old keys are found in the Map (O(1) each), (2) no elements need repositioning (they're already in order), (3) new items are inserted at the anchor. The overhead of Set build + Map lookups is negligible compared to DOM insertion cost.

### 4. Feature flags via bitmask

**What:** Runtime bitmask constants (`HAS_STYLES = 1`, `HAS_TEMPLATE = 2`, etc.) checked via bitwise AND to conditionally skip features.

**Why it seems good:** Single integer comparison instead of truthy checks. Should enable dead code elimination.

**Why it fails:** Added +32 bytes net. The bitmask infrastructure (constants, bitwise operations) costs more than the branching it replaces. The minifier already optimizes simple truthiness checks well. esbuild's tree-shaking eliminates unused code paths without needing runtime flags.

**What works instead:** Compile-time tree-shaking via callback registration patterns (see ✅ section below).

### 5. Removing `itemSignal: null` from object literals for "smaller output"

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

### 6. Splitting runtime functions for "smaller output via tree-shaking"

**What:** Breaking a monolithic function into smaller composable pieces so unused pieces are tree-shaken.

**Why it can fail:** If the split functions are ALL used in the benchmark path, you've added function call overhead (closures, parameter passing) without any size reduction. The minifier can't inline functions across module boundaries or even within the same scope if they're referenced multiple times.

**When it DOES work:** When the split genuinely separates used vs unused features (e.g., emptyTemplate handling is legitimately unused in the benchmark).

### 7. Single-pass same-length reconciliation (P3+P4 merge)

**What:** Merge the two-pass same-length reconciliation (pass 1: `keyMap.has()` existence check; pass 2: `keyMap.get()` + value update + mismatch detection) into a single loop doing `keyMap.get()` + null check + value update + mismatch detection in one pass.

**Why it seems good:** Eliminates 1000 redundant `keyFn` calls and 1000 `Map.has()` operations. The merged loop does the same work in one iteration instead of two.

**Why it fails:** V8 optimizes the two-pass pattern better than the merged version. The tight `Map.has()` loop (pass 1) compiles to a branch-prediction-friendly monomorphic check. The separate `Map.get()` loop (pass 2) also gets specialized independently. Merging them into one loop with a null check + value update + mismatch comparison creates a more complex loop body that V8's JIT optimizes less aggressively.

**Tested in:** v0.0.51. Partial update regressed from 1.18× to 1.23× (the primary test exercising this path). Replace all improved 1.19× → 1.14× but overall geo mean worsened 1.16× → 1.17×.

**Rule:** V8 prefers simple, tight loops with one purpose over complex multi-purpose loops. Two passes of O(n) with simple bodies beats one pass of O(n) with a complex body. Do not merge reconciler passes.

### 14. Reconciler micro-optimizations (merged loops, splice→shift, in-place compaction, push→indexed)

**What:** Six simultaneous changes to the `reconcile()` function body: (1) Merged the separate `allKeysExist` check loop and update loop into a single pass — `keyMap.get()` replaces `keyMap.has()` + `keyMap.get()`, halving keyFn calls from 2N to N. (2) Fixed correctness bug where `mismatchCount > 2` break exits before calling `update()` on remaining items. (3) Eliminated `newManagedItems` temp array in same-length general reorder by writing directly to `managedItems`. (4) Replaced `managedItems.splice(removedIdx, 1)` with manual shift loop in single-removal path. (5) Replaced `kept[]` array with in-place write-pointer compaction in general reconciliation. (6) Replaced `managedItems.push()` with indexed assignment at 3 sites.

**Why it seems good:** The merged loop halves keyFn calls (the most common path — partial update, select row, swap rows). Manual shift avoids splice's hidden return-array allocation. In-place compaction eliminates 1 array alloc. Indexed assignment avoids push() bounds checks. No new closure variables, no ManagedItem shape changes, no function signature changes — all changes are purely inside the reconcile() function body. Bundle shrank 6.62→6.52 KB.

**Why it fails:** Geo mean regressed **1.14× → 1.19×**. Select row catastrophically regressed **~1.04× → 1.17×**. Partial update 1.20→1.24×. Swap rows 1.18→1.24×. Replace all 1.18→1.20×. Remove row regressed to 1.20×. Clear rows 1.10→1.14×. Run memory regressed to 1.72×. Root cause: **⛔ #7 confirmed again** — V8's TurboFan optimizes simple tight single-purpose loops far better than complex multi-purpose loops. The original separate `allKeysExist` loop (`keyMap.has()` only — pure boolean check) and `update` loop (`keyMap.get()` + value compare + update call) are each simple enough for V8 to fully optimize. The merged loop does has-check + get + update + mismatch-tracking in one body, which is too complex for V8's loop analysis. Additionally, replacing native `splice()` (C++ implementation) with a JS manual shift loop is slower — V8's native splice is highly optimized for small removals. `push()` is also heavily optimized in V8's fast path — replacing it with indexed assignment + `length` manipulation doesn't help.

**Tested in:** v0.0.63. Every single benchmark test regressed.

**Rule:** Do not merge separate reconciler loops to reduce iteration count. V8's TurboFan generates better code for two simple N-iteration loops than one complex N-iteration loop. Do not replace native array methods (`splice`, `push`) with manual JS equivalents — V8's builtins are C++ optimized. The reconciler's existing loop structure is already well-matched to V8's optimization heuristics. "Fewer iterations" ≠ "faster" when V8's JIT is involved.

---

### 13. Batch template cloning (mega-template with 50 pre-cloned rows)

**What:** Generated a "mega-template" at module scope containing 50 copies of the row template. When `bulkCreate` needs ≥50 items, clones the mega-template once to get 50 pre-split DOM elements, then fills each via the same `createItemFn` (using coordination variables `_preCloned` and `_skipInsert` to avoid double-cloning and double-inserting). Remainder items (<50) use normal per-item clone. Runtime `createKeyedReconciler` accepted an optional `batchFn` parameter (clean API, no monkey-patching). Eligible only for simple rows without nested directives/signals/non-delegatable events.

**Why it seems good:** `cloneNode(true)` on a 50-row fragment should be faster than 50 individual `cloneNode(true)` calls — browsers optimize deep clones of template content. The mega-template is created once at module scope (zero per-render cost). The batch function handles any list size (≥50 get mega-clones, remainder per-item). Clean API: `batchFn` as a 5th parameter to `createKeyedReconciler`, no dead code for apps that don't use batch-eligible repeats.

**Why it fails:** Geo mean regressed 1.14× → 1.16×. Select row 1.04→1.06×, clear rows 1.10→1.15×, partial update 1.20→1.23×, swap rows 1.18→1.20×. Multiple compounding causes: (1) The `createItemFn` now captures 2 extra closure variables (`_preCloned`, `_skipInsert`) which changes V8's optimization of the entire init closure scope — per ⛔ #9, extra captured variables degrade closure optimization. (2) The conditional branches inside `createItemFn` (`_preCloned || _cloneNode.call(...)` and `if (!_skipInsert)`) add branch misprediction overhead on EVERY item creation, even when not in batch mode. (3) The `batchFn` parameter (even as undefined) may alter V8's type feedback for the `createKeyedReconciler` function itself. (4) The named `createItemFn` (extracted from inline to a `const`) may have different optimization characteristics than the anonymous inline version.

**Tested in:** v0.0.61. Create 1k 1.14→1.16×, replace all 1.13→1.15×, select row 1.04→1.06×, swap rows 1.18→1.20×, clear rows 1.10→1.15×.

**Rule:** Do not add coordination variables or conditional branches to `createItemFn` for batch optimization. The per-item hot path must remain unconditional and minimal. Even when the batch path is only used for bulk creation, the coordination variables in the shared closure scope degrade V8's optimization of ALL paths through that closure (individual creates during reconcile, updates, etc.). The 50-item `cloneNode` batching benefit is overwhelmed by the constant-factor overhead of conditional branches on every single item operation.

---

### 12. Null cleanups instead of empty array for repeat items without nested directives

**What:** Changed the compiled `createItemFn` to return `cleanups: null` instead of `cleanups: []` for repeat items that have no nested conditionals/repeats/subscriptions. Added `if (cleanups)` null guards in the runtime's `removeItem` and `clearAll` before iterating. Saves 1000 empty array allocations per create-1k (~32KB).

**Why it seems good:** The benchmark rows have zero cleanups. Allocating 1000 empty `[]` arrays is pure waste — they're never iterated (V8 sees `length === 0` and exits immediately, but the allocation + GC overhead remains). Using `null` eliminates the allocation entirely. The null guard (`if (cleanups)`) is perfectly branch-predicted (always false for benchmark rows).

**Why it fails:** Geo mean regressed 1.14× → 1.16×. Select row regressed **1.04× → 1.17×**, clear rows regressed **1.10× → 1.20×**. Changing the `cleanups` property value from `[]` (Array type) to `null` (null type) alters V8's type feedback for ManagedItem objects. Even though the object still has 5 own properties with the same names, V8 tracks property *types* in hidden class transitions. The `cleanups: null` type profile is different from `cleanups: []`, which changes the inline cache behavior for ALL property accesses on ManagedItem objects (`.el`, `.value`, `.update`), not just `.cleanups`.

**Tested in:** v0.0.59. Create rows regressed 1.14→1.17, select row 1.04→1.17, clear rows 1.10→1.20.

**Rule:** Do not change the VALUE TYPE of any ManagedItem property. V8's hidden classes encode both property names AND value types. Even `null` vs `[]` for the same property name produces a different hidden class transition chain, degrading inline caches for the entire object. The cost of allocating empty arrays (fast-path in V8) is far less than the cost of polymorphic type feedback on the hot reconciliation path.

---

### 11. Class-based ManagedItem (shared prototype update, instance DOM refs)

**What:** Instead of returning object literals `{ itemSignal, el, cleanups, value, update }` from the `createItemFn` closure, generated a module-scope `class _R_b0` with a constructor that caches navigated DOM refs as instance properties (`this._0`, `this._1`) and a shared `update(item)` method on the prototype. The `createItemFn` became `new _R_b0(clone, item)` + `insertBefore` + `return`.

**Why it seems good:** All 1000 rows share a single prototype with one `update` function instead of 1000 per-row closures. Constructor assigns `_0`, `_1` instance props directly — no closure context needed. Should reduce memory and improve update throughput via V8's monomorphic prototype dispatch.

**Why it fails:** Swap rows regressed **1.00× → 1.21×** (catastrophic). Partial update regressed 1.20→1.25×. Class instances have 7+ properties (itemSignal, el, cleanups, value, _0, _1 plus prototype methods) vs the object literal's 5 properties. V8's inline caches in the reconciler loop (reading `.el`, `.value`, calling `.update`) were tuned for the 5-property hidden class. The class instances produce a different hidden class, degrading all property accesses across the hot reconciliation path. Additionally, `this._0.firstChild.nodeValue` (property lookup on receiver) is slower than closure-captured `_e0.firstChild.nodeValue` (direct local variable read) on the update path.

**Tested in:** v0.0.56. Geo mean stayed flat at 1.15×. Memory improved slightly (3.34→3.29 MB). Select row improved 1.19→1.00× but swap rows destroyed.

**Rule:** The reconciler's hot path is extremely sensitive to the hidden class shape of ManagedItem objects. All items flowing through `createKeyedReconciler` must have exactly 5 own properties `{itemSignal, el, cleanups, value, update}` and no more. Adding extra instance properties changes the V8 hidden class and degrades inline caches for the reconciler's `.el`, `.value`, `.update` accesses. Stick with object literals + closure-captured DOM refs.

---

### 10. Inline DOM navigation in update closure (eliminate captured nav vars)

**What:** Changed the per-row `update` closure to navigate from `_el` directly (`_el.firstElementChild.firstChild.nodeValue = ...`) instead of using cached variables (`_e0.firstChild.nodeValue = ...`). Reduces closure captures from N+1 variables (_e0..._eN + _el) to just 1 (_el only). The nav vars become stack-local during creation and are freed after `createItemFn` returns.

**Why it seems good:** Fewer closure captures = smaller V8 closure context per row. For 1000 rows with 2 bindings, eliminates 2000 retained DOM references. Creation is faster (1.16→1.11 for create rows). Memory is slightly lower (3.34→3.32 MB).

**Why it fails:** Partial update regressed 1.20→1.26. The update path must re-walk the DOM tree via `firstElementChild`/`nextElementSibling` chains on every call, which is slower than reading a cached reference. V8's inline caching works better with shorter property chains. Clear rows also regressed (1.11→1.18). Geo mean stayed flat at 1.15×.

**Tested in:** v0.0.55. Create rows and select row improved, but partial update and clear rows regressed.

**Rule:** Keep DOM element references cached in closure variables for the update path. The cost of re-navigating sibling chains on every update exceeds the small memory savings from fewer closure captures. V8's closure context is a single allocation regardless of capture count — going from 3 to 1 captured variable saves ~16 bytes per row, not worth the CPU cost.

---

### 9. Skip cleanup iteration via `hasCleanups` flag

**What:** Added `hasCleanups = true` as a 5th parameter to `createKeyedReconciler`. When `false` (compiler knows rows have no subscriptions/nested directives), `clearAll` and `removeItem` skip iterating the cleanups arrays entirely. Saves 1000 iterations of empty arrays on clear/replace-all.

**Why it seems good:** The benchmark rows have zero cleanups — iterating 1000 empty arrays in `clearAll` is pure waste. A compile-time flag eliminates the loop at near-zero code cost (~40 bytes).

**Why it fails:** Benchmark regression from 1.16× → 1.18× geo mean. Clear rows stayed flat (1.20×) — the empty-array iteration is already near-zero cost (V8 sees `length === 0` and exits immediately). Meanwhile, partial update regressed 1.18× → 1.26×. The extra closure variable (`hasCleanups`) captured in the reconciler changes V8's optimization profile for the entire closure scope, affecting unrelated hot paths like the same-length reconciliation loop.

**Tested in:** v0.0.52.

**Rule:** Do not add conditional flags to the reconciler closure scope. V8 optimizes closures holistically — an extra captured boolean changes the JIT profile of every function in the scope, even those that never read it. The cost of iterating empty arrays (early `length === 0` exit) is negligible.

---

### 8. Shared empty cleanups array (`_noClean`)

**What:** Instead of each row allocating its own `cleanups: []`, the compiler emits a shared module-level `const _noClean = [];` and all ManagedItem objects reference it. Eliminates ~1000 array allocations per 1k create.

**Why it seems good:** All benchmark rows have empty cleanups. Sharing one array object eliminates 1000 allocations, reducing GC pressure. The ManagedItem hidden class shape is preserved (same 5 property keys in same order).

**Why it fails:** Benchmark regression from 1.16× to 1.19× weighted geo mean. Every test got slower except append. Likely cause: V8 optimizes property access patterns based on the identity of values, not just their shape. When all 1000 ManagedItems point to the exact same `cleanups` array object, V8 may apply different internal assumptions (e.g., the array could be mutated and affect all items). A fresh `[]` per row tells V8 each item is independent, enabling more aggressive per-object optimizations.

**Tested in:** v0.0.50. Memory improved marginally (3.38 → 3.34 MB) but runtime regressed across the board.

**Rule:** Do not share mutable object references across ManagedItems, even if the objects are never actually mutated. V8’s JIT makes assumptions about object identity that affect the entire reconciler hot path. Each row must get its own `[]`.

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
3. ~~**Append fast path WITHOUT detach**~~ — ❌ Attempted in v0.0.48 — detection loop O(n) cost ≈ reconciler overhead. No improvement, +230B bundle. Moved to ⛔ #3.

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
