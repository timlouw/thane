# when — Conditional Rendering

`when()` shows or hides a DOM element based on a boolean condition. When the condition becomes false, the element is replaced with a `<template>` placeholder and all nested bindings are disposed. When it becomes true again, the content is re-cloned and bindings re-initialized.

## Syntax

Apply `when()` as an attribute on the element to conditionally render:

```typescript
template: html`<div ${when(isVisible())}>This content shows when isVisible is true</div>`
```

## Basic Usage

```typescript
import { defineComponent, signal } from 'thane';

export const Toggle = defineComponent(() => {
  const show = signal(true);

  return {
    template: html`
      <button @click=${() => show(!show())}>Toggle</button>
      <p ${when(show())}>Now you see me</p>
    `,
  };
});
```

When `show()` is `false`, the `<p>` element is removed from the DOM and replaced with an invisible `<template>` placeholder. When `show()` becomes `true`, the content is cloned back.

## Expressions

Use any boolean expression:

```typescript
template: html`
  <div ${when(count() > 0)}>Count is positive</div>
  <div ${when(items().length === 0)}>No items</div>
  <div ${when(!isLoading() && error() === null)}>Content loaded</div>
`
```

## How It Works

1. At **build time**, the compiler detects `${when(...)}` and assigns the element an internal ID.
2. At **runtime**, the binding code subscribes to the signals read inside the condition.
3. When the condition changes:
   - **Show:** The compiler-generated template is cloned and inserted (replacing the placeholder). Nested bindings are initialized.
   - **Hide:** The element is replaced with a `<template>` placeholder. All nested subscriptions are disposed to prevent memory leaks and stale effects.

## Lifecycle Integration

When `when()` hides a child component, that component's `onDestroy` hook fires. When shown again, it mounts as a fresh instance:

```typescript
// Child with cleanup
export const Timer = defineComponent(() => {
  const elapsed = signal(0);
  let id: number;

  return {
    template: html`<p>Elapsed: ${elapsed()}s</p>`,
    onMount: () => { id = setInterval(() => elapsed(elapsed() + 1), 1000); },
    onDestroy: () => { clearInterval(id); },
  };
});

// Parent toggles the child
export const Parent = defineComponent(() => {
  const showTimer = signal(true);

  return {
    template: html`
      <button @click=${() => showTimer(!showTimer())}>Toggle Timer</button>
      <div ${when(showTimer())}>${Timer({})}</div>
    `,
  };
});
```

Hiding the timer stops the interval. Showing it again starts a new interval from zero.

## Nesting

`when()` can be nested inside `repeat()` items, `whenElse()` branches, or other `when()` blocks:

```typescript
template: html`
  <div ${when(isLoggedIn())}>
    <p>Welcome back!</p>
    <div ${when(hasNotifications())}>
      <span>You have new notifications</span>
    </div>
  </div>
`
```

## `when` vs `whenElse`

- Use **`when()`** when you only need to show/hide a single block.
- Use **[`whenElse()`](when-else.md)** when you need to render one of two alternative blocks.

← [Back to Directives](README.md) · [Back to Docs](../README.md)
