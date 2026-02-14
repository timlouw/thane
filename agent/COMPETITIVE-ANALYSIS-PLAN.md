# Competitive Analysis: Top Framework Optimization Plan

> Generated: February 2026
> Based on analysis of: **vanillajs-lite** (#1), **vanillajs-3** (#2), **vanillajs** (keyed)
> Current Thane: v0.0.55 (code matches v0.0.54 after revert), geo mean **1.15×**

---

## ⚠️ STALE PACKAGE — FIX FIRST

The v0.0.55 revert (closure inlining → cached vars) was applied to `codegen.ts` but the npm
package was **not rebuilt**. The benchmark is still running v0.0.55 inline-nav code in update
closures. Before any new optimization:

1. `npm run build` in main project
2. `npm version patch` → v0.0.56
3. `npm pack` → thane-0.0.56.tgz
4. Update `benchmark/package.json` to reference new tgz
5. `npm install --force` in benchmark
6. Re-benchmark to establish true v0.0.54-reverted baseline

**Expected effect:** Partial update should improve (1.26× → ~1.20×) since update closures
will use cached `_e0`/`_e1` instead of re-navigating from `_el`.

---

## What the Top Frameworks Do Differently

### vanillajs-lite (Rank #1)

| Pattern | Detail |
|---|---|
| **Batch template cloning** | Clones a fragment with 50 rows, fills all 50, then `insertBefore(clone(TMPL), null)`. Amortizes DOM insertion (20 inserts for 1000 rows instead of 1000). |
| **Zero per-row heap objects** | No wrapper object, no Map, no closure per row. The DOM IS the data store. |
| **Live HTMLCollection** | `ROWS = TBODY.children` — a live NodeList. Update/swap access `ROWS[i]` directly. No parallel JS array maintenance. |
| **Expando property caching** | `(r.$id ??= r.firstChild.firstChild).nodeValue = ID++` — caches DOM navigation result directly on the TR element. Nullish coalescing means first access navigates, subsequent accesses reuse. |
| **Cached prototype methods** | `const {cloneNode, insertBefore} = Node.prototype;` then `cloneNode.call(n, true)` — avoids prototype chain walk per call. |
| **Direct DOM mutation for update** | `labelOf(r).nodeValue += ' !!!'` — no reconciler, no signal, no identity check. 100 iterations for 100 updates. |
| **No data model** | Doesn't maintain a `data[]` array. `r.remove()` for delete operates on DOM directly. |
| **Clear = `textContent = ''`** | Zero iteration cleanup. No Map.clear(), no managedItems.length = 0. |

### vanillajs-3 (Rank #2)

| Pattern | Detail |
|---|---|
| **Operation caching** | Caches the previous operation type (`op`). If same op repeats (e.g. consecutive updates), reuses cached DOM refs from prior call. |
| **Lazy element caching on data objects** | `item.el = item.querySelector('a').firstChild` — first access queries DOM, stores result on the data object itself. Subsequent calls reuse `item.el`. |
| **Linked list for update traversal** | Builds `item.next` linked list during first update pass. Subsequent update passes follow `item.next` links instead of querying `tbody.childNodes[i]`. |
| **String-based data** | `data[i] += ' !!!'` — mutates strings directly instead of creating new objects. Eliminates identity comparison overhead. |

### vanillajs (Keyed, Rank ~3)

| Pattern | Detail |
|---|---|
| **Parallel rows[] array** | `this.rows[i]` maps directly to TR elements. No wrapper. |
| **Detach on empty** | `empty && tbody.remove()` before bulk create, `table.insertBefore(tbody, null)` after. |
| **Direct swap** | `this.tbody.insertBefore(this.rows[998], this.rows[2])` — direct array index to DOM element. |

---

## Fundamental Architecture Gap

**Per-row heap cost comparison:**

| Framework | Objects/row | What |
|---|---|---|
| vanillajs-lite | **0** | DOM element only |
| vanillajs-3 | **1** | Data object (lazy-cached el) |
| vanillajs (keyed) | **1** | rows[i] = TR reference |
| **Thane** | **4** | ManagedItem + cleanups[] + update closure + Map entry |

For 1000 rows, Thane allocates ~4000 extra heap objects vs vanilla's ~0-1000. This is the
primary source of the gap on create/replace tests.

**Per partial-update cost comparison:**

| Framework | Operations for 100 updates in 1000 rows |
|---|---|
| vanillajs-lite | 100 DOM reads + 100 nodeValue writes = **200 ops** |
| **Thane** | 1000 keyFn + 1000 Map.has + 1000 keyFn + 1000 Map.get + 1000 comparisons + 100 update calls = **~5100 ops** |

Thane does ~25× more work per partial update. The Map operations are fast (V8-optimized integer
keys) so the wall-clock ratio is only ~1.20×, but the overhead is structurally unavoidable
without changing the signal→reconcile architecture.

---

## Optimization Ideas — Ranked by Feasibility

### TIER 0: Fix stale package (MUST DO FIRST)

See top of document. The benchmark is running unreversed v0.0.55 code.

---

### TIER 1: Codegen-only changes (low risk)

These modify only the compiler's code generation — no runtime (dom-binding.ts) changes.

#### Idea 1: Prototype-based Update via Compiler-Generated Class

**Source inspiration:** vanillajs-lite's zero-closure architecture, vanillajs-3's lazy cached
refs on data objects.

**What:** Instead of creating a per-row closure for `update`, the compiler generates a class
per repeat block. The `update` method lives on the prototype (shared by all instances).
Cached DOM refs become instance properties instead of closure-captured variables.

**Current codegen (per row creates a closure):**
```js
(item, _idx, _ref) => {
  const _el = _tc_b0.cloneNode(true);
  const _e0 = _el.firstElementChild;                                  // stack local
  const _e1 = _el.firstElementChild.nextElementSibling.firstElementChild; // stack local
  _e0.firstChild.nodeValue = item.id;
  _e1.firstChild.nodeValue = item.label;
  _ct_b0.insertBefore(_el, _ref);
  return {
    itemSignal: null, el: _el, cleanups: [], value: item,
    update: (item) => { _e0.firstChild.nodeValue = item.id; _e1.firstChild.nodeValue = item.label; }
    //                   ^^^ closure captures _e0, _e1, _el — unique per row
  };
}
```

**Proposed codegen (shared prototype, cached refs as instance props):**
```js
// Module scope — ONE class definition, shared by all 1000 rows
class _Row_b0 {
  constructor(el, item) {
    this.itemSignal = null;
    this.el = el;
    this.cleanups = [];
    this.value = item;
    this._0 = el.firstElementChild;                                  // cached ref
    this._1 = el.firstElementChild.nextElementSibling.firstElementChild; // cached ref
  }
  update(item) {
    this._0.firstChild.nodeValue = item.id;
    this._1.firstChild.nodeValue = item.label;
  }
}
// In createItemFn:
(item, _idx, _ref) => {
  const _el = _tc_b0.cloneNode(true);
  const managed = new _Row_b0(_el, item);
  managed._0.firstChild.nodeValue = item.id;  // fill (could be inlined in constructor)
  managed._1.firstChild.nodeValue = item.label;
  _ct_b0.insertBefore(_el, _ref);
  return managed;
}
```

**What changes:**
- `src/compiler/plugins/reactive-binding-compiler/codegen.ts` — generate class + constructor
  instead of object literal + closure
- No changes to `src/runtime/dom-binding.ts` — reconciler calls `managed.update(item)` same as
  before; class instances satisfy the ManagedItem interface

**Eliminates per row:**
- 1 closure function object (~32 bytes)
- 1 V8 closure context object (~32 bytes per captured var × 3 vars = ~48 bytes)
- Total: ~80 bytes × 1000 rows = **~80 KB less heap per 1000 rows**

**Risks:**
- **MEDIUM**: Hidden class consistency — all `_Row_b0` instances share the same V8 Map, which
  is better than object literals (object literals CAN share maps but closures complicate things).
  The extra `_0`, `_1` properties don't affect the reconciler since it only reads `el`, `value`,
  `update`, `cleanups`, `itemSignal`.
- **MEDIUM**: `this.el` access in `update()` is a property read instead of a closure variable
  read. Closure reads are ~0.5ns, property reads are ~1-2ns. For 100 updates, that's +100-200ns.
  Negligible.
- **LOW**: V8 inlines monomorphic `new _Row_b0()` calls extremely well.

**Expected impact:**
- Create 1k: -1-2ms (fewer allocations)
- Create 10k: -5-15ms (significant GC pressure reduction)
- Partial update: neutral (property access ≈ closure access for cached refs)
- Memory: -80KB per 1000 rows (measurable on memory benchmark)

**Bundle size:** Net neutral or slight reduction — class definition replaces object literal
factory. Minified class syntax is compact.

**Verdict: ⛔ FAILED (v0.0.56) — Swap rows regressed 1.00→1.21×, partial update 1.20→1.25×. Class instances with 7+ properties create a different V8 hidden class than the 5-property object literals the reconciler was optimized for. Extra `_0`/`_1` instance properties degrade inline caches for `.el`, `.value`, `.update` accesses across the hot reconciliation loop. `this._0` property reads also slower than closure-captured variable reads. Memory improved slightly (3.34→3.29 MB) but CPU regressions unacceptable. See PERFORMANCE-KNOWLEDGE.md ⛔ #11.**

---

#### Idea 2: Cached Prototype Methods

**Source inspiration:** vanillajs-lite's `const {cloneNode, insertBefore} = Node.prototype;`

**What:** Cache frequently-called DOM methods at module scope to avoid prototype chain lookup.

**Current codegen:**
```js
const _el = _tc_b0.cloneNode(true);       // prototype lookup per call
_ct_b0.insertBefore(_el, _ref);           // prototype lookup per call
```

**Proposed codegen:**
```js
// Module scope (emitted once):
const _cloneNode = Node.prototype.cloneNode;
const _insertBefore = Node.prototype.insertBefore;

// Per row:
const _el = _cloneNode.call(_tc_b0, true);
_insertBefore.call(_ct_b0, _el, _ref);
```

**What changes:**
- `src/compiler/plugins/reactive-binding-compiler/codegen.ts` — emit cached method vars at
  module scope; use `.call()` in createItemFn

**Risks:**
- **VERY LOW**: Pure codegen change. No runtime modifications. No closure shape changes.
- Modern V8 may already inline prototype lookups for known built-in types (Node, Element).
  The optimization might be a no-op in Chrome but could help in Firefox/Safari.

**Expected impact:**
- Create 10k: 0-3ms improvement
- Other tests: no change

**Bundle size:** +60 bytes for the cached vars.

**Verdict: ✅ TRY THIS — zero risk, easy to implement, quick to validate**

---

#### Idea 3: Eliminate `__d` Re-assignment in Update Closure

**Source inspiration:** Analysis of the generated code.

**What:** Currently the update closure re-assigns `_el.__d = item2` on every update for
event delegation. But delegation reads `__d` only on click events. For the benchmark's
partial update (modifying 100 labels), re-assigning `__d` on all 100 rows is unnecessary
if the item object reference changes but the handlers use the updated reference from `__d`.

Actually, wait — the benchmark creates NEW item objects: `{ ...item, label: item.label + ' !!!' }`.
So `__d` MUST be updated or the click handler would use stale data. This is correct behavior.

But we could defer `__d` assignment to click time:
```js
// Instead of updating __d on every reconcile:
update: (item) => { _e0.firstChild.nodeValue = item.id; _e1.firstChild.nodeValue = item.label; }
// Store the latest value in managedItems[i].value (already done by reconciler)

// In click delegation, look up via managedItems instead of __d:
// ... but managedItems is inside the reconciler closure
```

This doesn't work cleanly. The `__d` expando is the bridge between DOM events and data.
Removing it would require the click handler to traverse `managedItems` to find the row.

**Verdict: ❌ SKIP — `__d` assignment is necessary and costs only 1 property write per update**

---

#### Idea 4: Batch Template Cloning for bulkCreate

**Source inspiration:** vanillajs-lite's mega-template approach — clones 50 rows at once.

**What:** Instead of cloning 1 row template 1000 times, pre-build a mega-template containing
N rows (e.g. 50), fill all N rows, then clone the mega-template and insert 20 times.

**Current flow (1000 rows):**
```
for each item:
  _tc.cloneNode(true)     // 1000 calls
  fill DOM nodes           // 1000 iterations
  container.insertBefore   // 1000 calls
```

**Proposed flow (1000 rows, batch=50):**
```
// Build mega-template once (module scope):
const _megaTpl = buildMegaTemplate(_tc, 50);

// For each batch of 50:
for each batch:
  const frag = _megaTpl.cloneNode(true);   // 20 calls (clones 50 rows each)
  for each row in frag.children:
    fill DOM nodes                         // 1000 iterations (same)
  container.insertBefore(frag, anchor);    // 20 calls
```

**Savings:**
- `cloneNode` calls: 1000 → 20 (50× fewer). Each cloneNode on a larger tree is slower
  than on a small tree, but the total clone work is similar — V8's cloneNode is O(n nodes).
  The real saving is fewer C++ → JS boundary crossings (980 fewer calls).
- `insertBefore` calls: 1000 → 20 (50× fewer). Each insert is larger but all are off-DOM
  (container is detached in bulkCreate). The savings are in fewer C++ calls.

**What changes:**
- `src/compiler/plugins/reactive-binding-compiler/codegen.ts` — emit mega-template in
  `staticTemplates`, change createItemFn to support batch mode
- `src/runtime/dom-binding.ts` — `bulkCreate` needs to support batch creation where the
  reconciler calls a batch-create function instead of individual createItemFn

**Risks:**
- **HIGH**: Requires runtime changes to `createKeyedReconciler` (or a new variant).
  Adding parameters/methods to the reconciler is risky (⛔ #9 — closure captured vars).
- **HIGH**: The fill loop needs to iterate `frag.children` which is a live HTMLCollection.
  Navigating to bound elements within each row of the batch requires per-row path calculation.
- **MEDIUM**: For non-bulk operations (single insert, reconcile), must fall back to per-row
  cloning. Code complexity increases significantly.

**Expected impact:**
- Create 10k: -10-30ms (fewer C++ boundary crossings)
- Create 1k: -1-3ms
- Other tests: no change (partial update, swap, etc. don't create rows)

**Bundle size:** +200-400 bytes (mega-template setup + batch logic)

**Verdict: 🟡 CONSIDER — high potential but high risk/complexity. Try after simpler wins.**

---

### TIER 2: Runtime changes (medium risk)

#### Idea 5: Same-Length Same-Order Fast Path in Reconciler

**Source inspiration:** vanillajs-lite's update iterates 100 times for 100 changes. Thane's
reconciler iterates 1000 times (checking all keys) for the same 100 changes.

**What:** Add an `updateInPlace` method to the reconciler that handles the common case:
same array length, same key order, only values changed. Bypasses Map.has and Map.get entirely.

**Current partial update path (1000 items, 100 changed):**
```
reconcile(newItems):
  // Pass 1: allKeysExist check
  for (i = 0; i < 1000; i++)
    keyMap.has(keyFn(newItems[i], i))     // 1000 keyFn + 1000 Map.has

  // Pass 2: update + mismatch detection
  for (i = 0; i < 1000; i++)
    keyMap.get(keyFn(newItems[i], i))     // 1000 keyFn + 1000 Map.get
    existing.value !== newItem → update    // 1000 comparisons, 100 updates
    managedItems[i] !== existing           // 1000 comparisons (mismatch)
```

**Proposed fast path (called instead of reconcile for same-length):**
```
updateInPlace(newItems):
  // Single pass: compare keys directly, then update
  for (i = 0; i < len; i++)
    if (keyFn(newItems[i], i) !== keyFn(managedItems[i].value, i))
      return false;  // keys differ → fall through to reconcile

  for (i = 0; i < len; i++)
    if (managedItems[i].value !== newItems[i])
      managedItems[i].value = newItems[i];
      managedItems[i].update(newItems[i]);
  return true;
```

**Savings:** Eliminates 1000 Map.has + 1000 Map.get = 2000 Map operations. BUT adds 2000 keyFn
calls (was 2000, now 2000 — same). Net saving: ~2000 Map lookups.

**Estimated time saving:** Map.get with integer key ≈ 5-10ns. 2000 × 7.5ns = ~15μs.
On partial update (~30ms), this is **0.05%**. Negligible.

**What changes:**
- `src/runtime/dom-binding.ts` — add `updateInPlace` to reconciler return object
- `src/compiler/plugins/reactive-binding-compiler/codegen.ts` — emit subscribe callback
  that calls `updateInPlace` first, falls back to `reconcile`

**Risks:**
- **MEDIUM**: Adds a function to reconciler closure (⛔ #9 risk — extra captured var may
  change V8 optimization of other closures in scope).
- **LOW-MEDIUM**: Adds a property to reconciler return object (changes object shape). But this
  object is created once per repeat, not per row.

**Expected impact:** ~15μs improvement on partial update. **Not worth the risk.**

**Verdict: ❌ SKIP — math doesn't justify it. Map ops are cheap, the overhead is structural.**

---

#### Idea 6: Replace `keyMap` with Parallel Key Array

**Source inspiration:** vanillajs implementations don't use Maps at all.

**What:** Instead of `keyMap: Map<key, ManagedItem>`, store keys in a parallel array
`keys: (string|number)[]` alongside `managedItems`. For lookups, build a temporary index
map only when needed (general reconciliation), or linear scan for small changes.

**Current architecture:**
```
managedItems: ManagedItem[]    // per-row objects
keyMap: Map<key, ManagedItem>  // persistent, mutated on every create/remove
```

**Proposed architecture:**
```
managedItems: ManagedItem[]    // per-row objects (same)
keys: (string|number)[]        // parallel array of keys (new)
// keyMap built on-demand only for general reconciliation
```

**What changes:**
- `src/runtime/dom-binding.ts` — replace `keyMap` with `keys[]` array; build temporary
  Map only in general reconciliation path

**Savings:**
- Eliminates 1000 `Map.set()` calls during bulkCreate
- Same-length path uses `keys[i]` instead of `keyMap.has(key)` / `keyMap.get(key)`
- BUT: general reconciliation needs to build a Map from scratch each time

**Risks:**
- **MEDIUM-HIGH**: Changes the reconciler's data structure fundamentally. The same-length
  path's `keyMap.get(keyFn(newItem, i))` becomes an array scan or temp-Map lookup.
- **MEDIUM**: V8 has highly optimized Map implementations for integer keys. A parallel array
  may not be faster.

**Expected impact:**
- Create 1k: -1-3ms (no Map.set overhead)
- Create 10k: -5-10ms (significant Map.set savings at scale)
- Partial update: neutral (array index access ≈ Map.get for this pattern)
- General reconciliation: may regress (temporary Map construction)

**Verdict: 🟡 CONSIDER — moderate potential, needs careful measurement. Try after Idea 1.**

---

#### Idea 7: Eliminate Empty Cleanups Array When Not Needed

**Source inspiration:** vanillajs has no cleanup infrastructure at all.

**Background:** ⛔ #8 proved we can't SHARE a cleanups array. ⛔ #9 proved we can't add a
flag to skip iteration. But what if we eliminate the property entirely for rows that have no
cleanups?

Wait — ⛔ #5 says we can't remove properties (hidden class mismatch). So the cleanups
property MUST exist.

**Alternative:** Use `null` instead of `[]`:
```js
return { itemSignal: null, el: _el, cleanups: null, value: item, update: ... };
```
Then in clearAll/removeItem: `if (managed.cleanups) for (...)`.

**Risk:** Same as ⛔ #5 — changing the VALUE type (array → null) could affect V8's type
feedback. V8 tracks not just property presence but property types. If cleanups is sometimes
`[]` and sometimes `null`, the access becomes polymorphic.

But in the compiler-optimized path, cleanups is ALWAYS `null` (no nested directives) or
ALWAYS `[]` (with nested directives). It's monomorphic within a given repeat block.

The reconciler's cleanup iteration would need to check `if (managed.cleanups)` which is
one extra branch per row in clearAll. But the branch is perfectly predicted (always false
for benchmark rows).

**What changes:**
- `src/compiler/plugins/reactive-binding-compiler/codegen.ts` — emit `cleanups: null` when
  no nested directives/subscriptions
- `src/runtime/dom-binding.ts` — add null check before cleanup iteration in clearAll/removeItem

**Saves:** 1 empty array allocation per row = 1000 array objects for 1k create.
Each empty array = ~32 bytes. Total: ~32KB per 1000 rows.

**Risks:**
- **MEDIUM**: V8 hidden class may differ between `cleanups: null` and `cleanups: []`.
  If the reconciler processes both types (from different repeat blocks), the call site
  becomes megamorphic. For the benchmark (single repeat), it's monomorphic.
- **LOW**: The null check in clearAll is negligible.

**Expected impact:**
- Create 1k: -0.5-1ms (1000 fewer allocations)
- Create 10k: -3-8ms (10000 fewer allocations, GC savings)
- Memory: -32KB per 1000 rows
- Other tests: neutral

**Verdict: ⛔ FAILED (v0.0.59) — Geo mean regressed 1.14→1.16×. Changing cleanups value type from [] to null alters V8's type feedback for the entire ManagedItem hidden class, degrading inline caches for .el, .value, .update accesses. Select row regressed 1.04→1.17×, clear rows 1.10→1.20×. See PERFORMANCE-KNOWLEDGE.md ⛔ #12.**

---

### TIER 3: Architectural changes (high risk, high reward)

#### Idea 8: Compiler-Specialized Inline Reconciler

**Source inspiration:** All top vanilla frameworks have hand-tuned per-component logic
with zero abstraction overhead.

**What:** Instead of calling the generic `createKeyedReconciler()` function, the compiler
generates the entire reconciler inline, specialized for the specific repeat block:
- Known key function (inlined, not a callback)
- Known update logic (inlined, not a closure)
- Known cleanup requirements (eliminated if none)
- Known element structure (DOM navigation baked in)

**Current compiled output:**
```js
const _rc = createKeyedReconciler(container, anchor,
  (item, idx, ref) => { /* createItemFn */ },
  (row) => row.id
);
rows.subscribe(items => _rc.reconcile(items));
```

**Proposed compiled output (conceptual):**
```js
// Everything inlined — no createKeyedReconciler call
const _els = [];        // parallel: DOM elements
const _vals = [];       // parallel: item values
const _keys = [];       // parallel: computed keys
let _len = 0;

const _fill = (el, item) => {
  el.firstElementChild.firstChild.nodeValue = item.id;
  el.firstElementChild.nextElementSibling.firstElementChild.firstChild.nodeValue = item.label;
};

rows.subscribe(items => {
  const newLen = items.length;
  if (newLen === 0) { /* inline clearAll */ container.textContent = ''; ... return; }
  if (_len === 0) { /* inline bulkCreate */ ... return; }
  if (_len === newLen) {
    // Inline same-length path with direct key comparison
    for (let i = 0; i < newLen; i++) {
      const ni = items[i];
      if (_vals[i] !== ni) {
        _vals[i] = ni; _fill(_els[i], ni);
      }
    }
    // Inline swap detection...
    return;
  }
  // Inline general reconciliation...
});
```

**What changes:**
- `src/compiler/plugins/reactive-binding-compiler/codegen.ts` — massive change to generate
  inline reconciler instead of calling createKeyedReconciler
- `src/runtime/dom-binding.ts` — createKeyedReconciler may become unused for optimized paths
  (but kept for fallback/complex cases)

**Eliminates:**
- ManagedItem object allocation (parallel arrays instead)
- Per-row closure allocation (shared static fill function)
- keyMap (parallel keys array with direct comparison)
- Empty cleanups array (no cleanups for simple rows)
- Function call overhead (reconcile is inline, not a closure method)

**Savings per 1000 rows:**
- ~4000 fewer heap objects (ManagedItem + cleanups + closure + Map entries)
- ~320KB less heap memory
- Fewer function calls on every reconcile pass

**Risks:**
- **VERY HIGH**: Massive codegen complexity. The compiler must generate correct reconciliation
  logic for every possible scenario (create, update, delete, swap, general reorder, clear).
  Any bug means broken rendering.
- **HIGH**: Bundle size increase — the inline reconciler may be larger than the generic one
  when minified, especially if the general reconciliation path is duplicated per repeat block.
- **HIGH**: Maintenance burden — every reconciler fix must be reflected in codegen.
- **MEDIUM**: V8 may optimize the generic reconciler better (single copy = more JIT data)
  than per-repeat-block inline versions.

**Expected impact:**
- Create 1k: -3-8ms (dramatically fewer allocations)
- Create 10k: -20-50ms (could approach vanilla speed)
- Partial update: -2-5ms (no Map lookups, direct array access)
- Memory: -200-350KB per 1000 rows

**Verdict: 🟡 HIGH-VALUE TARGET but massive implementation effort. Consider as the
"endgame" optimization after exhausting simpler options.**

---

#### Idea 9: DOM-Anchored State (P0-C Revisited)

**Source inspiration:** vanillajs-lite stores everything on DOM elements.

**What:** Store per-row state directly on DOM elements as expando properties. Eliminate
ManagedItem objects entirely. The reconciler works with DOM elements and reads data from them.

```js
// createItemFn:
_el.__k = row.id;       // key
_el.__v = item;          // value
_el.__u = (item) => {    // update (still a closure, but could be shared — see Idea 1)
  _e0.firstChild.nodeValue = item.id;
  ...
};
container.insertBefore(_el, ref);

// Reconciler stores only:
const _els = [];  // flat array of DOM elements
// No keyMap — scan _els[i].__k for key lookups, or build temp Map
```

**Risks:**
- **HIGH**: DOM expando properties are "slow properties" in V8. Accessing `el.__k` requires
  a dictionary lookup, not a fixed-offset read like a regular JS object property.
- **HIGH**: Reconciler must scan/build Map for key lookups instead of persistent keyMap.
- **MEDIUM**: Mixing JS data with DOM lifetime — if a DOM element leaks, so does all its data.

**Expected impact:** Similar to Idea 8 but with the added cost of slow DOM property access.

**Verdict: ❌ SKIP — DOM expandos are slower than JS object properties. Idea 8 (parallel
arrays) is strictly better.**

---

## Execution Priority

Based on risk/reward analysis:

| Priority | Idea | Risk | Expected Impact | Files | Status |
|---|---|---|---|---|---|
| ~~0~~ | ~~Fix stale package~~ | None | Partial update fix | npm rebuild | ✅ Done |
| ~~1~~ | ~~Idea 1: Class-based ManagedItem~~ | Medium | Create -5-15ms, Memory -80KB | codegen.ts | ⛔ Failed (v0.0.56) |
| ~~1~~ | ~~Idea 2: Cached prototype methods~~ | Very Low | Create 0-3ms | codegen.ts | ✅ Kept (v0.0.58) |
| ~~2~~ | ~~Idea 7: null cleanups~~ | Medium | Create -3-8ms | codegen.ts + dom-binding.ts | ⛔ Failed (v0.0.59) |
| ~~3~~ | ~~Idea 4: Batch template cloning~~ | High | Create -10-30ms | codegen.ts + dom-binding.ts | ⛔ Failed (v0.0.61) |
| ~~4~~ | ~~Reconciler micro-opts (merged loops, splice→shift, push→indexed)~~ | Low | All update tests | dom-binding.ts | ⛔ Failed (v0.0.63) |
| **5** | Idea 6: Parallel key array | Med-High | Create -5-10ms | dom-binding.ts | |
| **6** | Idea 8: Inline reconciler | Very High | All tests improved | codegen.ts + dom-binding.ts | |

**Recommended next:** Idea 2 (cached prototype methods) — very low risk, codegen-only.

---

## Lessons From Failed Attempts (Reference)

Before implementing ANY idea, cross-check against these proven V8 sensitivities:

1. **⛔ #5**: All ManagedItem properties must exist on all instances (hidden class consistency)
2. **⛔ #7**: V8 prefers simple tight loops over complex multi-purpose loops
3. **⛔ #8**: Don't share mutable object references across instances (identity sensitivity)
4. **⛔ #9**: Adding captured variables to reconciler closure changes V8 optimization of
   ALL functions in that closure scope
5. **⛔ #10**: Cached DOM refs are faster than re-navigating sibling chains on update path
6. **⛔ #11**: Class instances with extra properties create different V8 hidden class from
   object literals — reconciler inline caches degrade for `.el`, `.value`, `.update` accesses
7. **⛔ #12**: Changing VALUE TYPE of ManagedItem properties (e.g. `[]` → `null` for cleanups)
   alters V8 hidden class type feedback, degrading all property accesses on the object
8. **⛔ #13**: Batch coordination variables (`_preCloned`, `_skipInsert`) in createItemFn's
   closure scope degrade V8 optimization of ALL paths through that closure. Conditional
   branches in the per-item hot path add constant overhead that overwhelms batch cloning gains.
9. **⛔ #14**: Merging separate reconciler loops (allKeysExist + update) into one complex loop
   regresses performance. V8 TurboFan generates better code for two simple N-iteration loops
   than one complex multi-purpose loop. Native `splice()` and `push()` are C++ optimized —
   manual JS replacements are slower. "Fewer iterations" ≠ "faster" under V8's JIT.

**Key principle:** Any change that modifies the reconciler closure's captured variable count
or the ManagedItem object shape is HIGH RISK. Codegen-only changes that don't touch the
runtime are LOWER RISK.
