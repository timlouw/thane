# Notes for Later

Deferred items that are worth revisiting in future iterations.

---

## Documentation

- [ ] Document the signal reference equality model — signals use strict reference equality (`!==`) to decide whether to notify subscribers. Object/array mutations in-place (e.g. `list().push(x)`) are invisible; developers must create new references (`list([...list(), x])`). This matches React/Solid/Preact conventions but will surprise developers coming from mutable-data frameworks. Add a clear section in the README or a dedicated guide.

---

## Component System

- [ ] **Lifecycle hooks (`onMount`, `onDestroy`)** — currently there's no way for components to run logic after mount or clean up on destroy. `initializeBindings()` is the closest thing to `onMount`, but there's no `onDestroy` equivalent. This blocks cleanup patterns like clearing timers, aborting fetches, and closing WebSockets. Adding these would significantly improve composability.

- [ ] **Component unmount/cleanup** — when components are removed from the DOM, there's no cleanup mechanism. The `componentFactories` Map only stores one factory per selector (not per instance), so it's not a leak in typical SPAs, but there's no way for component instances to run teardown logic. This is closely tied to the `onDestroy` hook above.

- [ ] **Harden `mountComponent` regex** — the current regex `/<([^>]+)>/` would capture attributes if the selector string ever included them (e.g. `<my-page class="foo">`). A safer regex would be `/<([a-z][a-z0-9-]*)/` to only capture the tag name. Low risk since the input is compiler-generated, but worth hardening.

---

## DOM Binding Performance

- [ ] **Cleanup arrays grow unboundedly** — each `ManagedItem` has a `cleanups` array that only grows via `push()` and is never compacted. Items are destroyed and recreated during reconciliation (not re-bound), so in practice the arrays don't grow past their initial size per item. But if the architecture ever changes to re-bind existing items, this would become a real issue. Worth revisiting if binding lifecycle changes.

- [ ] **General reorder algorithm — LIS optimization** — the current forward-pass `insertBefore` approach is O(n) DOM moves in the worst case (fully reversed list). A Longest Increasing Subsequence (LIS) algorithm would identify elements already in order and only move the rest, roughly halving DOM operations for large reorders. The existing 2-element swap fast-path covers the most common case. This would only matter for large lists (500+) with heavy reordering patterns. Consider implementing if benchmark data shows reorder-heavy workloads are a bottleneck.
