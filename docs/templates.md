# Templates

Thane uses tagged template literals for HTML. At build time, the compiler transforms `html``\`\`` into static `<template>` elements with comment markers, then generates binding code that subscribes to the exact DOM nodes that need updating.

## Basic Template

```typescript
return {
  template: html`<h1>Hello, world!</h1>`,
};
```

Static content is cloned from a pre-built `<template>` element — no runtime parsing.

## Text Bindings

Embed signal reads directly in the template. Only the specific text node updates when the signal changes:

```typescript
const count = signal(0);

template: html`<p>Count: ${count()}</p>`
```

The compiler places comment markers around the dynamic text. At runtime, a subscription updates only the text node between the markers.

### Mixed Content

Combine static text with multiple dynamic values in a single element:

```typescript
template: html`<p>Name: ${first()} ${last()}</p>`
```

Each binding gets its own text node — updating `first` doesn't touch the `last` text node.

## Attribute Bindings

Use the `:attr` prefix to bind dynamic values to HTML attributes:

```typescript
template: html`
  <img :src=${imageUrl()} :alt=${description()} />
  <input :value=${query()} :placeholder=${'Search...'} />
`
```

Attribute bindings set the attribute directly via `setAttribute` when the value changes.

### Dynamic Classes

Bind `class` using an expression:

```typescript
template: html`
  <button class=${isActive() ? 'btn active' : 'btn'}>Click</button>
`
```

## Style Bindings

Use `:style` for inline style updates:

```typescript
template: html`
  <div :style=${'color:' + textColor()}>Styled text</div>
`
```

## Ternary Expressions

Use ternary operators for conditional text:

```typescript
template: html`<span>${count() > 0 ? 'Positive' : 'Zero or negative'}</span>`
```

## Nullish Coalescing

Use `??` for fallback values:

```typescript
template: html`<p>${username() ?? 'Anonymous'}</p>`
```

## HTML Fragment Injection

Assign a template to a `const` variable, then embed it:

```typescript
const header = html`<h1>Welcome</h1>`;
const footer = html`<footer>© 2024</footer>`;

template: html`
  ${header}
  <main>Content</main>
  ${footer}
`
```

This injects the pre-built HTML fragment at that position.

## Child Components in Templates

Embed child components using their function-call syntax:

```typescript
import { Navbar } from './navbar.js';

template: html`
  ${Navbar({})}
  <main>Page content</main>
`
```

The compiler manages the child's lifecycle and binding initialization.

---

## Rules and Constraints

### No Nested `html` Tags

You cannot nest `html``\`\`` inside another `html``\`\`` (lint rule THANE404). Instead, assign inner templates to `const` variables:

```typescript
// ❌ BAD — nested html tag
template: html`
  <div>
    ${html`<span>Nested</span>`}
  </div>
`

// ✅ GOOD — const variable
const inner = html`<span>Nested</span>`;

template: html`
  <div>
    ${inner}
  </div>
`
```

### `const` Required for Tagged Templates

The `html` and `css` tagged templates must be assigned to `const` variables or used directly in the return statement (lint rule THANE403):

```typescript
// ❌ BAD
let tpl = html`<div>...</div>`;

// ✅ GOOD
const tpl = html`<div>...</div>`;
```

### Template Variables Must Be Local

Template variables must be declared in the same file — you cannot import an `html``\`\`` value from another module and use it in a template. The compiler needs to see the full template at build time.

### Expression Order

Expression order in the template is preserved. The compiler generates bindings in the same order expressions appear in the source.

---

## How It Works Under the Hood

1. **Build time:** The compiler parses the `html``\`\`` literal and extracts all dynamic expressions.
2. **Static template:** The template string (with placeholder comment markers) becomes a `<template>` element in the compiled output.
3. **Binding function:** The compiler generates a `__b(ctx)` function that:
   - Clones the static template
   - Uses `TreeWalker` to locate comment markers
   - Creates signal subscriptions for each binding (text, attribute, style, or event)
4. **Runtime:** When the component mounts, the binding function runs once. From then on, only signal subscriptions drive DOM updates — no diffing, no reconciliation.

← [Back to Docs](README.md)
