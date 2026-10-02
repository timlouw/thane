# Contracts

Compiled components call helpers in the runtime, so the compiler and the runtime of one Thane version must agree on the helpers' names, their signatures and the markup conventions of compiled templates. This page describes that contract and how it is kept.

## Structure

```
src/contracts/
  index.ts                    # Barrel re-exports
  compiler/
    kinds.ts                  # Parser states and binding kinds (compiler-internal types)
    generated-artifacts.ts    # What the code generator returns for a component's bindings
  runtime/
    internal-helpers.ts       # RUNTIME_HELPER: every helper compiled code imports; the package entry names
  syntax/
    framework-functions.ts    # FRAMEWORK_FN: html, css, signal, when, … — names the compiler and linter recognise
```

What holds the compiler and the runtime together is `RUNTIME_HELPER` and two tests:

- The compiler emits and imports every runtime helper through `RUNTIME_HELPER` (`BIND_FN` in `src/compiler/utils/constants.ts` is the same object), from `INTERNAL_RUNTIME_SPECIFIER` (`thane/runtime`).
- `src/runtime/internal-contract.test.ts` checks that `thane/runtime` exports a helper under every `RUNTIME_HELPER` name.
- A compiled file with a list imports `_cloneNode` and `_insertBefore` (Node's `cloneNode` and `insertBefore`) from `DOM_RUNTIME_SPECIFIER` (`thane/runtime/dom`), a module of its own: it reads `Node.prototype` when it loads, so only an app with a list includes it, and `thane/runtime` still loads where there is no DOM. Every such file shares the one read. A file that imports `thane` by a path of its own (a test) declares the pair itself instead.
- `src/compiler/plugins/reactive-binding-compiler/contract-conformance.test.ts` builds components and checks that the compiled output calls the helpers by those names; `helper-imports.test.ts` checks that a component imports exactly the helpers its code calls.

The runtime imports nothing from `src/contracts/`: esbuild does not inline object properties, so an import would cost bytes in every app. The runtime writes the helper names itself, and the tests keep the two sides in step.

## The compiled-output contract

Compiled components and the runtime of the same Thane version agree on these calls. Pre-compiled
components must be rebuilt with the matching version.

- `__registerComponent(selector, setup, template)` / `__registerComponentLean(selector, setup, template)`
  return `{ __f(target, props?, extras?) }`. The factory clones `template`, lists the clone's elements
  (`querySelectorAll('*')`, before the clone is inserted, because the target may hold other nodes),
  appends the clone to `target` and calls the setup result's `__b(ctx, elements)`.
- `__b(ctx, elements) → cleanup?`: the component's binding function. `elements[i]` is the template's
  i-th element in document order; compiled code reaches every node it binds by that position or by a
  path from it, never by id. Inside a `when()` / `when()` branch, the branch initializer reaches
  its nodes by path from the branch's first node, and a row factory from the row's element.
- Compiled templates carry no generated id. A text binding writes the text node that follows an empty
  comment (`<!---->`); a list's rows go before its anchor, an empty comment; a child component's host
  element is in the template where the child was written, or, where the browser's parser would not keep
  an element there (directly in a table row, inside svg), an empty comment that the compiled code
  replaces with a host it creates.
- `__bindIf(start, end, signal, template, initNested)` and
  `__bindIfExpr(start, end, signals, evalExpr, template, initNested)`: a `when()` / `when()` branch
  is everything between the comment anchors `start` and `end` (a `when()` has three anchors, its
  branches share the middle one), with any number of root nodes. Whatever is between them when the
  binding starts is the pre-rendered branch. Show inserts `template` before `end`; hide removes every
  node between the anchors, then runs the branch's cleanups. `initNested(first)` receives the branch's
  first node and returns its cleanups.
- `createKeyedReconciler(container, anchor, createRow, keyFnOrProp, batch?, trackIndex?)` →
  `{ reconcile, clearAll, get }`, where `anchor` is the list's anchor node in `container` (a comment),
  `createRow(item, index, refNode)` returns the row's record (`el`, `cleanups`, `update`, `value`), and
  `keyFnOrProp` is the key property's name, a key function, or `(_, i) => i` when the list has no key.
- `__batchRows(size, row, bind, update?)` → the `batch` argument of `createKeyedReconciler`: rows are
  cloned `size` at a time from a fragment of `row`, bound one by one with `bind(el, item, index)` and
  inserted together; `update(record, item, index)` is the one update function every row shares.
  Compiled code passes it only for lists whose rows need no cleanups, so apps without such a list do not
  bundle it.
- `__T(html) → HTMLTemplateElement`: builds a compiled template (a component's, a row's, a list's empty
  template). `__nc`: the one empty cleanups array shared by rows that have no cleanups.
- An exported fragment (`` export const Badge = html`…` ``) compiles to `{ t, b? }`: `t` its template, `b(ctx,
  elements) → cleanup` its binding function, which reaches its nodes in the copy (`ctx.root`, `elements` as for
  `__b`), calls `ctx.place()` to insert the copy, then binds. `__mf(anchor, fragment) → cleanup` mounts a copy
  before `anchor`, a comment that stays; the nodes are removed with the template around them.
- `__dc(instance) → destroy`; `__sig` = `signal`; `__enableComponentStyles()`; `__enableKeyframeScoping()` (called by a module whose stylesheet defines `@keyframes`; it enables component styles too);
  `mountComponent(component, target?, props?)`.

## Policy

Keep in `src/contracts/` only what binds the compiler to the runtime, or what both the compiler and the linter use. A constant nobody imports is deleted, not kept for later.

When a change touches compiler ↔ runtime coupling:

1. **A new helper** goes into `RUNTIME_HELPER`, is exported from `src/runtime/internal.ts` (`thane/runtime`), and is added to `internal-contract.test.ts`.
2. **The compiler emits it through `RUNTIME_HELPER`**, never as a string literal of its own, so that the import list and the conformance tests see it.
3. **A change to a helper's signature or to the markup of compiled templates** changes the compiled-output contract. Change the compiler and the runtime in the same commit, update this page, and add a "Breaking" line to the CHANGELOG: components compiled by an earlier version must be rebuilt.
4. **Run the checks** that cover the contract:
   ```bash
   bun run test
   bun run e2e:test
   bun run check:exports   # the package entries export exactly the documented names
   ```

If you add a new directive, binding kind, or internal helper:

1. Add the helper name to `RUNTIME_HELPER`, and the directive or function name to `FRAMEWORK_FN` if the compiler or linter must recognise it.
2. Update the compiler plugin that emits it.
3. Update the runtime function that handles it.
4. Add unit tests and E2E tests confirming the round-trip.

---

← [Back to Contributing](README.md)
