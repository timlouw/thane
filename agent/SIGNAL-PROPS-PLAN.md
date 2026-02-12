# Signal Props Implementation Plan

> **Goal**: Replace HTML-attribute-based prop serialization with a compiler-injected
> mount-call approach that passes Signal-wrapped props directly. Child components
> receive live signals — when the parent updates a prop, the child reacts instantly
> with zero re-initialization and zero DOM attribute round-tripping.

---

## ⚡ IMPLEMENTATION STATUS (updated 2025-02-12)

> **Read this section first.** It tells you exactly what has been done, what hasn't,
> and where to pick up. The rest of the plan is the original design document — still
> accurate, but some sections describe code that has already been implemented.

### Phase 1: Signal Props Core — ✅ COMPLETE (Steps 1-8)

All Phase 1 changes have been implemented, audited, and verified with a clean build.
The benchmark app compiles, `__mountChildren` is gone from the output, and the new
Signal Props mount code (`_gid('b0').replaceWith`, `__f` calls) is present.

| Step | Description | Status | Files Changed |
|------|-------------|--------|---------------|
| 1 | THANE406 `no-element-id` linter rule | ✅ Done | `src/compiler/plugins/thane-linter/rules/no-element-id.ts` (NEW), `rules/index.ts`, `errors.ts` |
| 2 | `generateComponentHTML` → emit `<template id="bN">` | ✅ Done | `src/compiler/utils/ast-utils.ts` |
| 3 | `findComponentCallsCTFE` always captures calls | ✅ Done | `src/compiler/plugins/component-precompiler/component-precompiler.ts` |
| 4 | CTFE counter + `ChildMountInfo` + anchor emission | ✅ Done | same file as Step 3 |
| 5 | Named imports preserved (stop stripping) | ✅ Done | same file as Step 3 — `findComponentImports`, `transformComponentImportsToSideEffects`, and `ComponentImportInfo` all deleted |
| 6 | Binding compiler accepts `childMounts`/`childMountCount` | ✅ Done | `src/compiler/plugins/reactive-binding-compiler/index.ts` |
| 7 | Directive positioning (child inside when/repeat) | ✅ Done | `directiveChildMounts` partition in `index.ts`, `generateMountLines` in `codegen.ts` |
| 8 | Delete `__mountChildren` + 3 call sites | ✅ Done | `src/runtime/component.ts` |

#### What Phase 1 changed (summary for orientation):

1. **`src/compiler/errors.ts`** — Added `NO_ELEMENT_ID = 'THANE406'` to `ErrorCode` enum.

2. **`src/compiler/plugins/thane-linter/rules/no-element-id.ts`** (NEW FILE) —
   Linter rule that bans `id="..."` attributes in `html` tagged template literals.
   Uses regex `\bid\s*=\s*(?:"[^"]*"|'[^']*')` on both `NoSubstitutionTemplateLiteral`
   and `TemplateExpression` (head + spans). Reports with accurate line/column.

3. **`src/compiler/plugins/thane-linter/rules/index.ts`** — `noElementId` imported
   and added as 7th entry in `allRules` array.

4. **`src/compiler/utils/ast-utils.ts`** — `generateComponentHTML` completely rewritten.
   Now accepts `ComponentHTMLConfig` with `anchorId: string` field. Emits
   `<template id="${config.anchorId}"></template>` instead of old `<selector prop="val">`.
   Both the interface and function are exported.

5. **`src/compiler/plugins/component-precompiler/component-precompiler.ts`** — Major changes:
   - `findComponentImports`, `transformComponentImportsToSideEffects`, and
     `ComponentImportInfo` interface **deleted** (tombstone comment at ~line 30).
   - New `CTFECallInfo` interface: `componentName`, `propsExpression`, `evaluatedProps?`,
     `startIndex`, `endIndex`, `templatePosition`.
   - New exported `ChildMountInfo` interface: `componentName`, `selector`,
     `propsExpression`, `anchorId`, `templatePosition`.
   - `findComponentCallsCTFE` always captures calls even when `evaluateExpressionCTFE`
     returns `EVAL_FAILED`. Stores raw `propsExpression` via `getText()`. Zero-args
     defaults to `'{}'`.
   - `onLoad` handler allocates `b0`, `b1`, … from `childIdCounter`, calls
     `generateComponentHTML` with `anchorId`, accumulates `ChildMountInfo[]`.
   - `buildTransformedResult` accepts `childMounts?` and `childMountCount?` and
     forwards them to `transformDefineComponentSource`.

6. **`src/compiler/plugins/reactive-binding-compiler/index.ts`** — Four changes:
   - `import type { ChildMountInfo }` from component-precompiler (line 31).
   - `transformDefineComponentSource` signature: 2 new optional params
     `childMounts?: ChildMountInfo[]`, `childMountCount?: number`.
   - `let idCounter = childMountCount ?? 0;` (was `0`).
   - `hasAnyBindings` includes `(childMounts != null && childMounts.length > 0)`.
   - Mount codegen block (~lines 504-518): iterates `childMounts`, appends
     `createElement` + `_gid('bN').replaceWith` + `ComponentName.__f` lines to
     `processedBindings`.
   - NOTE: The esbuild plugin's own `onLoad` (line ~688) still calls
     `transformDefineComponentSource(source, args.path)` with only 2 args —
     this is correct because standalone files don't go through CTFE, and the
     optional params default gracefully.

7. **`src/runtime/component.ts`** — `__mountChildren` function body deleted
   (was ~lines 165-183). All 3 call sites removed:
   - `defineComponent` factory (between `__b(ctx)` and `onMount`)
   - `__registerComponent` factory (same position)
   - `__registerComponentLean` factory (between `__b(ctx)` and `return`)
   - A residual JSDoc comment block explains the removal.
   - `componentFactories` Map is intentionally **retained** — it's still used by
     `mountComponent`/`_mountBySelector`. Deletion is Phase 2 Step 11.

#### Verified in compiled benchmark output:
- ❌ No `__mountChildren` anywhere in dist
- ✅ `<template id="b0"></template>` anchor in parent template
- ✅ `_gid("b0").replaceWith(_cm0)` mount call in `__b`
- ✅ `MyElementComponent.__f(_cm0, { color: "red" })` — direct factory call
- ✅ Named imports preserved (not stripped to side-effect-only)
- ✅ Bundle shrank: 6.02 KB → 5.72 KB (−300 bytes)

#### How to re-verify after any future changes:
```bash
cd thane && npm run build                        # TypeScript compiles
npm pack                                         # creates thane-0.0.44.tgz
cd benchmark
npm install thane@file:../thane-0.0.44.tgz --force
npm run build                                    # esbuild compiles benchmark
# Then inspect dist/main-*.js for:
#   - No __mountChildren
#   - _gid("b0").replaceWith present
#   - MyElementComponent.__f(_cm0, ...) present
#   - Named component imports preserved
```

---

### Phase 2: Cleanup — ✅ COMPLETE (Steps 9-11)

| Step | Description | Status | Details |
|------|-------------|--------|---------|
| 9 | Remove `data-bind-id` system | ✅ Done | Path-based navigation across all files; `usesDataBindId` removed from types |
| 10 | Repeat-context variable renaming | ✅ Done | `renameIdentifierInExpression` in `codegen.ts` renames item→`item`, index→`_idx` |
| 11 | Delete dead runtime code | ✅ Done | `mountComponent`, `destroyComponent`, `componentFactories`, `CLASS_ACCESS`, `classStyle`, `_mountBySelector` all deleted |

**Step 7 (originally deferred from Phase 1)**: Now fully implemented.
`directiveChildMounts` partition logic in `index.ts` routes child mounts into the
correct directive scope. `generateMountLines` in `codegen.ts` emits scoped mount
code inside conditional, whenElse, and repeat block initializers.

---

### Phase 3: Repeat Unification — ✅ COMPLETE (Steps 12-18)

| Step | Description | Status |
|------|-------------|--------|
| 12 | Extend optimized path for `no-bindings` | ✅ Done |
| 13 | Extend optimized path for `signal-bindings` + `mixed-bindings` | ✅ Done |
| 14 | Extend optimized path for `nested-conditional` | ✅ Done |
| 15 | Extend optimized path for `nested-repeat` | ✅ Done |
| 16 | Collapse to single reconciler (`createKeyedReconciler` only) | ✅ Done |
| 17 | Delete fallback path | ✅ Done |
| 18 | End-to-end testing | ✅ Done |

---

### Key File Map (final state — all phases complete)

These are the files an agent will need to read to understand the current codebase:

| File | Role | Final State |
|------|------|-------------|
| `src/compiler/errors.ts` | Error code enum | THANE406 added |
| `src/compiler/utils/ast-utils.ts` | `generateComponentHTML` | Rewritten — emits `<template id="bN">` |
| `src/compiler/plugins/component-precompiler/component-precompiler.ts` | CTFE plugin | Major rewrite — `CTFECallInfo`, `ChildMountInfo`, dead code deleted |
| `src/compiler/plugins/reactive-binding-compiler/index.ts` | Binding compiler plugin | Signature updated, mount codegen, `directiveChildMounts` partition, import logic |
| `src/compiler/plugins/reactive-binding-compiler/codegen.ts` | Binding code generator | Major rewrite — optimized repeat paths (Steps 12-15), `generateMountLines`, fallback deleted |
| `src/compiler/plugins/reactive-binding-compiler/types.ts` | Binding types | `usesDataBindId`/`CLASS_ACCESS`/`classStyle` removed; `signalElementBindings`/`directiveAnchorPaths` added |
| `src/compiler/plugins/reactive-binding-compiler/template-utils.ts` | Template utilities | `data-bind-id` injection removed |
| `src/compiler/plugins/reactive-binding-compiler/template-processing.ts` | Template analysis | `data-bind-id` references removed |
| `src/compiler/plugins/reactive-binding-compiler/repeat-analysis.ts` | Repeat optimization | `generateStaticRepeatTemplate` with signal/event/anchor path computation |
| `src/compiler/plugins/thane-linter/rules/no-element-id.ts` | THANE406 rule | NEW — created in Phase 1 |
| `src/compiler/plugins/thane-linter/rules/index.ts` | Rule registry | THANE406 registered |
| `src/runtime/component.ts` | Runtime component system | `__mountChildren`/`mountComponent`/`destroyComponent`/`_mountBySelector` deleted |
| `src/runtime/dom-binding.ts` | Runtime DOM binding | Fallback functions deleted; `bindConditional` refactored with `anchorEl`; only `createKeyedReconciler` remains |
| `src/runtime/index.ts` | Runtime barrel exports | Cleaned — only `createKeyedReconciler`, `__bindIf`, `__bindIfExpr` + core exports |
| `src/compiler/utils/constants.ts` | BIND_FN constants | `REPEAT`/`NESTED_REPEAT`/`FIND_EL`/`FIND_TEXT_NODE` removed |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Current System (What We're Replacing)](#2-current-system)
3. [New System (Signal Props)](#3-new-system)
4. [File-by-File Changes](#4-file-by-file-changes)
5. [Directive Interactions](#5-directive-interactions)
6. [Deep Nesting & Prop Drilling](#6-deep-nesting--prop-drilling)
7. [Implementation Order](#7-implementation-order)
8. [Testing & Validation](#8-testing--validation)
9. [Appendix: Code Locations Reference](#9-appendix-code-locations-reference)

---

## 1. Architecture Overview

### Current Flow (3 stages — broken)
```
CTFE: ${Child({ color: 'red' })}
  → generates: <child-component color="red"></child-component>
  → runtime __mountChildren scans DOM, reads attributes back as strings
  → child factory receives { color: "red" } (always strings, no reactivity)
```

### New Flow (2 stages — compiler-injected mounts)
```
CTFE: ${Child({ color: colorSignal })}
  → CTFE allocates bN from its own counter (b0, b1, …)
  → emits: <template id="b0"></template>  (same bN scheme as when/repeat)
  → passes childMountCount to binding compiler (which starts its idCounter at that offset)
  → binding compiler injects mount call in parent's __b function:
      const _cm0 = document.createElement('child-component');
      _gid('b0').replaceWith(_cm0);
      Child.__f(_cm0, { color: colorSignal });
  → child factory receives { color: <Signal> } (live signal, fine-grained reactivity)
```

**Key Insight**: The compiler already knows which child components are used and what
props are passed to them. Instead of serializing props to HTML and deserializing at
runtime, the compiler creates the child element in JavaScript and passes it directly
to the child factory — no DOM queries, no attribute round-tripping.

### Output Size Constraint — Dist Must Not Grow

The benchmark dist (currently 2,859 bytes, single JS file) must **not grow** as a
result of this work. It can only stay the same or shrink. Changes that eliminate
dead code paths actively shrink it:

- **`__mountChildren` deleted** (~160 bytes minified): the `x` function that scans
  the DOM with `querySelectorAll` is removed. With compiler-injected mounts, runtime
  scanning is gone.
- **`componentFactories` map iteration removed**: the `b` map and its iteration
  loop inside `__mountChildren` are deleted.
- **Template is smaller**: `<template id="b0"></template>` replaces
  `<my-element-component color="red"></my-element-component>` — fewer bytes.
- **No new runtime functions added**: the mount calls (`createElement` +
  `replaceWith` + `__f`) are inlined in `__b`, not a new runtime function.

**Compiler-driven minimal output**: The compiler already generates imports
conditionally — it only adds `createKeyedReconciler` if there are repeats,
`__bindIf` if there are conditionals, etc. (see `index.ts` lines 415-460).
This means:

- If the app has no repeats → no repeat runtime is imported → esbuild tree-shakes
  `createKeyedReconciler`, etc. entirely.
- If the app has repeats → only `createKeyedReconciler` is imported, fully
  inlined in `__b`. No `__bindRepeat` wrapper. The compiler auto-injects
  `(_, i) => i` as the key function when no `trackBy` is specified.
- The fallback path (`__bindRepeat`, `__findEl`, `__findTextNode`) is deleted
  entirely — the optimized path handles all cases. Unused runtime functions are
  tree-shaken by esbuild.

**Principle**: Every extension to the optimized repeat path must be compiler-driven.
The compiler emits only the specific code the component needs. The runtime stays
minimal. The dist for any given app contains only what that app actually uses.

### ID Scheme — Unified `bN` Namespace

The framework uses a **single monotonic counter** (`idCounter`) for ALL internal
element IDs. Every binding target, conditional anchor, repeat anchor, text span,
and now child-component anchor shares the same `bN` namespace (`b0`, `b1`, `b2`, …).

**Counter ownership**: The CTFE (component-precompiler) runs first and allocates
`b0`, `b1`, … for child component anchors. It then passes `childMountCount` to the
reactive-binding-compiler, which starts its `idCounter` at that offset. This means
child anchors get the low IDs (`b0`, `b1`) and everything else (conditionals,
repeats, text spans) follows sequentially (`b2`, `b3`, …). Single pass, no markers,
no deferred replacement.

### No User IDs — `no-element-id` Linter Rule (THANE406)

Previously, when the compiler needed to assign an internal ID to an element that
already had a user-provided `id` attribute, it used `data-bind-id="bN"` as a
fallback. At runtime, these elements were found via
`r.querySelector('[data-bind-id="bN"]')` — an O(n) search instead of O(1)
`getElementById`.

**We are eliminating this entirely.** A new linter rule `no-element-id` (THANE406)
will **ban `id` attributes in component templates**. Rationale:

1. The compiler already assigns IDs to every element that needs binding — users
   never need to set IDs manually for framework functionality
2. `getElementById` is O(1); `querySelector('[data-bind-id=…]')` is O(n) — banning
   user IDs lets us always use the fast path
3. This eliminates the `data-bind-id` attribute, the `usesDataBindId` flag, the
   dual-lookup logic in `__findEl`, and the `querySelector` fallback code in
   codegen — significant simplification of both compiler and runtime
4. If a user truly needs to reference a DOM element, they can use `ctx.root` with
   a class selector or the framework's reactive binding system (which already
   covers text, attribute, style, conditional, and repeat bindings)

**Impact on existing code** (removed):
- `data-bind-id` attribute injection in `template-processing.ts`, `template-utils.ts`,
  `repeat-analysis.ts`
- `usesDataBindId` field in `BindingInfo` type
- `dataBindIdSet` checks in `codegen.ts` (4 locations)
- `__findEl` dual-lookup (`el.id` + `data-bind-id` + `querySelector`) in
  `dom-binding.ts` — simplified to just `el.querySelector('#' + id)`
- All `r.querySelector('[data-bind-id="…"]')` codegen in `codegen.ts`

### Unified Repeat Path — Eliminating the Fallback

Currently the repeat system has two codegen + runtime paths:

- **Optimized** (fully inlined `createKeyedReconciler` in `__b`): Pre-compiled
  `<template>`, `children[N]` path navigation, zero ID lookups in items.
  The compiler inlines `createItem`, `fillItem`, and `update` directly inside
  `__b` — no intermediate runtime wrapper function. The only runtime import is
  `createKeyedReconciler` (the sole reconciler). The compiler auto-injects
  `(_, i) => i` as the key function when no `trackBy` is specified.
- **Fallback** (`__bindRepeat` runtime function): String-based `innerHTML`,
  `__findEl` for element lookup, `initItemBindings` callback. Also imports
  `__findEl` and `__findTextNode`.

Note: `__bindRepeatTpl` (in `dom-binding.ts`) is an exported runtime function that
is **never used by the compiler's codegen** — the optimized path fully inlines
everything. `__bindRepeatTpl` can be deleted alongside the fallback.

The fallback exists because the optimized path currently can't handle:
1. Signal bindings (component-level signals referenced inside repeat items)
2. Nested repeats
3. Nested conditionals inside repeat items
4. Mixed bindings (item + component signal in same expression)
5. Multi-root item templates

**We will extend the optimized path's inlined codegen to handle cases 1-4**.
Multi-root (case 5) is **banned by lint rule THANE407** (`single-root-repeat-item`).
The reconciler's `ManagedItem.el` stays a single `Element` reference — no arrays,
no sub-indexing, no performance penalty on the hot path. Details in Section 5.5.

**Dist impact**: The compiler already conditionally imports `__bindRepeat` only
when a non-optimizable repeat exists (see `index.ts` line 440). Once all repeats
use the optimized path, `__bindRepeat` is never imported, and esbuild tree-shakes
it — along with `__findEl`, `__findTextNode`, `__bindNestedRepeat`, and
`__bindRepeatTpl`. For the benchmark app (no repeats), the dist is **unchanged**
since none of these functions are imported today.

---

## 2. Current System (What We're Replacing)

> **NOTE (post Phase 1)**: Sections 2.1-2.4 describe the OLD code that Phase 1
> replaced. `__mountChildren` (Section 2.3) has been deleted.
> `transformComponentImportsToSideEffects` (Section 2.4) has been deleted.
> `generateComponentHTML` (Section 2.2) has been rewritten.
> `findComponentCallsCTFE` (Section 2.1) has been modified to always capture calls.
> These sections are kept for architectural context.

### 2.1 CTFE in `component-precompiler.ts` (lines 283-397)

The `findComponentCallsCTFE` function finds `${ComponentName({ prop: value })}` in
template literals. For each match, it:

1. Evaluates the props object at compile time via `evaluateExpressionCTFE`
2. Calls `generateComponentHTML` to produce `<selector prop="val"></selector>`
3. Replaces the `${...}` interpolation with the generated HTML string
4. Converts the named import to a side-effect import (`import './child'`)

**Problem**: `evaluateExpressionCTFE` can only resolve static values (literals,
class properties). Signal references like `colorSignal` fail with `EVAL_FAILED`,
causing CTFE to skip the component entirely — leaving the broken `${Component(...)}` 
call in the template at runtime.

### 2.2 `generateComponentHTML` in `ast-utils.ts` (lines 565-576)

```typescript
export const generateComponentHTML = (config: ComponentHTMLConfig): string => {
  const { selector, props } = config;
  const propsString = Object.entries(props)
    .map(([key, value]) => `${key}="${val}"`)
    .join(' ');
  return `<${selector}${propsString ? ' ' + propsString : ''}></${selector}>`;
};
```

Serializes ALL props as HTML attributes. This is what we're eliminating.

### 2.3 `__mountChildren` in `component.ts` (lines 167-184)

Runtime scan that finds child elements by tag name and mounts them:
```typescript
const __mountChildren = (root: ComponentRoot): void => {
  for (const [selector, factory] of componentFactories) {
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
      if (el.classList.contains(selector)) continue;
      const props = {};
      for (const attr of el.attributes) props[attr.name] = attr.value;
      factory(el, props);
    }
  }
};
```

Called from all three factory functions (`defineComponent`, `__registerComponent`,
`__registerComponentLean`) after template/bindings and before onMount.

**Current limitation**: `__registerComponentLean` does **not** add entries to
`componentFactories`, so `__mountChildren` cannot discover lean-registered
components. This is already a bug in the current system and reinforces the need
for compiler-injected mounts.

**This entire function will be removed** — the compiler will emit explicit mount
calls instead.

### 2.4 Import Transformation in `component-precompiler.ts` (lines 83-113)

`transformComponentImportsToSideEffects` currently converts:
```typescript
import { ChildComponent } from './child';
```
to:
```typescript
import './child';  // side-effect only — registration happens at import
```

This will change — we need to **keep the named import** so the compiled `__b`
function can reference `ChildComponent.__f`.

---

## 3. New System (Signal Props)

### 3.1 What the Compiler Will Generate

**Before** (current CTFE output):
```html
<child-component color="red"></child-component>
```

**After** (single-phase anchor emission):
```html
<template id="b0"></template>
```

The CTFE directly emits the `<template id="bN">` anchor, allocating `b0`, `b1`, …
from its own counter. It passes the count to the binding compiler so it starts
its `idCounter` at the right offset. No markers, no deferred replacement.

The `__b` (initializeBindings) function of the parent will include:
```javascript
// Mount child component — create element, replace anchor, mount with props
const _cm0 = document.createElement('child-component');
_gid('b0').replaceWith(_cm0);
ChildComponent.__f(_cm0, { color: colorSignal });
```

`_cm0` is a JS-local variable name ("child mount 0") — not an element ID. The
element's actual anchor ID is `b0` from the CTFE counter. The element is created
in JS (`document.createElement`) and we already have the reference — no
`querySelector` or any DOM search needed. The anchor is found via `_gid` which
uses `getElementById` (O(1), already set up in every `__b` function).

### 3.2 Static Props vs Signal Props

When all props are static literals (the common case), the compiler still generates
them as plain object properties. The child's setup function decides whether to wrap
them in signals:

```typescript
// Parent template: ${Child({ color: 'red' })}
// Compiled mount call:
Child.__f(_cm0, { color: 'red' });

// Child setup:
const color = signal(ctx.props.color ?? null);  // creates signal from static value
```

When a prop is a signal reference:
```typescript
// Parent template: ${Child({ color: colorSignal })}
// Compiled mount call:
Child.__f(_cm0, { color: colorSignal });  // passes the actual signal

// Child setup:
const color = ctx.props.color;  // IS the parent's signal, no wrapping needed
```

### 3.3 How Props Flow for Each Case

#### Case A: Static Props (Most Common)
```
Parent template:  ${Child({ color: 'red' })}
CTFE succeeds:    Props evaluated to { color: 'red' }
CTFE emits:       <template id="b0"></template>  (direct anchor, bN from CTFE counter)
__b emits:        const _cm0 = document.createElement('child-component');
                  _gid('b0').replaceWith(_cm0);
                  Child.__f(_cm0, { color: 'red' })
Child receives:   ctx.props = { color: 'red' }
```

#### Case B: Signal Props (Reactive)
```
Parent template:  ${Child({ color: myColor })}
CTFE partial:     Props contain signal ref — store raw expression, emit anchor
CTFE emits:       <template id="b0"></template>  (direct anchor)
__b emits:        const _cm0 = document.createElement('child-component');
                  _gid('b0').replaceWith(_cm0);
                  Child.__f(_cm0, { color: myColor })
Child receives:   ctx.props = { color: <Signal<string>> }
```

#### Case C: Mixed Props
```
Parent template:  ${Child({ label: 'Hello', color: myColor, size: 42 })}
CTFE partial:     Some static, some signal
CTFE emits:       <template id="b0"></template>  (direct anchor)
__b emits:        const _cm0 = document.createElement('child-component');
                  _gid('b0').replaceWith(_cm0);
                  Child.__f(_cm0, { label: 'Hello', color: myColor, size: 42 })
Child receives:   ctx.props = { label: 'Hello', color: <Signal<string>>, size: 42 }
```

---

## 4. File-by-File Changes

### 4.1 `src/compiler/utils/ast-utils.ts` — ✅ DONE

**File**: `src/compiler/utils/ast-utils.ts`  
**Function**: `generateComponentHTML` (lines 565-576)

**Change**: Instead of emitting `<selector prop="val"></selector>`, emit a
`<template id="bN"></template>` anchor directly. The CTFE owns the start of the
`bN` counter and allocates IDs `b0`, `b1`, `b2`, … for each child component call.
It passes the final count to the binding compiler so it starts its `idCounter`
at that offset.

```typescript
interface ComponentHTMLConfig {
  selector: string;
  props: Record<string, any>;  // kept for mount-call expression building
  anchorId: string;            // NEW — "b0", "b1", etc. from CTFE counter
}

export const generateComponentHTML = (config: ComponentHTMLConfig): string => {
  // Emit a <template> anchor directly — same shape as when()/repeat() anchors.
  // The CTFE owns the start of the bN counter; the binding compiler will
  // start its idCounter at the offset = number of child mounts.
  return `<template id="${config.anchorId}"></template>`;
};
```

**Why the CTFE can own the counter start**: The CTFE runs before the binding
compiler. It allocates `b0`, `b1`, … for N child mounts, then tells the binding
compiler to start at `bN`. This is a clean handoff — no markers, no deferred
replacement, no second pass. The binding compiler's `idCounter` simply starts
at `childMountCount` instead of `0`.

---

### 4.2 `src/compiler/plugins/component-precompiler/component-precompiler.ts` — ✅ DONE

**File**: `src/compiler/plugins/component-precompiler/component-precompiler.ts`

#### 4.2.1 Change `findComponentCallsCTFE` (lines 283-397)

Currently, this function tries to evaluate props at compile time and gives up if
any prop contains a signal reference. We need to change it to:

1. **Always succeed** when it finds a `${Component({...})}` call — even if props
   can't be fully evaluated
2. Store the **raw source text** of the props expression (not the evaluated value)
   alongside any statically evaluated values
3. Return both the evaluated props (for any static-only cases) AND the raw
   expression text

**New return type** for each component call:
```typescript
{
  componentName: string;
  propsExpression: string;       // Raw source: "{ color: myColor, size: 42 }"
  evaluatedProps?: Record<string, any>;  // Only if ALL props are static
  startIndex: number;
  endIndex: number;
}
```

**Key change in the visit function**: When `evaluateExpressionCTFE` returns
`EVAL_FAILED`, instead of skipping, capture the raw text of the props argument:

```typescript
// Current:
const props = evaluateExpressionCTFE(propsArg, sourceFile, classProperties);
if (props !== EVAL_FAILED && typeof props === 'object' && props !== null) {
  calls.push({ componentName, props, startIndex, endIndex });
}

// New:
const props = evaluateExpressionCTFE(propsArg, sourceFile, classProperties);
const propsExpression = propsArg.getText(sourceFile);

if (props !== EVAL_FAILED && typeof props === 'object' && props !== null) {
  calls.push({ componentName, propsExpression, evaluatedProps: props, startIndex, endIndex });
} else {
  // Signal/dynamic props — still capture the call, just without evaluated values
  calls.push({ componentName, propsExpression, startIndex, endIndex });
}
```

Also handle the **zero-args case** where a component is called with no props:
`${Component()}` → `propsExpression: '{}'`

#### 4.2.2 Change the CTFE replacement in `onLoad` (lines 442-505)

Currently replaces `${Component({props})}` with the HTML string. Change to:

1. Allocate a `bN` anchor ID directly from a CTFE counter (starting at 0)
2. Replace the `${Component({...})}` call with `<template id="bN"></template>`
3. Store the child mount info, including the pre-allocated `anchorId`
4. After the loop, pass `childMountCount` as offset to the binding compiler

```typescript
// CTFE owns the start of the bN counter
let childIdCounter = 0;
const childMounts: ChildMountInfo[] = [];

for (const call of sortedCalls) {
  const componentDef = componentDefinitions.get(call.componentName);
  if (componentDef) {
    const anchorId = `b${childIdCounter++}`;
    const compiledHTML = generateComponentHTML({
      selector: componentDef.selector,
      props: {},
      anchorId,
    });
    // Emits: <template id="b0"></template>  (direct anchor, no marker)

    modifiedSource = modifiedSource.substring(0, call.startIndex)
      + compiledHTML
      + modifiedSource.substring(call.endIndex);

    childMounts.push({
      componentName: call.componentName,
      selector: componentDef.selector,
      propsExpression: call.propsExpression,
      anchorId,
    });
  }
}

// childMountCount = childIdCounter — passed as offset to binding compiler
```
```

#### 4.2.3 Change `transformComponentImportsToSideEffects` (lines 83-113)

**Keep the named import** for CTFE'd components instead of converting to side-effect-only:

```typescript
// Current behavior:
// import { Child } from './child'  →  import './child'

// New behavior:
// import { Child } from './child'  →  import { Child } from './child'  (UNCHANGED)
```

The simplest approach: **don't call** `transformComponentImportsToSideEffects` at all.
Remove the call site. The named import must survive so the `__b` function can
reference `Child.__f`.

Alternatively, if there are other non-component named imports to keep, make it only
strip component names from the named imports (current behavior) BUT also add back
the side-effect import. Actually, the simplest change: just skip the call entirely.
The import stays, the side-effect still happens (importing a module with a
`defineComponent`/`__registerComponent` call registers the factory).

#### 4.2.4 Pass child mount info to the reactive binding compiler

The component-precompiler runs BEFORE the reactive-binding-compiler in the plugin
pipeline. After CTFE completes, we need to pass two things downstream:

1. **`childMounts`** — the array of `ChildMountInfo` objects (for mount code gen)
2. **`childMountCount`** — the number of child anchors allocated (so the binding
   compiler starts its `idCounter` at this offset)

```typescript
// In buildTransformedResult (update signature to accept childMounts/childMountCount):
const transformed = transformDefineComponentSource(
  result,
  filePath,
  childMounts,        // array of ChildMountInfo
  childMountCount,    // = childIdCounter from CTFE
);
```

The binding compiler's `idCounter` is initialized to `childMountCount` instead of
`0`, so all binding IDs (`bN`) are sequential with zero gaps or collisions:
- CTFE allocates `b0`, `b1`, … `b(N-1)` for N child mounts
- Binding compiler allocates `bN`, `bN+1`, … for conditionals, repeats, text spans

---

### 4.3 `src/compiler/plugins/reactive-binding-compiler/index.ts` — ✅ DONE

**File**: `src/compiler/plugins/reactive-binding-compiler/index.ts`

#### 4.3.1 Accept child mount info in `transformDefineComponentSource`

Add `childMounts` and `childMountCount` parameters:

```typescript
interface ChildMountInfo {
  componentName: string;   // e.g. "MyElementComponent"
  selector: string;        // e.g. "my-element-component"
  propsExpression: string; // e.g. "{ color: myColor }" or "{ color: 'red' }"
  anchorId: string;        // Pre-allocated by CTFE: "b0", "b1", etc.
  templatePosition: number; // Position in template HTML for directive matching
}

export const transformDefineComponentSource = (
  source: string,
  filePath: string,
  childMounts?: ChildMountInfo[],  // NEW
  childMountCount?: number,        // NEW — offset for idCounter
): string | null => {
```

**Critical**: Initialize `idCounter` at `childMountCount` (not 0):
```typescript
// In the idCounter initialization (line ~312):
let idCounter = childMountCount ?? 0;
```

This ensures the binding compiler's IDs (`bN`, `bN+1`, …) continue seamlessly
after the CTFE's IDs (`b0`, `b1`, … `b(N-1)`).
```

#### 4.3.2 Generate mount code in `__b`

The `<template id="bN">` anchors are already in the template (emitted directly by
CTFE). No marker replacement is needed. The binding compiler only needs to generate
mount code in the `__b` function.

After the binding code is generated (after the `generateInitBindingsFunction` call),
append child mount statements to `processedBindings`:

```typescript
if (childMounts && childMounts.length > 0) {
  const mountLines: string[] = [];
  for (let i = 0; i < childMounts.length; i++) {
    const cm = childMounts[i];
    const varName = `_cm${i}`;  // JS-local variable name, NOT an element ID
    // 1. Create the real element in JS (we already have the reference)
    // 2. Replace the anchor (found via _gid = getElementById — O(1))
    // 3. Mount the child factory with props (signals pass by reference)
    mountLines.push(`const ${varName} = document.createElement('${cm.selector}');`);
    mountLines.push(`_gid('${cm.anchorId}').replaceWith(${varName});`);
    mountLines.push(`${cm.componentName}.__f(${varName}, ${cm.propsExpression});`);
  }
  processedBindings += '\n    ' + mountLines.join('\n    ');
}
```

This generates code inside the `__b: (ctx) => { ... }` function, which has access
to:
- `_gid` (the `getElementById` helper, already declared in every `__b` function)
- `r` (the component root, via `const r = ctx.root;`)
- All local signals (they're in the same closure scope)
- The imported `ComponentName` (the named import is kept)

**Why this is fast**: `document.createElement` is one of the fastest DOM operations.
`_gid('b3')` uses `getElementById` which is O(1). `replaceWith` is a single DOM
mutation. No searching, no query matching, no attribute parsing. The element
reference is immediate — created in JS, passed directly to the factory.

**Consistency with existing patterns**: The anchor `<template id="b3">` is identical
in shape and ID scheme to:
- `when()` anchors: `<template id="b0"></template>` (conditional)
- `repeat()` anchors: `<template id="b2"></template>` (list marker)
- All found via the same `_gid()` call at runtime

#### 4.3.3 Multiple instances of the same child component

When a parent template contains multiple instances of the same child component:
```html
${Child({ color: 'red' })}
${Child({ color: 'blue' })}
```

Each gets a unique `bN` ID from the CTFE counter — no disambiguation needed.
The CTFE allocates `b0` and `b1` for the two child anchors. The binding compiler
starts its `idCounter` at 2 (the offset). If the binding compiler allocates IDs
for a text binding, a conditional, and a repeat, they get `b2`, `b3`, and `b4`.

Template after CTFE:
```html
<template id="b0"></template>
<template id="b1"></template>
```

The `__b` function simply creates and mounts each one independently:
```javascript
const _cm0 = document.createElement('child-component');
_gid('b0').replaceWith(_cm0);
Child.__f(_cm0, { color: 'red' });

const _cm1 = document.createElement('child-component');
_gid('b1').replaceWith(_cm1);
Child.__f(_cm1, { color: 'blue' });
```

The CTFE counter naturally solves multi-instance — each child mount has its
own unique ID allocated at CTFE time. No risk of collision with binding compiler
IDs because the binding compiler starts at the offset.

---

### 4.4 `src/runtime/component.ts` — ✅ DONE (Step 8 only)

> **Note**: `__mountChildren` is deleted (Step 8). The remaining deletions listed
> in 4.4.3 (`componentFactories`, `mountComponent`, etc.) are Phase 2 Step 11.

**File**: `src/runtime/component.ts`

#### 4.4.1 Remove `__mountChildren`

Delete the entire `__mountChildren` function (lines 167-184).

#### 4.4.2 Remove all calls to `__mountChildren`

Remove the `__mountChildren(root)` call from:
- `defineComponent` factory (around line 314)
- `__registerComponent` factory (around line 383)
- `__registerComponentLean` factory (around line 431)

The child component mounting is now handled by the compiler-injected code in `__b`.

#### 4.4.3 Keep `componentFactories` map (optional cleanup)

The `componentFactories` map is still used by:
- `_mountBySelector` (for `mountComponent` API)
- `defineComponent` (dev-time path) currently calls `componentFactories.set`

**Note**: `__registerComponentLean` does **not** call `componentFactories.set`,
so `__mountChildren` already misses lean-registered components. This is a
current limitation of the old CTFE + runtime-scan path, and a key reason for
compiler-injected mounts.

With `__mountChildren` removed, `componentFactories` is only needed for the
`mountComponent` public API. It can stay. If you want to remove it entirely, you'd
also need to remove `mountComponent` — that's a separate decision.

#### 4.4.4 Ensure factory handles pre-populated elements

The factory's `createHostElement` function (lines 199-214) already handles the
case where a `target` element is provided — it adds the selector class and sets up
`getElementById`. This works correctly for the new mount-call approach since the
compiler passes the existing DOM element as the target.

---

### 4.5 `src/compiler/utils/constants.ts`

`BIND_FN.FIND_TEXT_NODE` is currently defined but **not used** in the import
generation logic (reactive-binding-compiler `index.ts`). It can be removed as
part of the cleanup, but there is no call-site to update.

---

### 4.6 `src/runtime/index.ts`

`__mountChildren` is **not exported** today, but `runtime/index.ts` currently
exports `mountComponent`, `destroyComponent`, `__findEl`, `__findTextNode`,
`__bindRepeat`, `__bindRepeatTpl`, `__bindNestedRepeat`, and `createReconciler`.
Those exports must be removed when the corresponding runtime functions are deleted.

---

### 4.7 New Linter Rule: `no-element-id` (THANE406) — ✅ DONE

**File**: `src/compiler/plugins/thane-linter/rules/no-element-id.ts` (NEW)

**Purpose**: Ban `id="..."` attributes on elements inside component templates. This
eliminates the entire `data-bind-id` fallback system — if users can't set IDs, the
compiler always owns the `id` attribute, and `data-bind-id` is never needed.

```typescript
import { LintRuleDefinition } from '../thane-linter';

export const noElementIdRule: LintRuleDefinition = {
  meta: {
    code: 'THANE406',
    name: 'no-element-id',
    severity: 'error',
    description: 'Element IDs in templates are reserved for the compiler. Use class names or data attributes instead.',
  },
  check: (context) => {
    // Walk the template HTML AST looking for id="..." attributes on non-compiler elements.
    // Compiler-emitted <template id="bN"> anchors are excluded (they don't exist in user source).
    // Pattern to detect: any tag with id="..." in the template literal.
    //
    // The simplest approach: regex scan of the raw template string for id="..." or id='...'
    // on HTML tags. Report each occurrence with line/column info.
    //
    // Example violations:
    //   <div id="my-section">       ← ERROR: THANE406
    //   <input id="email-field">    ← ERROR: THANE406
    //
    // Example OK (compiler-generated, not in user source):
    //   <template id="b0">          ← OK (never appears in user source)
    //   <span id="b3">              ← OK (never appears in user source)
  },
};
```

**Registration** — add to `src/compiler/plugins/thane-linter/rules/index.ts`:
```typescript
import { noElementIdRule } from './no-element-id';
export const allRules = [
  // ... existing rules THANE400-THANE405 ...
  noElementIdRule,
];
```

**Impact**: This rule enables a massive simplification — with user IDs banned:
- `data-bind-id` attribute is never needed → remove from template-utils, codegen, etc.
- `__findEl` dual-lookup is never needed → remove entirely
- `buildElementIdEdits` can always use `id=` → simplified to trivial assignment
- Runtime `getElementById` is always correct → no fallback paths

---

### 4.8 Remove `data-bind-id` System — 🔲 NOT STARTED (Phase 2, Step 9)

With THANE406 guaranteeing no user IDs, remove the entire `data-bind-id` fallback:

**4.8.1 `src/compiler/plugins/reactive-binding-compiler/template-utils.ts`**

- `buildElementIdEdits` (lines 395-426): Remove the branch that checks
  `element.attributes.has('id')` and falls back to `data-bind-id`. Always use `id`.
  The function becomes trivial: `edits.push({ id: nextId })`.
- Remove `usesDataBindId` tracking at lines 135, 145, 187, 197.

**4.8.2 `src/compiler/plugins/reactive-binding-compiler/template-processing.ts`**

- Remove `data-bind-id` injection at lines 254-255 and lines 598-599.
- The ID injection at lines 230-262 simplifies: always set `id="bN"`, never
  set `data-bind-id`.

**4.8.3 `src/compiler/plugins/reactive-binding-compiler/types.ts`**

- Remove `usesDataBindId?: boolean` field at line 146.

**4.8.4 `src/compiler/plugins/reactive-binding-compiler/codegen.ts`**

- Remove `data-bind-id` codegen at lines 385-388, 419-424, 461-466, 528-532.
- Every `_gid('bN')` call is guaranteed to work via `getElementById` — no fallback.

**4.8.5 `src/compiler/plugins/reactive-binding-compiler/repeat-analysis.ts`**

- Remove `data-bind-id` stripping at line 154:
  `staticHtml.replace(/\s*data-bind-id="[^"]*"/g, '')`
- Remove `data-bind-id` checks in element path finding at lines 106, 124, 216.

**4.8.6 `src/runtime/dom-binding.ts`**

- Simplify `__findEl` (lines 25-46): If still needed for repeat path, simplify to
  just `el.querySelector('#' + id)`. But if the repeat path is unified (Section 5.5),
  `__findEl` can be deleted entirely.
- Remove `data-bind-id` attribute checks from all runtime code.

**4.8.7 `src/compiler/plugins/reactive-binding-compiler/index.ts`**

- Remove `hasNonOptimizedWithBindings` check at lines 452-456 that determines if
  `__findEl` is needed in the runtime import list.
- Remove `FIND_EL` from the import list generation.

### 4.9 New Lint Rule: `single-root-repeat-item` (THANE407) — 🔲 NOT STARTED (Phase 3 prerequisite)

Bans repeat item templates with more than one root element. The reconciler's
`ManagedItem<T>` tracks each item as a single `el: Element`. Supporting multi-root
would require changing to `els: Element[]` and modifying every reconciler operation
(removal, swap, reorder, cursor walking, ref-node positioning — 16 call sites in
`dom-binding.ts`), penalizing the 99% single-root case with extra indirection and
breaking V8 hidden-class shapes.

**Rule ID**: `THANE407`
**Rule name**: `single-root-repeat-item`
**Severity**: Error
**Category**: Correctness

**Detection**:
Scan every `repeat()` call's item template. Parse the template HTML and count root
elements (exclude whitespace-only text nodes). If `roots.length > 1`, report error.

**Error message**:
```
THANE407: Repeat item templates must have exactly one root element.
         Found N root elements. Wrap them in a single container element.
         For CSS-direct-child cases (grid/flex), use <div style="display:contents">.
```

**Implementation**: `src/compiler/plugins/thane-linter/rules/single-root-repeat-item.ts`

The rule mirrors the existing compile-time check in `repeat-analysis.ts` line 88
(`parsed.roots.length !== 1`) but catches it earlier at lint time with a clear
actionable message. The codegen guard stays as defense-in-depth.

---

## 5. Directive Interactions

This is the critical section. Child components may appear inside `when()`,
`whenElse()`, or `repeat()` directives. Each has different lifecycle semantics.

### 5.1 Child Component Inside `when()`

```typescript
template: html`
  ${when(showChild())}
  <div>
    <child-component></child-component>
  </div>
`
```

**Current behavior with `when()`**: The `bindConditional` function in `dom-binding.ts`
(lines 81-156) does the following:

- When the condition becomes **true**: Replaces a `<template>` placeholder with the
  real HTML content, then calls `initNested()` to set up bindings
- When the condition becomes **false**: Replaces the real element with a
  `<template id="condId">` placeholder — but **does NOT destroy** the bindings
  (only hides)
- **Bindings are initialized only once** (the `bindingsInitialized` flag, line 109)
- On re-show, the same pre-built `contentEl` is reinserted with its existing
  bindings intact

**Critical observation**: Because `initNested()` is called only once and the same
DOM subtree is reused, child component mount calls in `initNested` will also only
run once. When the condition flips back to true, the child component's DOM element
is reinserted with all its signal bindings still active. **This is correct behavior**
— the child's signals are still subscribed and will reflect current values when the
element is re-shown.

**What we need**: The child mount call must be part of the `initNested` callback for
the conditional. Currently, the codegen for conditionals generates `initNested` as
a function that sets up bindings for elements inside the conditional block.

**Where the mount call goes**: In `codegen.ts`, the `generateInitBindingsFunction`
(starting line 318) generates nested initializer code for each conditional. The
child mount call should be appended to the end of this nested initializer, like
other bindings.

**Implementation**: When a child component anchor (`<template id="bN">`) appears
inside a `when()` block, the mount call must go inside the conditional's `initNested`.
The approach:

1. During CTFE, tag each child mount with positional info (`templatePosition`) as
  the span start offset of the `${Component(...)}` interpolation in the template
  literal.
2. In template-processing, each conditional/repeat block already carries a start
  and end offset in the template string; expose those ranges for matching.
3. The reactive binding compiler matches child mounts to the *innermost* block
  that contains the position (supports nested conditional/repeat).
4. Mount calls inside conditionals go into the nested initializer; mount calls
  outside go into the top-level `__b` function.

**Why top-level won't work**: When the conditional starts as false, the child's
anchor doesn't exist in the DOM yet. It's only created from the template string
when the condition becomes true. The mount call MUST be inside `initNested`.

**Correct approach**: Mount calls for children inside conditionals MUST be inside
the `initNested` function. The position-based matching is necessary.

### 5.2 Child Component Inside `whenElse()`

Same as `when()` — the `__bindIfExpr` runtime manages two alternate subtrees.
Each subtree has its own `initNested`. Child mounts in the "then" branch go into
the then-initNested; child mounts in the "else" branch go into the else-initNested.

### 5.3 Child Component Inside `repeat()`

```typescript
template: html`
  ${repeat(items(), (item, index) => html`
    <div>
      <child-component></child-component>
    </div>
  `)}
`
```

**Current repeat behavior**: The reconciler in `dom-binding.ts` manages a list of
`ManagedItem<T>` objects. For each item:

1. A `createItem` factory is called (either string-based or template-clone-based)
2. The item HTML is created, inserted into the DOM
3. `initItemBindings` is called with the element(s), item signal, and index
4. Cleanups are stored in `managed.cleanups`

When items are removed, their cleanups are called. When items are added, new
create+init cycles run. When items are reordered (keyed), the existing elements
and their bindings move with them.

**For child components in repeat**: The child mount call should be part of
`initItemBindings`. Each repeat item creates a new child component instance with
the item's data as props.

**The key challenge**: In the optimized repeat path (codegen.ts lines 627-742),
the `createItem` function is fully inlined with direct DOM manipulation. There's
no `initItemBindings` callback — everything is in the inlined factory. The child
mount would need to be added to this inlined factory.

In the fallback repeat path (codegen.ts lines 760-900), the `initItemBindings`
function is a proper callback. The child mount call goes into this callback's
return array.

**Props in repeat context**: The child's props will reference the repeat item:
```typescript
${repeat(items(), (item) => html`
  ${Child({ label: item.name, count: item.count })}
`)}
```

The compiler must rename `item` references in the props expression to match the
repeat's internal variable naming (`item` → `itemSignal()` or `v` depending on
binding context).

### 5.4 Child Component Inside Nested Conditional Inside Repeat

This is the most complex case. Example:
```typescript
${repeat(items(), (item) => html`
  <div>
    ${when(showDetails())}
    <div>
      ${Child({ data: item.details })}
    </div>
  </div>
`)}
```

The mount call must be in the conditional's `initNested` which is itself inside
the repeat's `initItemBindings`. The codegen already supports nested conditionals
inside repeats (codegen.ts lines 1005-1055), so the child mount call should be
added alongside the existing nested conditional setup code.

---

### 5.5 Unified Repeat Path (Eliminate Fallback)

**Goal**: Remove the fallback string-based repeat path (`__bindRepeat`) entirely.
Every repeat uses the optimized fully-inlined codegen path — the compiler emits
`createKeyedReconciler` directly in `__b` with inlined `createItem` that uses
`children[N]` path navigation, template cloning, and direct DOM manipulation.
One code path at compile-time, **one** runtime reconciler function, no wrapper overhead.

#### 5.5.0 Single Reconciler — `createKeyedReconciler` Handles Everything

**Insight**: Index-based reconciliation is just keyed reconciliation with
`(_, index) => index` as the key function. The compiler always emits a `keyFn`:

- **User provides `trackBy`**: compiler passes it verbatim as `keyFn`
- **No `trackBy`**: compiler auto-injects `(_, i) => i`

This makes `createReconciler` (the full dual-mode reconciler) dead code.

**Proof that `(_, i) => i` matches index-based semantics**:

| Scenario | Old index-based | Keyed with `(_, i) => i` |
|---|---|---|
| Remove middle | Update-in-place + remove last | Same keys shift down — update values, remove extra key |
| Add at end | Create at end | New key N — create at end |
| Value change | `setValue(managed, newItem)` | Key matches, `existing.value !== newItem` → `update(newItem)` |
| Replace all | Update each item in place | All keys exist (0..N-1), values differ → update each |

All operations produce identical DOM results and the same number of DOM mutations.

**Empty template handling** — inlined by compiler, not in reconciler:
```javascript
// Compiler emits these 2 lines around the reconcile call when emptyTemplate exists
rc.reconcile(items);
items.length ? _emptyEl?.remove() : _ct.insertBefore(_emptyEl ??= _T(emptyHtml), anchor);
```
The reconciler stays lean — no `emptyTemplate` parameter, no `reconcileWithEmpty`
wrapper, no `createEmptyTemplateHandler`. The compiler inlines the show/hide as
~1 minified line.

**Cleanup handling** — `createKeyedReconciler.removeItem` currently **does not**
iterate cleanups (it only calls `.el.remove()`), while the full reconciler does.
Once signal-bindings are added inside repeat items, this would leak subscriptions.
Fix: add cleanup iteration to `removeItem` and `clearAll` in
`createKeyedReconciler`, matching the pattern from the full reconciler but without
the `cleanups.length > 0` first-item check (the compiler can gate it or the loop
over an empty array is effectively free).

**Net deletion**: `createReconciler` (~370 lines), `ReconcilerConfig` interface,
`createEmptyTemplateHandler` (~40 lines), `reconcileWithEmpty` (~10 lines),
`EmptyTemplateHandler` interface, `getValue`/`setValue` helpers. Total: ~430 lines
of runtime code eliminated. Only `createKeyedReconciler` (~180 lines) remains.

**Compiler changes** (`codegen.ts`):
- Remove the `useKeyedReconciler` / `isKeyed` branching (lines 725-730). Always
  emit `createKeyedReconciler(container, anchor, createItemFn, keyFn)`.
- When `rep.trackByFn` is absent, emit `(_, i) => i` as the `keyFn` argument.
- When `rep.emptyTemplate` exists, emit inline show/hide after `reconcile()` call.
- Remove `BIND_FN.RECONCILER` from `constants.ts`.

**Import changes** (`index.ts`):
- Remove the `createReconciler` conditional import. Always import
  `createKeyedReconciler` when any repeat block exists.
- The dual `KEYED_RECONCILER` / `RECONCILER` branching (lines 425-438) collapses
  to a single `KEYED_RECONCILER` import.

**Key architectural fact**: The optimized path does NOT use `__bindRepeatTpl`. The
compiler fully inlines everything into `__b`. The only runtime import is
`createKeyedReconciler` — one lean function that does DOM diffing.
This means:
- `__bindRepeatTpl` is dead code (never referenced by compiler) → delete it
- `__bindRepeat` is the fallback wrapper → delete it
- `createReconciler` (full dual-mode) → delete it
- `__findEl`, `__findTextNode`, `__bindNestedRepeat` are fallback-only → delete them
- The compiler's inlined codegen (`codegen.ts` lines ~625-780) is what gets extended

**Dist impact**: For apps with only simple repeats today, the dist already contains
only `createKeyedReconciler` — no `__bindRepeat`. For apps that trigger the fallback
(nested conditionals inside repeats, etc.), extending the inlined codegen will
**shrink** the dist by removing the `__bindRepeat` + `__findEl` + `__findTextNode`
imports. The compiler only emits the inlined code that the specific component needs —
if a repeat has no events, no event delegation code is emitted; if it has no empty
template, no `emptyTemplate` handling is emitted; etc.

#### 5.5.1 Current State — Why Fallback Exists

The optimized path (`generateStaticRepeatTemplate` in `repeat-analysis.ts`) is
skipped for 5 reasons (multi-root is separately banned by THANE407):

| Skip Reason | Description | Current Impact |
|---|---|---|
| `no-bindings` | Repeat item has no bindings at all | Falls to fallback (trivially simple items) |
| `signal-bindings` | Item template references component-level signals | Falls to fallback (can't inline) |
| `nested-repeat` | Repeat inside a repeat | Falls to fallback (recursive complexity) |
| `nested-conditional` | `when()`/`whenElse()` inside a repeat item | Falls to fallback (conditional lifecycle) |
| `mixed-bindings` | Same expression uses both item signal + component signal | Falls to fallback (dual dependency) |
| `multi-root` | Item template has multiple root elements | **Banned by THANE407** — lint error at compile time |

#### 5.5.2 Why Unification is Now Possible

With `data-bind-id` eliminated (THANE406 guarantees no user IDs), the optimized
path's `children[N]` path navigation works universally. The key insight:

**Path-based navigation is strictly more capable than ID-based lookup.** Every
element in a template can be found by a `children[N].children[M]...` path from the
root. The template is static at compile time, so the path is known at compile time.
No IDs needed inside item templates at all.

#### 5.5.3 Extending the Optimized Path for Each Skip Reason

**`no-bindings`**: Simplest case. The `createItem` function just clones the template
and returns the element. No `fillItem`, no `update`. Already works with template-clone.

**`signal-bindings` (component-level signals in repeat items)**:
The optimized path already has closure access to all component signals (it's inlined
in `__b`). The current skip is overly conservative. Fix: Allow signal references in
the inlined `fillItem`/`update` functions. They already close over the `__b` scope.

```javascript
// Optimized path with signal binding (currently skipped, should work):
const _T = () => _tpl.content.cloneNode(true).firstElementChild;
fillItem: (el, v) => {
  el.children[0].textContent = v.name;
  el.children[1].textContent = componentSignal();  // signal ref — valid in closure
},
update: (el, v) => {
  el.children[0].textContent = v.name;
  // componentSignal() needs to re-subscribe — use effect() or direct read
}
```

The only subtlety: component signals that change should trigger item updates. This
requires the `update` function to re-read the signal. Since `update` runs during
reconciliation (when items change), and signal changes don't trigger reconciliation,
we need a separate subscription. Solution: in `fillItem`, subscribe to the component
signal and push the cleanup into the item's cleanup array. Or: wrap the signal read
in an `effect()` scoped to the item's lifecycle.

**`nested-conditional` (when/whenElse inside repeat items)**:
The conditional anchor `<template id="bN">` inside an item template is just another
child element. In the optimized path, it can be found via `children[N]` path
navigation instead of `getElementById`. The `__bindIf` call uses this element reference:

```javascript
fillItem: (el, v) => {
  const condAnchor = el.children[2];  // path to <template id="bN"> inside item
  __bindIf(condAnchor, () => v.showDetails, (container) => {
    // init nested bindings
    container.children[0].textContent = v.details;
  });
}
```

Note: `__bindIf` currently expects to find elements by ID inside the conditional
content. With `data-bind-id` gone, it uses `getElementById` which works because the
conditional content is inserted into the live DOM (inside the component's shadow root
where `getElementById` scopes correctly).

**`nested-repeat` (repeat inside repeat)**:
Same principle — the inner repeat's anchor is found via path navigation. The inner
repeat gets its own inlined `createKeyedReconciler` call with its own template,
`createItem`, key function, and `update` closure:

```javascript
// Outer repeat's createItem (inlined in __b):
// ...
  const innerAnchor = _el.children[1];  // path to inner repeat anchor
  const innerContainer = innerAnchor.parentNode;
  const innerRc = createKeyedReconciler(
    innerContainer, innerAnchor,
    (innerItem, innerIdx, _ref) => {  // createItem
      const _ifrag = _innerTpl.content.cloneNode(true);
      const _iel = _ifrag.firstElementChild;
      // ... inner item fill ...
      innerContainer.insertBefore(_ifrag, _ref);
      return { itemSignal: null, el: _iel, cleanups: [],
        value: innerItem, update: (innerItem) => { /* ... */ } };
    },
    (_, i) => i  // keyFn — auto-injected by compiler (no trackBy)
  );
// ...
```

**`mixed-bindings` (item + component signal in same expression)**:
This is a composition of `signal-bindings` and regular item bindings. Once signal
bindings are supported (see above), mixed bindings work automatically — the `update`
function reads both `v.propName` (from item signal) and `componentSignal()` (from
closure).

**`multi-root` (multiple root elements)** — **banned by THANE407**:
Supporting multi-root would require changing `ManagedItem.el` from `Element` to
`Element[]`, adding array handling to every reconciler operation (remove, swap,
reorder, ref-node), and penalizing the 99% single-root case with extra indirection.
Instead, lint rule THANE407 (`single-root-repeat-item`) bans multi-root repeat
items at compile time. The fix is trivial for users: wrap in a container element.
If CSS requires direct children (e.g., grid/flex), the lint message suggests
`<div style="display:contents">` which is invisible to layout. See Section 4.9.

#### 5.5.4 Code Changes for Repeat Unification

**`repeat-analysis.ts`**:
- Remove 4 skip-reason checks (`no-bindings`, `signal-bindings`, `nested-repeat`,
  `nested-conditional`). `generateStaticRepeatTemplate` succeeds for all single-root
  templates. The `multi-root` check stays as a hard error (THANE407 catches it
  earlier, but the codegen keeps the guard as defense-in-depth).
- For `signal-bindings` / `mixed-bindings`: mark which bindings reference component
  signals (for cleanup tracking) but don't skip optimization.
- For `nested-conditional` / `nested-repeat`: compute paths to anchor elements and
  include in the static template info.

**`codegen.ts`** (the critical file):
- Delete the entire fallback repeat path (lines ~760-1115). Only the inlined
  optimized path remains (lines ~625-780, extended).
- Extend the inlined `createItem` to handle nested conditionals: emit `__bindIf`
  calls using path-navigated anchor references within the item template.
- Extend the inlined `createItem` to handle nested repeats: emit a nested
  `createKeyedReconciler` call with its own inlined `createItem` closure.
- Extend the inlined `fillItem`/`update` code to include component signal reads.
- The compiler already conditionally emits event delegation, empty templates, and
  key functions — this same pattern continues.

**`dom-binding.ts`** (delete dead code):
- Delete `__bindRepeat` (string-based repeat, lines 850-900).
- Delete `__bindRepeatTpl` (never used by compiler, ~lines 936-996).
- Delete `__bindNestedRepeat` (fallback nested repeat, ~lines 1006-1061).
- Delete `createReconciler` (full dual-mode reconciler, lines 439-786) — replaced
  by `createKeyedReconciler` with compiler-injected `(_, i) => i` for non-keyed.
- Delete `ReconcilerConfig` interface (lines 406-420).
- Delete `createEmptyTemplateHandler` / `reconcileWithEmpty` / `EmptyTemplateHandler`
  (lines 798-840) — empty handling inlined by compiler.
- Delete `__findEl` (lines 25-46) — no longer needed.
- Delete `__findTextNode` (lines 49-76) — no longer needed.
- Keep `createKeyedReconciler` — the sole runtime reconciler.
- Add cleanup iteration to `createKeyedReconciler.removeItem` and `.clearAll`
  (needed once signal-bindings extension adds subscriptions to repeat items).

**`index.ts`** (import generation):
- Remove `BIND_FN.REPEAT` from import logic (lines 439-456).
- Remove `BIND_FN.NESTED_REPEAT` (lines 444-452).
- Remove `BIND_FN.FIND_EL` (lines 452-456).
- Collapse dual `KEYED_RECONCILER`/`RECONCILER` branching (lines 425-438) to
  a single `KEYED_RECONCILER` import whenever any repeat block exists.
- `BIND_FN.FIND_TEXT_NODE` is currently **not used** in the import logic, so
  there is no call-site to remove.

**`constants.ts`**:
- Remove `REPEAT`, `NESTED_REPEAT`, `FIND_EL`, `FIND_TEXT_NODE`, `RECONCILER`
  from `BIND_FN`. Only `KEYED_RECONCILER` remains for repeat runtime imports.

**`runtime/index.ts`**:
- Remove exports: `__bindRepeat`, `__bindRepeatTpl`, `__bindNestedRepeat`,
  `__findEl`, `__findTextNode`, `createReconciler`.
- Keep export: `createKeyedReconciler` (sole reconciler).

#### 5.5.5 Migration Strategy

The repeat unification is Phase 3 of the implementation (Steps 12-18). Each step
independently extends the optimized path for one more skip reason, keeping the
fallback as a safety net until all are handled:

1. **Step 12**: Extend optimized path for `no-bindings`
2. **Step 13**: Extend optimized path for `signal-bindings` + `mixed-bindings`
3. **Step 14**: Extend optimized path for `nested-conditional`
4. **Step 15**: Extend optimized path for `nested-repeat`
5. **Step 16**: Collapse to single reconciler (`createKeyedReconciler` only)
6. **Step 17**: Delete fallback path — `__bindRepeat`, `__findEl`, `__findTextNode`
7. **Step 18**: End-to-end testing

Each step is independently testable. The fallback path remains as a safety net
until Step 17 deletes it.

---

## 6. Deep Nesting & Prop Drilling

### 6.1 Grandchild Components

```
Parent → Child → Grandchild
```

Each level is a separate component with its own compilation. The parent's `__b`
function mounts the child; the child's `__b` function mounts the grandchild. This
is already how it works — each component file is processed independently by the
compiler plugins.

### 6.2 Signal Prop Drilling (Zero-Cost)

When a signal is passed through multiple levels:
```typescript
// Parent
const theme = signal('dark');
// template: ${Child({ theme })}
// Compiled: Child.__f(el, { theme })

// Child
// ctx.props.theme IS the parent's signal
// template: ${Grandchild({ theme: ctx.props.theme })}
// Compiled: Grandchild.__f(el, { theme: ctx.props.theme })

// Grandchild
// ctx.props.theme IS STILL the parent's original signal
// const theme = ctx.props.theme; // same signal, zero overhead
```

The signal is passed by reference through every level. Subscribing to it in the
grandchild directly subscribes to the parent's signal. No intermediate signals,
no proxy wrapping, no extra subscriptions. This is truly zero-cost prop drilling.

### 6.3 Re-Initialization Concerns

**When a `when()` block re-shows**: The child component's DOM element is reinserted.
Since `initNested` only runs once, the child's factory (`__f`) only runs once. The
child's signals are still alive and subscribed. When the element is re-shown, the
signals still hold their current values (not the initial values). This is correct.

**When a `repeat()` item is updated**: The reconciler calls `setValue` on the item's
managed signal, which triggers all subscriptions. If the child component received
`item.name` as a prop, and we passed `itemSignal` or derived the value from
`itemSignal`, the child would need to re-read the current value.

**Important**: For repeat items, the props passed to the child are evaluated at
creation time. If the item is updated (reordered, value changed), the update is
applied via the item signal. The child receives the item signal or a derived value
— if it's a signal, updates flow automatically; if it's a static snapshot, it won't
update.

**Recommendation**: For repeat items, always pass the item signal itself (or a
derived signal) so the child can subscribe to updates:
```typescript
${repeat(items(), (item) => html`
  ${Child({ item })}  // Pass the whole item signal
`)}
```

In the child, subscribe to the item signal to react to changes:
```typescript
const item = ctx.props.item;  // This is a Signal
item.subscribe((val) => { /* react to changes */ });
```

---

## 7. Implementation Order

### Phase 1: Signal Props Core (Steps 1-8) — ✅ COMPLETE

> All steps below are implemented and verified. See the STATUS section at the top
> of this document for the exact changes made to each file. The descriptions below
> are the original design specs — they remain accurate as documentation of what was
> built.

#### Step 1: Add `no-element-id` linter rule (THANE406) — ✅ DONE
- Created `src/compiler/plugins/thane-linter/rules/no-element-id.ts`
- Registered in `rules/index.ts`
- Added `NO_ELEMENT_ID = 'THANE406'` to `errors.ts`
- Detects `id="..."` on any element in template HTML

#### Step 2: Modify `generateComponentHTML` (ast-utils.ts) — ✅ DONE
- Accepts `anchorId` parameter (pre-allocated by CTFE)
- Emits `<template id="bN"></template>` directly (no attribute serialization)
- Old prop-serialization code removed

#### Step 3: Modify `findComponentCallsCTFE` (component-precompiler.ts) — ✅ DONE
- Always captures component calls (even with dynamic props)
- Stores raw `propsExpression` text via `getText()`
- Doesn't skip on `EVAL_FAILED`
- Zero-args defaults to `'{}'`

#### Step 4: CTFE counter + direct anchor emission (component-precompiler.ts) — ✅ DONE
- Allocates `b0`, `b1`, … from CTFE counter (`childIdCounter`)
- Replaces `${Component({...})}` with `<template id="bN"></template>`
- Stores `ChildMountInfo` with pre-allocated `anchorId`
- Passes `childMountCount` as offset to binding compiler

#### Step 5: Stop converting imports to side-effects (component-precompiler.ts) — ✅ DONE
- `transformComponentImportsToSideEffects` call removed
- `findComponentImports`, `transformComponentImportsToSideEffects`, and
  `ComponentImportInfo` all deleted (tombstone comment at ~line 30)
- Named imports survive for `__b` function references

#### Step 6: Accept `childMounts` + `childMountCount` in binding compiler (index.ts) — ✅ DONE
- Added parameters to `transformDefineComponentSource`
- `idCounter` initialized at `childMountCount ?? 0` (not 0)
- Mount codegen appends `createElement` + `_gid('bN').replaceWith` + `__f` to `processedBindings`
- `hasAnyBindings` check includes child mounts

#### Step 7: Handle directive positioning (NEW LOGIC) — ⏸️ DEFERRED
- **Not implemented yet** — no benchmark child mounts inside conditionals/repeats
- A `TODO (Step 7)` comment is in `index.ts` around line 507
- When needed: determine if each child mount falls inside a conditional or repeat block,
  route mount calls to the correct nested initializer
- Use template-span offsets for `templatePosition`, match against conditional/repeat
  block ranges (select innermost containing block for nested directives)
- **Risk**: High — requires position-based matching
- **Test**: Test with child inside `when()`, `whenElse()`, `repeat()`

#### Step 8: Remove `__mountChildren` from runtime (component.ts) — ✅ DONE
- Function body deleted
- All three call sites removed
- `componentFactories` map intentionally retained (Phase 2 Step 11 cleanup)

### Phase 2: Cleanup (Steps 9-11) — 🔲 NOT STARTED

> **Prerequisite**: Phase 1 is complete. Phase 2 can start immediately.
> **Deferred item**: Step 7 (directive positioning) should be implemented before
> apps with child components inside `when()`/`whenElse()`/`repeat()` will work.
> It is not needed for the current benchmark app.

#### Step 9: Remove `data-bind-id` system
- Remove from template-utils.ts, template-processing.ts, types.ts, codegen.ts,
  repeat-analysis.ts, dom-binding.ts, index.ts (see Section 4.8 for details)
- **Risk**: Medium — touches many files, but THANE406 guarantees no user IDs
- **Test**: Build all existing test cases, verify no `data-bind-id` in output

#### Step 10: Handle repeat-context variable renaming
- When a child mount is inside a `repeat()`, rename item references in the
  props expression to match the internal variable naming
- Perform an AST-based rewrite of `propsExpression` using the repeat block’s
  item/index identifiers (e.g., `item` → `v`, `index` → `i` or `itemSignal()`
  depending on how the inlined repeat path represents item values)
- **Risk**: Medium — must handle all variable patterns
- **Test**: Test with child inside repeat receiving item data as props

#### Step 11: Delete dead runtime code
- Delete `mountComponent`, `_mountBySelector`, `destroyComponent`,
  `mountedInstances`, `componentFactories`, `createComponentHTMLSelector`
  from `component.ts`. Remove their exports from `runtime/index.ts`.
- Remove `componentFactories.set(selector, factory)` from `__registerComponent`
  and from `defineComponent` (dev-time path).
- Remove `__componentSelector` from `__registerComponent` ref object.
- Simplify `createHostElement` — remove wrapper-div branch (target always present).
- Delete `CLASS_ACCESS` from `types.ts`. Remove `classStyle` from `AccessPattern`.
- Delete all `ap.classStyle` branches in `codegen.ts` (8 occurrences total; 3 are
  in the fallback repeat path and will be removed when that path is deleted).
- Remove the exports in `runtime/index.ts` for deleted runtime functions
  (`mountComponent`, `destroyComponent`, `_mountBySelector`, `__bindRepeat`,
  `__bindRepeatTpl`, `__bindNestedRepeat`, `__findEl`, `__findTextNode`,
  `createReconciler`).
- **Risk**: Low — all paths verified as dead (no consumers after step 8)
- **Test**: Build benchmark, verify dist is smaller, verify `mount()` still works

### Phase 3: Repeat Unification (Steps 12-18) — 🔲 NOT STARTED

> **Prerequisite**: Phase 2 must be complete (specifically Step 9 — `data-bind-id` removal).

See Section 5.5.5 for the detailed migration strategy. Each step independently
extends the optimized repeat path for one more skip reason, keeping the fallback
as a safety net until all are handled:

#### Step 12: Extend optimized path for `no-bindings`
#### Step 13: Extend optimized path for `signal-bindings` + `mixed-bindings`
#### Step 14: Extend optimized path for `nested-conditional`
#### Step 15: Extend optimized path for `nested-repeat`
#### Step 16: Collapse to single reconciler
- Delete `createReconciler`, `ReconcilerConfig`, `createEmptyTemplateHandler`,
  `reconcileWithEmpty`, `EmptyTemplateHandler` from `dom-binding.ts`.
- Add cleanup iteration to `createKeyedReconciler.removeItem` and `.clearAll`.
- Update codegen: always emit `createKeyedReconciler`, inject `(_, i) => i`
  when no `trackBy`, inline empty template show/hide.
- Remove `RECONCILER` from `constants.ts` and import logic in `index.ts`.
#### Step 17: Delete fallback path — `__bindRepeat`, `__findEl`, `__findTextNode`

#### Step 18: End-to-end testing
- Benchmark app with static props
- Benchmark app with signal props
- Child inside `when()` — toggle visibility
- Child inside `repeat()` — add/remove/reorder
- Nested: child inside conditional inside repeat
- Deep nesting: parent → child → grandchild
- Multiple instances of same child in one template
- Verify no `data-bind-id` anywhere in compiled output
- Verify linter catches user IDs in templates

---

## 8. Testing & Validation

### 8.1 Benchmark Test Cases

**Test 1: Static props**
```typescript
// landing.ts
export const AppComponent = defineComponent(() => {
  return {
    template: html`
      <div>
        ${MyElementComponent({ color: 'red' })}
      </div>
    `,
  };
});
```
Expected: `<template id="b0"></template>` anchor in HTML (or `bN` where N depends on
other bindings), `document.createElement('my-element-component')` + `_gid('b0').replaceWith(_cm0)` + `__f` call in `__b`.

**Test 2: Signal props**
```typescript
export const AppComponent = defineComponent(() => {
  const dynamicColor = signal('blue');
  return {
    template: html`
      <div>
        ${MyElementComponent({ color: dynamicColor })}
        <button @click=${() => dynamicColor('green')}>Change Color</button>
      </div>
    `,
  };
});
```
Expected: Child receives live signal, clicking button updates child's color.

**Test 3: Child inside when()**
```typescript
export const AppComponent = defineComponent(() => {
  const showChild = signal(true);
  return {
    template: html`
      <div>
        <button @click=${() => showChild(!showChild())}>Toggle</button>
        ${when(showChild())}
        <div>
          ${MyElementComponent({ color: 'red' })}
        </div>
      </div>
    `,
  };
});
```
Expected: Toggling hides/shows child, child retains its state on re-show.

**Test 4: Child inside repeat()**
```typescript
export const AppComponent = defineComponent(() => {
  const items = signal([
    { id: 1, color: 'red' },
    { id: 2, color: 'blue' },
  ]);
  return {
    template: html`
      ${repeat(items(), (item) => html`
        <div>
          ${MyElementComponent({ color: item.color })}
        </div>
      `)}
    `,
  };
});
```
Expected: One child per item, each with correct color.

### 8.2 Validation Steps

1. `cd thane && npm run build` — TypeScript compiles
2. `npm pack` — creates tarball
3. `cd benchmark && npm install` — install updated thane
4. `npm run build` — esbuild compiles benchmark app
5. Check console output for `[component-ctfe] Found N component(s)`
6. Inspect compiled JS output:
   - Mount calls use `_gid('b0')` (CTFE-allocated IDs)
   - Binding IDs start at offset (e.g. `b2` if 2 child mounts)
   - No `__mountChildren` anywhere
   - No `data-bind-id` anywhere
   - Named component imports preserved (not stripped to side-effects)
7. Open `index.html` — verify child renders with correct props
8. (If signal props test) Verify reactivity works
9. Run linter — verify THANE406 catches `id="..."` on user elements

---

## 9. Appendix: Code Locations Reference

> **NOTE**: Line numbers below are from the original plan and may have shifted after
> Phase 1 edits. Use `grep_search` or `semantic_search` to find current locations.
> Status markers reflect post-Phase-1 state.

### Compiler Files (src/compiler/)

| File | Key Functions | Lines (approx) | Role | Status |
|------|--------------|-------|------|--------|
| `utils/ast-utils.ts` | `generateComponentHTML` | ~565 | Emits `<template id="bN">` anchor | ✅ Rewritten |
| `utils/constants.ts` | `BIND_FN` | 26-42 | Runtime function name constants | Phase 2/3 target |
| `plugins/component-precompiler/component-precompiler.ts` | `findComponentCallsCTFE` | ~283 | Finds `${Component({props})}` calls | ✅ Modified |
| ↳ | `evaluateExpressionCTFE` | ~155 | Evaluates props at compile time | Unchanged |
| ↳ | `findComponentImports` | — | **DELETED** in Phase 1 Step 5 | ✅ Deleted |
| ↳ | `transformComponentImportsToSideEffects` | — | **DELETED** in Phase 1 Step 5 | ✅ Deleted |
| ↳ | `buildTransformedResult` | ~369 | Applies reactive transform + strip tags | ✅ Modified (new params) |
| ↳ | `onLoad` handler | ~386 | Main plugin entry — CTFE + transform | ✅ Modified |
| `plugins/reactive-binding-compiler/index.ts` | `transformDefineComponentSource` | ~260 | Main component transform pipeline | ✅ Modified |
| ↳ | mount codegen block | ~504-518 | Child mount `createElement`+`replaceWith`+`__f` | ✅ NEW |
| ↳ | import replacement | ~395-465 | `defineComponent` → `__registerComponent` | Unchanged |
| `plugins/reactive-binding-compiler/codegen.ts` | `generateInitBindingsFunction` | 318-1140 | Generates all binding code | Phase 2/3 target |
| ↳ | conditional codegen | ~385-532 | `__bindIf` / `__bindIfExpr` calls | Unchanged |
| ↳ | repeat codegen (optimized) | ~597-790 | Fully-inlined path — will be sole path | Phase 3 target |
| ↳ | repeat codegen (fallback) | ~793-1120 | **TO BE DELETED** — string/`__bindRepeat` path | Phase 3 Step 17 |
| ↳ | `ap.classStyle` branches | 76, 211, 333, 609, 642, 816, 927, 1073 | **TO BE DELETED** — dead `CLASS_ACCESS` code | Phase 2 Step 11 |
| `plugins/reactive-binding-compiler/types.ts` | `CLASS_ACCESS` | 34-43 | **TO BE DELETED** — vestigial class-based pattern | Phase 2 Step 11 |
| `plugins/reactive-binding-compiler/template-processing.ts` | `processHtmlTemplateWithConditionals` | 258-400 | Main template analysis | Phase 2 Step 9 |
| `plugins/reactive-binding-compiler/template-utils.ts` | `buildElementIdEdits` | 395-425 | **SIMPLIFY** — remove `data-bind-id` branch | Phase 2 Step 9 |
| `plugins/reactive-binding-compiler/repeat-analysis.ts` | `generateStaticRepeatTemplate` | 76-230 | **EXTEND** — remove skip reasons | Phase 3 |
| `plugins/thane-linter/rules/no-element-id.ts` | `noElementIdRule` | NEW | THANE406 bans user IDs | ✅ Created |
| `plugins/thane-linter/rules/index.ts` | `allRules` | — | Rule registry | ✅ Updated |
| `errors.ts` | `ErrorCode.NO_ELEMENT_ID` | — | THANE406 error code | ✅ Added |

### Runtime Files (src/runtime/)

| File | Key Functions | Lines (approx) | Role | Status |
|------|--------------|-------|------|--------|
| `component.ts` | `__mountChildren` | — | **DELETED** in Phase 1 Step 8 | ✅ Deleted |
| ↳ | `componentFactories` | ~142 | **TO BE DELETED** — zero consumers after Phase 2 Step 11 | Retained (Step 11) |
| ↳ | `mountComponent` | ~445 | **TO BE DELETED** — only `mount()` is public | Phase 2 Step 11 |
| ↳ | `_mountBySelector` | ~490 | **TO BE DELETED** — only consumer was `mountComponent` | Phase 2 Step 11 |
| ↳ | `destroyComponent` | ~519 | **TO BE DELETED** — depends on `mountedInstances` | Phase 2 Step 11 |
| ↳ | `mountedInstances` | ~152 | **TO BE DELETED** — lazy WeakMap, only from `_mountBySelector` | Phase 2 Step 11 |
| ↳ | `createComponentHTMLSelector` | ~512 | **TO BE DELETED** — only used by `defineComponent` (dev-time) | Phase 2 Step 11 |
| ↳ | `defineComponent` | ~218 | Dev-time-only — tree-shaken in compiled output | Unchanged |
| ↳ | `__registerComponent` | ~317 | Compiler-optimized factory (full) — remove `componentFactories.set` | Phase 2 Step 11 |
| ↳ | `__registerComponentLean` | ~380 | Compiler-optimized factory (lean) | Unchanged |
| ↳ | `createHostElement` | ~171 | **SIMPLIFY** — remove wrapper-div branch | Phase 2 Step 11 |
| ↳ | `mount()` | ~440 | Entry-point mount (reads `__f`) — sole public mount API | Unchanged |
| `dom-binding.ts` | `bindConditional` | 81-156 | Internal when/whenElse runtime | Unchanged |
| ↳ | `__bindIf` | 158-167 | Simple conditional binding | Unchanged |
| ↳ | `__bindIfExpr` | 169-176 | Expression conditional binding | Unchanged |
| ↳ | `createKeyedReconciler` | 215-396 | **SOLE RECONCILER** — add cleanup iteration | Phase 3 Step 16 |
| ↳ | `createReconciler` | 439-786 | **TO BE DELETED** — replaced by `createKeyedReconciler` | Phase 3 Step 16 |
| ↳ | `createEmptyTemplateHandler` | ~798-826 | **TO BE DELETED** — inlined by compiler | Phase 3 Step 16 |
| ↳ | `reconcileWithEmpty` | ~830-842 | **TO BE DELETED** — inlined by compiler | Phase 3 Step 16 |
| ↳ | `__bindRepeat` | 844-901 | **TO BE DELETED** — string-based repeat | Phase 3 Step 17 |
| ↳ | `__bindRepeatTpl` | ~936-996 | **TO BE DELETED** — never used by compiler codegen | Phase 3 Step 17 |
| ↳ | `__bindNestedRepeat` | ~1006-1061 | **TO BE DELETED** — fallback nested repeat | Phase 3 Step 17 |
| ↳ | `__findEl` | 25-46 | **TO BE DELETED** — dual-lookup (id + data-bind-id) | Phase 2 Step 9 |
| ↳ | `__findTextNode` | 49-76 | **TO BE DELETED** — comment marker walker | Phase 3 Step 17 |
| `signal.ts` | `signal` | 45-80 | Signal factory (reactive primitive) | Unchanged |
| `types.ts` | `Signal<T>` | 10-17 | Signal type definition | Unchanged |
| ↳ | `ComponentRoot` | 22-25 | Root element type | Unchanged |

### Key Type Definitions

```typescript
// Signal (types.ts)
type Signal<T> = {
  (): T;                    // Get
  (newValue: T): T;         // Set
  subscribe: (cb: (v: T) => void, skipInitial?: boolean) => () => void;
};

// ComponentContext (component.ts)
interface ComponentContext<P = {}> {
  root: ComponentRoot;
  props: Readonly<P>;
}

// New type to add:
interface ChildMountInfo {
  componentName: string;    // "MyElementComponent"
  selector: string;         // "my-element-component"
  propsExpression: string;  // "{ color: myColor }"
  anchorId: string;         // Pre-allocated by CTFE: "b0", "b1", etc.
  templatePosition: number; // Position in template HTML for directive matching
}
```

---

## Summary of Key Decisions

1. **Props are never serialized to HTML attributes** — the `<child-component>` tag
   is never emitted; a `<template id="bN">` anchor is emitted instead
2. **Named imports are kept** — the `__b` function needs to reference `Child.__f`
3. **Mount calls are in `__b`** — inside the parent's binding initializer, which
   has access to the closure scope (signals, imports)
4. **Position-based matching** routes mount calls to correct initializers
   (top-level `__b`, conditional `initNested`, or repeat `initItemBindings`)
5. **`__mountChildren` is deleted** — no more runtime DOM scanning
6. **Signal props are pass-by-reference** — zero-cost prop drilling across any
   number of levels
7. **Single-phase direct emission** — CTFE owns the start of the `bN` counter,
   emits `<template id="b0">` directly. No markers, no deferred replacement.
   The binding compiler starts its `idCounter` at `childMountCount` offset.
   `document.createElement` + `replaceWith` gives a direct element reference
   with no DOM queries. Multi-instance naturally handled by monotonic counter.
8. **`no-element-id` linter rule (THANE406)** — bans user `id="..."` in templates.
   This eliminates the entire `data-bind-id` fallback system. The compiler always
   owns the `id` attribute. `getElementById` is always correct. No dual-lookup,
   no `__findEl`, no `querySelector` with attribute selectors.
9. **Unified repeat path + single reconciler** — collapse `createReconciler` (full
   dual-mode, ~370 lines) and `createKeyedReconciler` (~180 lines) into just
   `createKeyedReconciler`. The compiler auto-injects `(_, i) => i` as the key
   function when the user doesn't provide `trackBy` — index-based reconciliation
   is just keyed reconciliation with positional keys. Empty template show/hide
   is inlined by the compiler (~1 line) instead of living in the reconciler.
   Multi-root is banned by THANE407. Delete all fallback code: `__bindRepeat`,
   `__bindRepeatTpl`, `createReconciler`, `ReconcilerConfig`, `__findEl`,
   `__findTextNode`, `__bindNestedRepeat`, `createEmptyTemplateHandler`,
   `reconcileWithEmpty`. Net: ~430 lines of runtime deleted. The compiler emits
   only the minimal inlined code each component needs.
10. **Dist must not grow** — every change must keep the benchmark dist at or below
    its current size (2,859 bytes). Removing `__mountChildren`, `componentFactories`
    iteration, and the fallback repeat path actively shrinks it. The compiler's
    conditional import system ensures unused runtime functions are tree-shaken.
11. **`single-root-repeat-item` lint rule (THANE407)** — bans multiple root elements
    in repeat item templates. The reconciler's `ManagedItem.el` stays a single
    `Element` — no arrays, no sub-indexing, no performance tax on the hot path.
    Users wrap in a container; for CSS-direct-child cases, suggest
    `<div style="display:contents">`.12. **Delete `mountComponent` / `_mountBySelector` / `destroyComponent`** — only
    `mount()` is the public API. `mount()` reads `__f` directly from the component
    ref and never touches `componentFactories`. With `__mountChildren` also deleted
    (decision 5), `componentFactories` has zero consumers → delete the Map entirely.
    `destroyComponent` depends on `mountedInstances` WeakMap which only tracked
    instances from `_mountBySelector` → delete both. `createComponentHTMLSelector`
    is only used by `defineComponent` (which is dev-time-only, see decision 14)
    → delete. This eliminates: `mountComponent` (~15 lines), `_mountBySelector`
    (~15 lines), `destroyComponent` (~10 lines), `mountedInstances` lazy WeakMap,
    `componentFactories` Map, `createComponentHTMLSelector` (~15 lines),
    `__componentSelector` property on refs. Also remove their exports from
    `runtime/index.ts`.
13. **Delete `CLASS_ACCESS` + all `classStyle` branches** — `CLASS_ACCESS` is
  vestigial from the v0.0.8 class-based component system. `CLOSURE_ACCESS` is
  the only access pattern ever used (all components go through
  `transformDefineComponentSource` which passes `CLOSURE_ACCESS`). `CLASS_ACCESS`
  is only referenced as a default parameter value. Delete: `CLASS_ACCESS`
  constant, `classStyle` property from `AccessPattern` interface, all 8
  `ap.classStyle` branches in codegen (lines 76, 211, 333, 609, 642, 816, 927,
  1073), `isThisMethodReference` import/usage, `callContext` property. Inline
  `CLOSURE_ACCESS` values directly. ~30 lines of dead compiler code eliminated.
14. **`defineComponent` is dev-time only** — at compile time, the compiler replaces
    every `defineComponent(...)` call with `__registerComponent(...)` or
    `__registerComponentLean(...)`. The runtime `defineComponent` function (with
    its 3 overloads, type branching, `createComponentHTMLSelector` HTML generation,
    error throw, `componentFactories.set`) only exists for the developer experience
    — TypeScript autocomplete, type checking, etc. In compiled output, it is never
    called and esbuild tree-shakes it. No runtime code change needed — just confirm
    it's dead in the dist and document that it's a dev-time-only export.
    After `mountComponent` deletion (decision 12), `defineComponent` no longer
    needs to call `componentFactories.set` either — but since it's tree-shaken
    in compiled output, this is a no-op cleanup.
15. **`createHostElement` wrapper-div branch** — the `else` branch in
    `createHostElement` (creates a wrapper `<div>` with `querySelector`-based
    `getElementById`) is only hit when a child component is mounted without a
    pre-existing target element. With Signal Props (decision 1), child components
    always receive a target via `document.createElement` + `__f(target, props)`.
    The wrapper-div branch becomes dead code. Simplify `createHostElement` to
    always expect a `target` parameter. For `mount()` (the entry point), the
    target is `document.body` or the user-provided element — always present.