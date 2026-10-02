# Directives

Directives extend Thane's template syntax with conditional rendering and list rendering. They are imported from `thane` (`import { when, repeat } from 'thane'`) and used inside `html` templates, where the compiler transforms them into optimized DOM operations. The examples leave the imports out.

## Overview

| Directive | Purpose | Syntax |
|:----------|:--------|:-------|
| [`when()`](when.md) | Show an element while a condition is truthy | `<div ${when(condition())}>...</div>` |
| [`when()`](when.md#in-content) | Show a template, or one of two | `${when(cond(), thenHtml, elseHtml?)}` |
| [`repeat()`](repeat.md) | Render a list with keyed reconciliation | `${repeat(items(), (item) => html`…`, { key: 'id', empty: emptyHtml })}` |

## How They Work

Unlike frameworks that use a virtual DOM to diff entire trees, Thane directives operate at the DOM level:

- **`when`** keeps its content between invisible comment anchors: two around one branch, three between two branches. It inserts cloned content on show and removes it on hide; a branch may have any number of root nodes, text included. Bindings are initialized on show and disposed on hide, so only the content on screen has live bindings.
- **`repeat`** uses a keyed reconciler that tracks item identity. It adds, removes, reorders, and updates DOM nodes directly — no diffing of the full list.

## Nesting

Directives can be freely nested. Every directive's content is compiled as its own sub-template, so the same rules apply at any depth:

- `when` and `repeat` inside `repeat` rows, including lists nested in rows at any depth
- `when` and `repeat` inside `when` branches
- Event handlers and child components inside any of the above

Bindings inside hidden content are disposed and re-created each time it is shown, so content that is hidden and shown again always reflects the current signal values.

Two shapes are build errors, because a list moves each row by its one root element: a row with more than one root element, or none (THANE007), and a `when()` on a row's root element (THANE008).

## Detail Pages

- [when — Conditional Rendering](when.md)
- [repeat — List Rendering](repeat.md)

← [Back to Docs](../README.md)
