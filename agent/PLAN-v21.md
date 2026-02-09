# Thane v21 — Performance Overhaul Plan

> Created: February 9, 2026  
> Goal: Close the gap with vanillajs-keyed (#1) and solid-keyed (#2) in js-framework-benchmark  
> Strategy: Eliminate runtime abstractions, generate vanilla-like output, minimize per-element overhead

---

## Current Architecture Weaknesses (vs. Top Performers)

After studying vanillajs-keyed, vanillajs-lite, solid, mikado, and stage0, these are the key areas where Thane leaves performance on the table:

| Area | Thane (current) | vanillajs / solid (top performers) | Gap |
|---|---|---|---|
| **Text updates** | `el.textContent = v` | `el.firstChild.nodeValue = v` | `textContent` destroys+recreates text nodes; `nodeValue` mutates in-place |
| **Element lookup** | `getElementById` / `querySelector` per binding | Direct child navigation: `tr.firstChild`, `td.nextSibling.firstChild` | getElementById traverses the entire subtree |
| **DOM creation** | `innerHTML` → clone, OR `cloneNode` + path navigation | `cloneNode(true)` on pre-built template + cached node refs | Similar for optimized path, but innerHTML fallback is much slower |
| **Reconciliation** | Signals → subscriber callbacks → DOM updates | Signals → direct `nodeValue` writes (no callback overhead) | Extra function call + closure per binding |
| **Selection** | Via event handler + class manipulation | Direct `className` property assignment, `createSelector` O(1) | Similar, but could be more direct |
| **Event delegation** | `data-evt-*` attributes + bubbling walk | Single listener on tbody, `target.closest('tr')` | data attributes add DOM weight; `.closest()` is native and faster |
| **Component wrapper** | `<div class="selector">` wrapping every component | No wrapper — component renders directly into parent | Extra DOM node per component = extra layout/paint work |
| **Clear operation** | Iterate cleanups + `textContent = ''` | `tbody.textContent = ''` (single op) | Cleanup iteration adds overhead |
| **Memory per row** | `ManagedItem` object + `Signal` per item + cleanup array + key map entry | Flat `{id, label}` + optional DOM property | 4-5× more allocations per row |
| **Bundle overhead** | Full runtime: signal system, reconciler, event delegation, conditional binding | Zero framework overhead (vanilla) or minimal (solid ~4.9KB) | Runtime functions that could be inlined by compiler |

---

## Phase Structure

- **Phase A — Compiler Output Changes**: Changes to what the compiler generates. These are the highest-impact items because they eliminate runtime overhead entirely by generating better code. Each change affects the produced JS, so benchmark after each.

- **Phase B — Runtime Slim-Down**: Reduce or remove runtime functions. Some functions move to compile-time, others get inlined, others get micro-optimized. Benchmark after each.

- **Phase C — Architecture Changes**: Bigger structural changes like removing the component wrapper div or rethinking how components mount. Higher risk, higher reward. Benchmark after each.

---

## Phase A — Compiler Output Changes

> These change what code the compiler emits. Highest impact — the generated code runs in the browser.

### A1. `nodeValue` Instead of `textContent` for Text Updates

**Impact: HIGH — affects every text binding update (hot path)**

**Current compiler output:**
```javascript
el.textContent = v;
```

**Problem:** `textContent` removes all child nodes and creates a new text node. For a `<td>` with a single text child, this means:
1. Destroy existing text node
2. Allocate new text node
3. Set its value
4. Append to parent

**What top performers do:**
```javascript
el.firstChild.nodeValue = v;  // Mutates existing text node in-place
```

This is a single property write on an existing object — no allocation, no GC pressure, no DOM tree mutation.

**Compiler change:** In `codegen.ts`, the `generateBindingUpdateCode` and `generateInitialValueCode` functions should emit `.firstChild.nodeValue = v` instead of `.textContent = v` for text bindings where the element has a single text child (which is the common case for `<td>`, `<span>`, `<a>`, etc.).

**For the static template:** The template needs to ensure text nodes exist. Instead of `<td></td>`, emit `<td> </td>` (with a space) so `firstChild` is guaranteed to be a text node. The vanillajs benchmark does exactly this.

**Runtime change needed:** None — this is purely a codegen change.

**Files:** `codegen.ts` — `generateBindingUpdateCode()`, `generateInitialValueCode()`, repeat template `fillItem` and `initItemBindings` functions.

**Risk:** 🟢 Low — direct property write is always faster than textContent.

**⚠️ Whitespace Caution:** A previous attempt at this change caused whitespace trimming issues. To guard against regressions, add a **functional test** (not coupled to implementation) that:
1. Renders components/repeat items with various text content: empty strings, numbers, strings with leading/trailing spaces, strings with special characters
2. Asserts the rendered DOM `.textContent` matches the expected value
3. Updates the text via signal and re-asserts
4. This test should run against the compiled benchmark or a minimal test component — it validates the output, not the codegen mechanism

---

### A2. Pre-computed Element References via Tree Navigation (Eliminate `getElementById`)

**⚠️ DEFERRED — Implement after all other phases are complete. This is the most invasive codegen change and every other item can proceed without it.**

**Impact: HIGH — eliminates getElementById on every component mount and every repeat item creation**

**Current compiler output:**
```javascript
const el0 = r.getElementById('el0');
const el1 = r.getElementById('el1');
```

**Problem:** `getElementById` does a subtree search. For a component with 10 bindings, that's 10 subtree searches on mount. For a repeat with 1000 items, that's 10,000 subtree searches.

**What top performers do:** Navigate the DOM tree structurally:
```javascript
// vanillajs: direct child navigation from cloned template
const td1 = tr.firstChild;              // <td class="col-md-1">
const td2 = td1.nextSibling;            // <td class="col-md-4">
const a = td2.firstChild;               // <a>
```

The compiler already does this for `__bindRepeatTpl` (the optimized repeat path) with `ElementPath` navigation — but NOT for top-level component bindings or the fallback repeat path.

**Proposed compiler change:**

1. **For top-level component bindings:** Instead of injecting `id="el0"` attributes and using `getElementById`, compute the structural path from the template root to each bound element at compile time, and emit path-based navigation:
   ```javascript
   // Instead of: const el0 = r.getElementById('el0');
   const el0 = r.children[0].children[1].firstChild;
   // Or using firstChild/nextSibling chains which are faster:
   const el0 = r.firstChild.nextSibling.firstChild;
   ```

2. **For repeat items (fallback path):** Same approach — compute paths at compile time, eliminate `__findEl` and `__findTextNode` runtime calls.

3. **Remove `id` and `data-bind-id` attributes from output HTML** — these are only needed for `getElementById` lookups. Removing them shrinks the HTML and eliminates DOM attribute overhead.

**Files:** `codegen.ts`, `template-processing.ts`, `repeat-analysis.ts`

**Risk:** 🟡 Medium — path computation must handle conditional sections and dynamic content carefully. Start with repeat items (already partially done), then extend to top-level.

---

### A3. Inline Signal Subscriptions — Eliminate Closure Overhead

**Impact: MEDIUM — reduces per-binding memory and call overhead**

**Current compiler output for item bindings:**
```javascript
itemSignal.subscribe(v => { 
  el0.textContent = v.id; 
  el1.textContent = v.label; 
}, true);
```

**Problem:** Each `subscribe` call:
1. Creates a closure (the arrow function)
2. Pushes it onto the signal's subscribers array
3. On every signal update, iterates the array and calls each function

For 1000 rows with 2 bindings each, that's 1000 closures allocated and 1000 function calls per update.

**What top performers do (solid):** Fine-grained signals per field — `createSignal(label)` — with compiled subscriptions that directly write to the bound text node. No subscriber array iteration.

**What vanillajs does:** No signals at all — direct property writes in the update function.

**Proposed approach:** For the benchmark-critical repeat path, instead of creating a signal per item and subscribing, generate a direct update function:

```javascript
// Instead of signal + subscribe:
const itemSignal = createSignal(item);
itemSignal.subscribe(v => { td1.firstChild.nodeValue = v.id; a.firstChild.nodeValue = v.label; });

// Generate direct update:
const update = (item) => { td1.firstChild.nodeValue = item.id; a.firstChild.nodeValue = item.label; };
update(item); // initial
// Store `update` on the managed item for reconciler to call directly
```

The reconciler then calls `managed.update(newItem)` instead of `managed.itemSignal(newItem)` — eliminating the signal machinery entirely for simple repeat items.

**Files:** `codegen.ts` (repeat code generation), `dom-binding.ts` (ManagedItem interface, reconciler)

**Risk:** 🟡 Medium — need to ensure the new path handles all binding types (text, attr, style). Can be done incrementally — start with the optimized `__bindRepeatTpl` path.

---

### A4. Batch Template Cloning for Bulk Creates

**Impact: MEDIUM-HIGH — affects "create 1000 rows" and "create 10000 rows" benchmarks**

**Current approach (`bulkCreate` in `dom-binding.ts`):** The runtime already has a **detach optimization** — it removes the container from the DOM before inserting items, then reattaches after. However, each row is still cloned **individually** in a loop. `createItemFn` is called once per item, and each call does `templateContent.cloneNode(true)` for a single row, navigates its paths, fills values, and inserts it. For 1000 rows, that's 1000 separate `cloneNode` calls.

```javascript
// Current: detach optimization exists, but cloning is per-item
for (let i = 0; i < count; i++) {
  const managed = createItemFn(items[i]!, startIndex + i, anchor);  // cloneNode(true) inside
  managedItems.push(managed);
}
```

**What vanillajs-lite does:** Clone a batch of N rows at once as a **single `cloneNode` operation**, fill values for the entire batch, then insert the whole fragment:
```javascript
// Pre-build fragment with 50 rows from one cloneNode
const batch = template.content.cloneNode(true);  // 1 cloneNode for 50 rows
// Duplicate to get 50 copies
for (let i = 1; i < 50; i++) batch.appendChild(batch.firstChild.cloneNode(true));

// Fill values, then insert whole batch
container.appendChild(batch);
```

**The distinction:** 1000 `cloneNode` calls (current) vs ~20 `cloneNode` calls for batches of 50 (proposed). Fewer browser-internal allocations and DOM tree constructions.

**Proposed compiler change:** For bulk `reconcile` operations where the entire list is new (clear + create, or initial create), generate code that:

1. Detaches the container from the DOM (already done — `useDetachOptimization`)
2. Clones the template N rows at a time into a DocumentFragment
3. Fills all values via direct node references
4. Inserts the entire fragment at once
5. Reattaches the container

**Files:** `dom-binding.ts` (`bulkCreate`), `codegen.ts`

**Risk:** 🟡 Medium — need to track node references correctly when cloning multiple rows at once.

---

### A5. Remove `data-evt-*` Attributes — Use Structural Event Handling

**Impact: LOW-MEDIUM — reduces DOM attribute count, simplifies event path**

**Current approach:** When the user writes `@click=${handler}` in a template, the compiler injects a `data-evt-click="handler0"` attribute on that element. At runtime, `__setupEventDelegation` (`dom-binding.ts` lines 35–92) adds a **single** listener on the component root that captures all clicks. When fired, it walks up from `event.target` to the root, calling `getAttribute('data-evt-click')` on **every element** in the path until it finds a match. The handler ID is a colon-separated string like `handler0:prevent:stop` which gets parsed at dispatch time.

**Problem in detail:**
1. Each `@click` adds an extra DOM attribute to the output HTML (`data-evt-click="handler0"`)
2. At dispatch time, the bubble-walk calls `getAttribute()` on every element in the path — this is a string comparison at each level
3. Modifiers (`:prevent`, `:stop`, `:enter`) are encoded as strings and parsed at dispatch time via `split(':')` — per click
4. For repeat items, every row gets `data-evt-click` attributes on its buttons — N items × M event attributes = N×M extra DOM attributes

**What the benchmark already does manually:** The benchmark component uses `@click=${handleTableClick}` on `<tbody>` and does `e.target.closest('tr')` + `data-action` attribute dispatch. This is the *user* doing what the *compiler* should do.

**Proposed change — two cases:**

1. **Static elements (buttons, links — not inside repeats):** The compiler generates direct `addEventListener` calls. The element reference comes from structural path navigation (A2, or for now, `getElementById`). No attribute needed:
   ```javascript
   // User writes: <button @click=${run}>Run</button>
   // Compiler emits:
   el_run.addEventListener('click', run);
   // No data-evt-click attribute on the button at all
   ```

2. **Elements inside repeats (row buttons, delete links):** The compiler generates a **single delegated listener** on the repeat container. It uses `e.target.closest()` (native, browser-optimized) to find the relevant row, and looks at a DOM property (see C2) or `data-action` attribute to identify the action:
   ```javascript
   // Compiler emits (once for the repeat container):
   tbody.addEventListener('click', (e) => {
     const tr = e.target.closest('tr');
     if (!tr) return;
     const target = e.target.closest('[data-action]');
     if (target) {
       const action = target.dataset.action;
       if (action === 'remove') remove(tr.__data.id);
       else if (action === 'select') select(tr.__data);
     }
   });
   ```

3. **Event modifiers** (`@click.prevent.stop`, `@keydown.enter`) are compiled into the generated handler code rather than parsed at runtime:
   ```javascript
   // User writes: @click.prevent.stop=${handler}
   // Compiler emits:
   el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handler(e); });
   
   // User writes: @keydown.enter=${submit}
   // Compiler emits:
   el.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; submit(e); });
   ```

**Net effect:** `__setupEventDelegation`, `data-evt-*` attributes, and the `KEY_CODES` map are all removed from the output. Events still work identically from the user's perspective.

**Files:** `codegen.ts` (event binding generation), `dom-binding.ts` (`__setupEventDelegation`)

**Risk:** 🟡 Medium — changes the event binding model. Need to handle modifiers (prevent, stop, self, key filters) in the new approach.

---

### A6. Compiled Static Template with Inlined Node References

**Impact: HIGH — affects component mount and every repeat item**

**Current optimized path (`__bindRepeatTpl`):**
```javascript
const fragment = templateContent.cloneNode(true);
const el = fragment.firstElementChild;
// Navigate to bound elements via generic function
const elements = new Array(elementBindings.length);
for (let i = 0; i < elementBindings.length; i++) {
  elements[i] = navigatePath(el, elementBindings[i].path);
}
```

**Problem:** `navigatePath` does a loop per element, accessing `.children[n]` at each level. For a 4-level deep element, that's 4 property accesses. The `elements` array is allocated per item.

**What vanillajs does:** Cache references as direct variable assignments after cloning:
```javascript
const tr = rowTemplate.cloneNode(true);
const td1 = tr.firstChild;
const a = td1.nextSibling.firstChild;
```

**Proposed compiler change:** Instead of the generic `navigatePath` function, emit **inlined navigation code** specific to each template's structure:

```javascript
// Compiler generates per-template navigation:
const createItem = (item, refNode) => {
  const tr = tpl.content.cloneNode(true).firstElementChild;
  const td1 = tr.firstChild;         // path [0]
  const a = tr.children[1].firstChild; // path [1, 0]
  td1.firstChild.nodeValue = item.id;
  a.firstChild.nodeValue = item.label;
  container.insertBefore(tr, refNode);
  return { el: tr, update: (v) => { td1.firstChild.nodeValue = v.id; a.firstChild.nodeValue = v.label; } };
};
```

This eliminates:
- The `navigatePath` function call
- The `elements` array allocation
- The `elementBindings` array lookup loop
- The `fillItem` function call overhead

**Files:** `codegen.ts` (repeat template generation)

**Risk:** 🟡 Medium — requires generating more specialized code per template. Increases compiler output but eliminates runtime indirection.

**⚠️ Bundle Size Caveat:** Inlining the navigation removes a shared ~5-line function (`navigatePath`) but duplicates navigation code into every template. For apps with many different repeat templates, the inlined code could be **larger** than the shared function. Additionally, V8 may optimize a hot shared function better than many unique inlined paths. This should be:
1. **Benchmarked both ways** — with shared function vs inlined — on a real app with multiple templates
2. Made **opt-in via a compiler flag** (e.g., `inlineNavigation: true`) so users can choose
3. Default to the shared function unless benchmarks prove inlining wins

---

### A7. Eliminate `createSignal` Per Repeat Item

**Impact: HIGH — saves ~5 allocations per row (signal function + _v + _s properties + subscribe ref + closure)**

**Current:** Every repeat item creates a signal to hold its data:
```javascript
const itemSignal = createSignal(item);
```

This allocates:
1. A function object (`reactiveFunction`)
2. Properties on it (`_v`, `_s`)
3. A reference to `sharedSubscribe`
4. A subscriber closure when `subscribe` is called
5. An unsubscribe closure returned by `subscribe`

For 10,000 rows, that's ~50,000 allocations just for item signals.

**What vanillajs does:** Zero per-item signal overhead. Data is stored as plain properties.

**Proposed approach:** Replace per-item signals with a lightweight "managed item" that stores the current value and a direct update function:

```javascript
// Instead of:
interface ManagedItem<T> {
  itemSignal: Signal<T>;
  el: Element;
  cleanups: (() => void)[];
}

// Use:
interface ManagedItem<T> {
  value: T;
  el: Element;
  update: (newValue: T) => void;  // Direct DOM update function
}
```

The `update` function is generated by the compiler (see A3 and A6) and directly mutates the DOM. No signal, no subscriber array, no unsubscribe tracking.

For the simple case (items are `{id, label}` with text bindings), the reconciler does:
```javascript
if (managed.value !== newItem) {
  managed.value = newItem;
  managed.update(newItem);
}
```

**Compatibility:** This only applies to the **per-item signal inside repeats** — the `createSignal(item)` that wraps each row's data object. **Component-level signals are completely unaffected.** If you have `const count = signal(0)` in your component and bind it with `${count()}`, that still uses `count.subscribe(...)` as normal.

**How fine-grained reactivity is preserved:** The per-item signal in a repeat is not a user-created signal — it's an implementation detail the compiler generates to wrap the item data. When the reconciler detects an item changed, it currently calls `managed.itemSignal(newItem)` which triggers subscribers. The proposal replaces this with `managed.update(newItem)` which directly writes to the DOM — same result, less machinery.

If a repeat callback also references **external component-level signals** (e.g., `repeat(items(), (item) => html\`...${selectedId()}...\``), the compiler detects this and falls back to the current signal-based path. The optimization only applies when the repeat item's bindings depend solely on the item data.

**Files:** `dom-binding.ts` (ManagedItem, reconciler), `codegen.ts` (repeat code generation)

**Risk:** 🔴 High — fundamental change to how repeat items work. But the payoff is massive for memory and creation speed.

---

## Phase B — Runtime Slim-Down

> Reduce the size and overhead of runtime functions.

### B1. Replace `__findEl` and `__findTextNode` with Compiler-Generated Paths

**Impact: MEDIUM — eliminates two runtime functions entirely**

These functions do DOM traversal (querySelector, walking childNodes) to find bound elements and text nodes by ID. If A2 is implemented (structural path navigation), these functions become unnecessary.

**Action:** After A2, remove `__findEl` and `__findTextNode` from the runtime exports. The compiler no longer generates calls to them.

**Bundle size reduction:** ~50 lines of runtime code removed.

**Files:** `dom-binding.ts`, `index.ts` (exports)

---

### B2. Streamline `__setupEventDelegation` 

**Impact: LOW-MEDIUM — simplifies event handling runtime**

**Current:** 80+ lines of code handling attribute lookup, modifier parsing, key code mapping, bubble walking.

**If A5 is implemented** (structural event handling), the delegation function can be simplified dramatically or replaced with per-component inline event setup generated by the compiler.

**For key modifiers:** The compiler can generate the key check inline:
```javascript
// Instead of runtime modifier parsing:
el.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  handler(e);
});
```

**Files:** `dom-binding.ts`

---

### B3. Slim Down `clearAll` in Reconciler

**Impact: LOW — affects "clear" benchmark**

**Current:**
```javascript
const clearAll = () => {
  for (let i = 0; i < len; i++) {
    const cleanups = managedItems[i]!.cleanups;
    for (let j = 0; j < cleanups.length; j++) cleanups[j]!();
  }
  anchor.remove();
  container.textContent = '';
  container.appendChild(anchor);
  managedItems.length = 0;
  keyMap?.clear();
};
```

**If A7 is implemented** (no per-item signals), the cleanup loop becomes unnecessary — there are no subscriptions to unsubscribe. Clear becomes:
```javascript
const clearAll = () => {
  container.textContent = '';
  container.appendChild(anchor);
  managedItems.length = 0;
  keyMap?.clear();
};
```

**Files:** `dom-binding.ts`

---

### B4. Remove `createHostElement` Wrapper

**Impact: LOW — removes one layer of indirection per component**

**Current:**
```javascript
const createHostElement = (selector: string): ComponentRoot => {
  const el = document.createElement('div');
  el.className = selector;
  el.getElementById = (id) => el.querySelector(`#${id}`);
  return el;
};
```

**Problem:** 
1. Creates a wrapping `<div>` around every component
2. Adds a polyfill `getElementById` method (only needed because `div` doesn't have one natively)
3. The `getElementById` calls `querySelector` internally — an extra indirection

**If A2 is implemented** (structural paths instead of getElementById), the polyfill is unnecessary. And if C1 is implemented (no wrapper div), the function is unnecessary.

**Files:** `component.ts`

---

### B5. Lazy `KEY_CODES` Map

**Impact: NEGLIGIBLE — but easy win for bundle size**

**Current:** `KEY_CODES` is a constant object allocated at module load:
```javascript
const KEY_CODES = { enter: ['Enter'], tab: ['Tab'], ... };
```

This object is only needed if the app uses keyboard event modifiers. For apps (and the benchmark) that don't use keyboard modifiers, it's dead weight.

**Fix:** If the compiler detects no keyboard modifiers are used, don't emit the import for event delegation with key support. Or, tree-shake the key codes out when not referenced.

**Files:** `dom-binding.ts`

---

### B6. Optimize Signal Notify Loop

**Impact: LOW-MEDIUM — micro-optimization on hot path**

**Current:**
```javascript
if (fn._s) {
  const subs = fn._s;
  for (let i = 0, len = subs.length; i < len; i++) {
    try { subs[i]!(fn._v); } catch (e) { console.error(e); }
  }
}
```

**Optimizations:**
1. For signals with exactly 1 subscriber (common case — most bound signals have one consolidated subscription), skip the loop entirely:
   ```javascript
   if (fn._s) {
     if (fn._s.length === 1) {
       fn._s[0]!(fn._v);  // No loop overhead
     } else {
       const subs = fn._s;
       for (let i = 0, len = subs.length; i < len; i++) subs[i]!(fn._v);
     }
   }
   ```

2. Remove `try/catch` in production builds — the compiler can strip it via a build flag:
   ```javascript
   // Dev build:
   try { subs[i]!(fn._v); } catch(e) { console.error(e); }
   // Prod build:
   subs[i]!(fn._v);
   ```

**Files:** `signal.ts`

---

## Phase C — Architecture Changes

> Bigger structural changes. Higher risk, higher reward.

### C1. Remove Component Wrapper `<div>` — Render Directly Into Parent

**Impact: HIGH — eliminates one DOM node per component, removes layout/paint overhead**

**Current:** Every component creates a `<div class="selector">` wrapper:
```javascript
const el = document.createElement('div');
el.className = selector;
// ... template content goes inside this div
target.appendChild(el);
```

**Problem:** The wrapper div:
1. Adds an extra DOM node (layout cost)
2. Requires selector-based CSS scoping (`.selector .child { ... }`)
3. Forces `getElementById` polyfill on the div
4. Creates an extra level of DOM nesting

**What vanillajs/solid do:** Render directly into the target element. No wrapper.

**Proposed approach:** Instead of wrapping in a div, render the component's template content directly into the mount target. Style scoping uses a data attribute or class on the actual root elements:

```javascript
// Instead of:
const wrapper = document.createElement('div');
wrapper.className = 'my-component';
wrapper.innerHTML = template;
target.appendChild(wrapper);

// Do:
const fragment = compiledTemplate.content.cloneNode(true);
target.appendChild(fragment);
```

**Scoping:** If the component has styles, add the scope class to the template's root elements at compile time rather than relying on a wrapper div.

**DX impact:** None — users still write `defineComponent`, the compiler handles the change. `mountComponent` API stays the same externally.

**Files:** `component.ts`, `codegen.ts`, compiler style scoping

**Risk:** 🔴 High — affects component mounting, style scoping, and element cleanup.

---

### C2. Direct DOM Property Storage Instead of `data-*` Attributes

**Impact: MEDIUM — faster than getAttribute for event delegation data**

**Current:** Row identity stored as HTML attribute:
```html
<tr data-id="${row.id}">
```
Retrieved via: `row.getAttribute('data-id')` or `parseInt(target.closest('[data-id]').getAttribute('data-id'))`

**What vanillajs does:** Store as a JS property directly on the DOM element:
```javascript
tr._id = data.id;
tr._data = data;
```
Retrieved via: `tr._id` — simple property access, no string parsing.

**Proposed compiler change:** When the compiler detects `data-*` attributes used in event-related templates, emit direct property assignments instead:
```javascript
// Compiler emits:
tr.__id = item.id;
// Instead of:
tr.setAttribute('data-id', item.id);
```

And for event handlers that reference these attributes, emit property reads:
```javascript
// Compiler emits:
const id = row.__id;
// Instead of:
const id = parseInt(row.getAttribute('data-id'));
```

**DX impact:** Users still write `data-id="${row.id}"` in templates. The compiler transforms it.

**Files:** `codegen.ts`, `template-processing.ts`

**Risk:** 🟡 Medium — property names must not collide with native DOM properties. Use `__` prefix.

---

### C3. Single Update Function Per Component (Eliminate Per-Binding Subscriptions)

**Impact: MEDIUM — reduces subscription overhead for top-level bindings**

**Current:** Each top-level signal binding creates a separate subscription:
```javascript
name.subscribe(v => { el0.textContent = v; }, true);
age.subscribe(v => { el1.textContent = v; }, true);
```

For a component with 20 bindings across 5 signals, that's 5 subscription closures and 5 entries in subscriber arrays.

**What solid does:** Compiles to a single fine-grained effect per binding that runs only when its specific dependency changes. No subscriber arrays.

**Proposed approach:** Generate a single consolidated subscription per signal that handles all bindings. The compiler knows which bindings depend on which signals, so it can generate optimal code:

```javascript
// Compiler generates:
const __update_name = (v) => { el0.firstChild.nodeValue = v; };
const __update_age = (v) => { el1.firstChild.nodeValue = v; };
name.subscribe(__update_name, true);
age.subscribe(__update_age, true);
```

The key optimization is that the function references are hoisted (not inline closures) and the element references are captured in a single scope.

**Further optimization:** For signals used in expressions (e.g., `${count() * 2}`), batch the subscription:
```javascript
count.subscribe(v => { 
  el0.firstChild.nodeValue = v;      // direct binding
  el1.firstChild.nodeValue = v * 2;  // expression binding
}, true);
```

This is already done (`generateConsolidatedSubscription`) — just ensure the generated code uses `nodeValue` instead of `textContent`.

**Files:** `codegen.ts`

**Risk:** 🟢 Low — this is mostly a refinement of existing consolidated subscription generation.

---

### C4. Reconciler Fast Path: Avoid Allocation on Swap

**Impact: MEDIUM — affects "swap rows" benchmark**

**Current swap detection:**
```javascript
if (mismatchCount === 2 && 
    managedItems[mismatch1] === newManagedItems[mismatch2] &&
    managedItems[mismatch2] === newManagedItems[mismatch1]) {
  // ... insertBefore logic ... then:
  managedItems[mismatch1] = newManagedItems[mismatch1]!;
  managedItems[mismatch2] = newManagedItems[mismatch2]!;
}
```

**Problem:** The swap fast path still allocates the full `newManagedItems` array before detecting the swap. 

**What vanillajs does:**
```javascript
const node1 = tbody.children[1];
const node998 = tbody.children[998];
tbody.insertBefore(node998, node1);
tbody.insertBefore(node1, tbody.children[998 + 1]);
```

Two DOM operations. No array allocation.

**Proposed optimization:** Detect swaps BEFORE building `newManagedItems`. When `oldLength === newLength`, check if all keys match and count mismatches early. If exactly 2, swap in-place without allocating:

```javascript
const temp = managedItems[mismatch1];
managedItems[mismatch1] = managedItems[mismatch2];
managedItems[mismatch2] = temp;
```

**Files:** `dom-binding.ts` (reconciler)

**Risk:** 🟢 Low — pure optimization of existing fast path.

---

### C5. Reconciler: `splice` Instead of Array Rebuild for Single Removal

**Impact: MEDIUM — affects "remove row" benchmark**

**Current single removal path:**
```javascript
// Array rebuild instead of splice
const rebuilt = new Array(oldLength - 1);
for (let i = 0; i < removedIdx; i++) rebuilt[i] = managedItems[i]!;
for (let i = removedIdx; i < oldLength - 1; i++) rebuilt[i] = managedItems[i + 1]!;
managedItems.length = 0;
for (let i = 0; i < rebuilt.length; i++) managedItems.push(rebuilt[i]!);
```

**Problem:** This creates a temporary array, copies everything twice, then pushes everything back. For 1000 items, that's 3000 array operations.

**What vanillajs does:** `this.data.splice(idx, 1)` — a single native operation that shifts elements in-place.

**Fix:**
```javascript
managedItems.splice(removedIdx, 1);
```

One line. The engine does the shift internally with optimized memory operations.

**Files:** `dom-binding.ts`

**Risk:** 🟢 Low — `splice` is the correct tool for this job.

---

### C6. Avoid `adoptedStyleSheets` Spread on Every Component Registration

**Impact: NEGLIGIBLE — but easy cleanup**

**Current:**
```javascript
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
```

**Problem:** Spreads the entire array every time a new stylesheet is added. For N components, that's O(N²) array copies.

**Fix:** Use direct mutation:
```javascript
document.adoptedStyleSheets.push(sheet);
```

**Files:** `component.ts`

**Risk:** 🟢 Low.

---

### C7. Compile-Time Event Handler Inlining

**Impact: MEDIUM — eliminates runtime event delegation complexity**

Instead of the current runtime `__setupEventDelegation` which does attribute-based event delegation, have the compiler generate direct event bindings:

**For static elements (buttons, links):**
```javascript
// Compiler generates (using structural paths from A2):
r.firstChild.children[1].children[0].onclick = run;
```

**For repeat containers (delegation on tbody):**
```javascript
// Compiler generates a single delegated handler:
tbody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const action = e.target.closest('[data-action]');
  if (action) {
    const act = action.getAttribute('data-action');
    if (act === 'remove') remove(tr.__id);
    else if (act === 'select') select(tr);
  }
});
```

This replaces the generic `__setupEventDelegation` function with template-specific code generated by the compiler.

**Files:** `codegen.ts`, `dom-binding.ts`

**Risk:** 🟡 Medium — need to handle all event modifiers at compile time.

---

## Phase Summary — Expected Impact

| ID | Change | Category | Impact | Risk | Bundle Size |
|---|---|---|---|---|---|
| **A1** | `nodeValue` instead of `textContent` | Codegen | 🔴 HIGH | 🟢 Low | Same |
| **A2** | Structural path navigation (no getElementById) | Codegen | 🔴 HIGH | 🟡 Med | Smaller (no IDs in HTML) |
| **A3** | Inline updates (no per-item subscribe overhead) | Codegen | 🟡 MED | 🟡 Med | Smaller |
| **A4** | Batch template cloning for bulk creates | Runtime | 🟡 MED-HIGH | 🟡 Med | Same |
| **A5** | Structural event handling (no data-evt attrs) | Codegen | 🟡 MED | 🟡 Med | Smaller |
| **A6** | Inlined template navigation (no navigatePath) | Codegen | 🔴 HIGH | 🟡 Med | Same |
| **A7** | No per-item signal in repeat | Runtime | 🔴 HIGH | 🔴 High | Smaller |
| **B1** | Remove `__findEl`/`__findTextNode` | Runtime | 🟡 MED | 🟢 Low | Smaller |
| **B2** | Streamline event delegation | Runtime | 🟢 LOW | 🟡 Med | Smaller |
| **B3** | Slim `clearAll` (no cleanup iteration) | Runtime | 🟢 LOW | 🟢 Low | Smaller |
| **B4** | Remove wrapper div helper | Runtime | 🟢 LOW | 🔴 High | Smaller |
| **B5** | Lazy KEY_CODES | Runtime | 🟢 NEGLIGIBLE | 🟢 Low | Smaller |
| **B6** | Signal notify micro-optimization | Runtime | 🟢 LOW-MED | 🟢 Low | Same |
| **C1** | No component wrapper div | Architecture | 🔴 HIGH | 🔴 High | Smaller |
| **C2** | Direct DOM property storage | Codegen | 🟡 MED | 🟡 Med | Same |
| **C3** | Single update function per component | Codegen | 🟡 MED | 🟢 Low | Same |
| **C4** | Reconciler swap optimization | Runtime | 🟡 MED | 🟢 Low | Same |
| **C5** | Array splice for single removal | Runtime | 🟡 MED | 🟢 Low | Same |
| **C6** | `adoptedStyleSheets.push` | Runtime | 🟢 NEGLIGIBLE | 🟢 Low | Same |
| **C7** | Compile-time event handlers | Codegen | 🟡 MED | 🟡 Med | Smaller |

---

## Execution Order

```
Sprint 1 — Quick Wins (low risk, immediate benchmark improvement):
  A1: nodeValue instead of textContent       → benchmark
  C5: splice for single removal              → benchmark
  C4: reconciler swap optimization           → benchmark
  C6: adoptedStyleSheets.push               → benchmark
  B6: signal notify micro-optimization       → benchmark

Sprint 2 — Repeat Overhaul (high risk, highest impact):
  A7: no per-item signal in repeat           → benchmark
  A3: inline signal subscriptions            → benchmark
  B3: slim clearAll (enabled by A7)          → benchmark
  A4: batch template cloning                 → benchmark

Sprint 3 — Event System Overhaul (medium risk):
  A5: structural event handling              → benchmark
  C7: compile-time event handlers            → benchmark
  B2: streamline/remove event delegation     → benchmark

Sprint 4 — Architecture (high risk):
  C1: no component wrapper div               → benchmark
  B4: remove createHostElement               → benchmark
  C2: direct DOM property storage            → benchmark
  C3: single update function per component   → benchmark

Sprint 5 — Inlined Navigation (benchmark A vs B):
  A6: inlined template navigation            → benchmark both ways (shared vs inline)
  B1: remove __findEl/__findTextNode         → benchmark

Sprint 6 — Deferred: Structural Path Navigation (most invasive, do last):
  A2: structural path navigation (no getElementById) → benchmark
  A2 requires careful handling of conditionals and dynamic content.
  Every other item works without A2. Only attempt after all above sprints 
  are complete and benchmarked.
```

---

## Benchmark Targets

Based on the current top performers (Chrome 144, latest results):

| Benchmark | vanillajs-keyed | Thane Target | Notes |
|---|---|---|---|
| Create 1,000 rows | 22.0ms | ≤ 23.5ms (1.07x) | Within solid-level performance |
| Replace all 1,000 | 24.4ms | ≤ 25.5ms (1.05x) | Tight — needs A1+A7 |
| Partial update | 9.5ms | ≤ 10.0ms (1.05x) | A1 (nodeValue) is critical |
| Select row | 2.2ms | ≤ 2.5ms (1.14x) | Already close if C1 helps |
| Swap rows | 11.3ms | ≤ 12.0ms (1.06x) | C4 + C5 |
| Remove row | 9.2ms | ≤ 9.5ms (1.03x) | C5 (splice) |
| Create 10,000 | 229ms | ≤ 245ms (1.07x) | A4+A7 critical |
| Append 1,000 | 25.6ms | ≤ 26.5ms (1.04x) | A7 for lower per-item cost |
| Clear | 9.0ms | ≤ 9.5ms (1.06x) | B3 after A7 |
| **Weighted geometric mean** | **1.00** | **≤ 1.05** | Top 5 among all frameworks |

---

## DX Preservation Notes

All changes in this plan preserve the existing developer experience:

- Users still write `defineComponent(() => { ... })` with `html`...`` templates
- `signal()`, `when()`, `whenElse()`, `repeat()` APIs unchanged
- `@click`, `@keydown`, etc. event syntax unchanged
- Component CSS scoping works the same (`:host` → class-based)
- `mountComponent()` / `destroyComponent()` API unchanged
- Routing unchanged
- Build command unchanged

The changes are entirely in **what code the compiler generates** and **how the runtime executes it**. The user-facing API surface stays identical.
