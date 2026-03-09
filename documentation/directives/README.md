# Directives

Directives extend Thane's template syntax with conditional rendering and list rendering. They are global functions available inside `html` templates — the compiler transforms them into optimized DOM operations.

## Overview

| Directive | Purpose | Syntax |
|:----------|:--------|:-------|
| [`when()`](when.md) | Show/hide a block based on a condition | `<div ${when(condition())}>...</div>` |
| [`whenElse()`](when-else.md) | Render one of two branches | `${whenElse(cond(), thenHtml, elseHtml)}` |
| [`repeat()`](repeat.md) | Render a list with keyed reconciliation | `${repeat(items(), renderFn, emptyTpl, keyFn)}` |

## How They Work

Unlike frameworks that use a virtual DOM to diff entire trees, Thane directives operate at the DOM level:

- **`when`** replaces a `<template>` placeholder with cloned content on show, and swaps back on hide. Nested bindings are initialized on show and disposed on hide.
- **`whenElse`** maintains two anchor points and swaps between them. Only the active branch has live bindings.
- **`repeat`** uses a keyed reconciler that tracks item identity. It adds, removes, reorders, and updates DOM nodes directly — no diffing of the full list.

## Nesting

Directives can be freely nested:

- `when` inside `repeat` items
- `repeat` inside `whenElse` branches
- `whenElse` inside `repeat` items
- Multiple `when` blocks at the same level

## Detail Pages

- [when — Conditional Rendering](when.md)
- [whenElse — If/Else Rendering](when-else.md)
- [repeat — List Rendering](repeat.md)

← [Back to Docs](../README.md)
