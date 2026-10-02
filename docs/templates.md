# Templates

Thane uses tagged template literals for HTML. At build time, the compiler transforms `html` templates into static `<template>` elements, then generates binding code that reaches the exact DOM nodes that need updating and subscribes them to their signals.

`html`, `css` and the [directives](directives/README.md) are imported from `thane`:

```typescript
import { html, css, when, repeat } from 'thane';
```

They exist only at build time: the compiler turns each use into DOM code, so none of them adds to the bundle. The compiler finds them by name, so import them under their own names ([THANE413](lint-rules.md#thane413--no-aliased-thane-import)). The examples below leave the imports out.

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

template: html`<p>Count: ${count()}</p>`;
```

The compiler places an empty comment on each side of the dynamic text. At runtime, a subscription updates only the text node between them.

### Mixed Content

Combine static text with multiple dynamic values in a single element:

```typescript
template: html`<p>Name: ${first()} ${last()}</p>`;
```

Each binding gets its own text node — updating `first` doesn't touch the `last` text node.

### Functions and Helpers

A call to a function the component declares is not a signal read: the binding follows the signals the
function reads.

```typescript
const price = signal(2);
const qty = signal(3);
const currency = signal('EUR');
const total = () => price() * qty(); // follows price and qty
const format = (n: number) => `${n} ${currency()}`; // follows its argument's signals, and currency
const label = () => 'Total'; // reads no signal: rendered once

template: html`<p>${label()}: ${total()}, ${format(price())}</p>`;
```

This covers the functions declared in the component's setup and at the top of its file, and the helpers they
call. A name the compiler does not see declared as a function, such as an imported one, is read as a signal
when it is called without arguments (an imported store signal, `${visitCount()}`, works that way).

## Attribute Bindings

Bind a dynamic value to an attribute by writing the expression as its value:

```typescript
template: html`
  <img src=${imageUrl()} alt=${description()} />
  <input value=${query()} placeholder="Search..." />
  <a class="btn ${kind()}" href="/items/${id()}">Open</a>
`;
```

Static text around an expression is kept: `class="btn ${kind()}"` writes `btn primary`. Most
attributes are written with `setAttribute`. Form and state attributes are written as DOM
properties, so their values keep their JavaScript meaning: `value`, `checked`, `selected`,
`disabled`, `open`, `hidden`, `readonly`, `required`, `multiple`, `indeterminate` and `muted`
(`checked=${false}` unchecks; `value=${name()}` moves the field's live value). A `:`-prefixed
attribute name is rejected at build time (THANE006).

### Dynamic Classes

Bind `class` using an expression:

```typescript
template: html` <button class=${isActive() ? 'btn active' : 'btn'}>Click</button> `;
```

## Style Bindings

Bind the whole inline style, or individual properties:

```typescript
template: html`
  <div style=${'color:' + textColor()}>Styled text</div>
  <div style="color: ${textColor()}; width: ${width()}px">Per property</div>
`;
```

The first form writes `style.cssText`. The second binds each declaration on its own at
component level; inside `repeat()` rows the whole style is one binding. Static text next to an
expression belongs to the value: `width: ${width()}px` writes `40px`, and
`margin: ${y()}px ${x()}px` is one binding that reads both signals.

## Ternary Expressions

Use ternary operators for conditional text:

```typescript
template: html`<span>${count() > 0 ? 'Positive' : 'Zero or negative'}</span>`;
```

A ternary of templates chooses between them: see [JavaScript Control Flow](#javascript-control-flow).

## Nullish Coalescing

Use `??` for fallback values:

```typescript
template: html`<p>${username() ?? 'Anonymous'}</p>`;
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
`;
```

This injects the pre-built HTML fragment at that position.

## Whitespace

Compiled templates keep the text you write, with whitespace tidied the same way in development and production builds:

- A run of spaces, tabs and newlines inside text becomes one space.
- Whitespace-only text between two tags is condensed, as Vue's `condense` rule does: when it holds a line break it is removed (that is the template's own formatting), and when it does not it stays as one space, so `<b>x</b> <i>y</i>` renders as "x y". Next to a list's or a directive's anchor it is always removed.
- A space next to a text binding is kept, whether the binding's neighbour is text, another binding, an element or a directive: `<b>Name:</b> ${name()}` and `${count()} <small>items</small>` render with their space. At the edges of an element it is not kept reliably: a space after the last binding (`<b>${a()} </b>`) is removed, and one before the first binding is kept in component templates but removed in `repeat()` rows. Put such a space outside the element.
- Inside `<pre>`, `<textarea>`, `<script>` and `<style>`, content is kept exactly as written.

## Escapes

Templates are JavaScript template literals, and their escapes mean what they mean in any template literal: `\${` writes a literal `${`, which is text and not a binding, and `` \` `` writes a backtick.

```typescript
template: html`<code>\${price}</code>`; // renders "${price}"
```

## Child Components in Templates

Embed child components using their function-call syntax:

```typescript
import { Navbar } from './navbar.js';

template: html`
  ${Navbar({})}
  <main>Page content</main>
`;
```

The compiler manages the child's lifecycle and binding initialization.

---

## Rules and Constraints

### Fragments

An `html` template can be a fragment of another: a `const` of the component or the module, used as `${name}`
wherever markup goes, as a `when()` branch, or as a `repeat()` empty template. An `html` template can also
be written as a whole `${…}`. The compiler inlines each fragment where it is used, so a fragment costs nothing
at run time, and it can be used any number of times:

```typescript
const spinner = html`<span class="spinner"></span>`;

export const Orders = defineComponent(() => {
  const loading = signal(true);
  const empty = html`<li>No orders</li>`;
  return {
    template: html`
      ${when(loading(), spinner, html`<p>Ready</p>`)}
      <ul>${repeat(orders(), (o) => html`<li>${o.name}</li>`, { empty })}</ul>
    `,
  };
});
```

#### JavaScript Control Flow

In content, a ternary, an `&&` or a `.map()` of templates is compiled as the directive it means:

```typescript
template: html`
  ${open() ? html`<p>Open</p>` : html`<p>Closed</p>`}
  ${open() && html`<p>Open</p>`}
  ${error() ? html`<p class="error">${error()}</p>` : null}
  ${role() === 'admin' ? AdminPanel({}) : role() === 'user' ? UserPanel({}) : html`<p>Sign in</p>`}
  <ul>${items().map((item) => html`<li>${item.name}</li>`)}</ul>
  <div>${cards().map((card) => Card({ card }))}</div>
`;
```

| Written                     | Compiled as                     |
| :-------------------------- | :------------------------------ |
| `c ? A : B`                 | `when(c, A, B)`                 |
| `c ? A : null`              | `when(c, A)`                    |
| `c ? null : B`              | `when(!(c), B)`                 |
| `c && A`                    | `when(c, A)`                    |
| `items.map((item, i) => A)` | `repeat(items, (item, i) => A)` |

A branch is a template: an `html` template, a fragment, a child component call, another such expression (a
chain of ternaries is a chain of `when()`s), or nothing: `null`, `undefined`, `false` or `''`. A `.map()` row
is an `html` template or a child component call, written as the arrow function's expression body. The compiled
code is the directive's, so a branch or a row costs the same either way; write `when()` or `repeat()` for what
only they take: the tag form of `when()`, its narrowing form, and `repeat()`'s `key` and `empty`.

A ternary whose branches are both text is a text binding, as before (`${n > 0 ? 'Positive' : 'None'}`). One
with a template on one side and text on the other is a build error (THANE404): the template would never be
compiled. An `html` template anywhere else in a `${…}`, such as an argument of your own function, is reported
too.

#### Fragments Shared Across Files

A module can export a fragment, `` export const Name = html`…` ``, for other modules' templates, which use it
wherever a fragment of their own goes. Its expressions belong to its own module: they read that module's
signals and functions, and it can mount that module's components.

```typescript
// pieces.ts
import { html, signal } from 'thane';

export const theme = signal('light');
export const Spinner = html`<span class="spinner"></span>`;
export const Badge = html`<b class=${theme()}>New</b>`;

// orders.ts
import { Spinner, Badge } from './pieces.js';

template: html`<h2>Orders ${Badge}</h2>${when(loading(), Spinner, html`<ul>…</ul>`)}`;
```

A fragment without `${…}` (`Spinner`) is written out where it is used, like a fragment of the same file. One
with expressions (`Badge`) is compiled, in its module, into a template and the code that binds a copy of it;
each use mounts a copy, bound to the fragment's own signals, and releases it with the template around it. A
fragment no template uses is left out of a production bundle.

A fragment's type is `Fragment` (`import type { Fragment } from 'thane'`), and so is a child component call:
each goes where a template goes, and has nothing to read or call.

### `const` Required for Tagged Templates

The `html` and `css` tagged templates must be assigned to `const` variables or used directly in the return statement (lint rule THANE403):

```typescript
// ❌ BAD
let tpl = html`<div>...</div>`;

// ✅ GOOD
const tpl = html`<div>...</div>`;
```

### Expression Order

Expression order in the template is preserved. The compiler generates bindings in the same order expressions appear in the source.

---

## How It Works Under the Hood

1. **Build time:** The compiler parses the `html` literal and extracts all dynamic expressions.
2. **Static template:** The template string, with the signals' initial values and an empty comment on each side of every text binding, becomes a `<template>` element in the compiled output.
3. **Binding function:** The compiler generates a `__b(ctx, elements)` function. When the component mounts, the runtime clones the static template and passes the clone's elements to it, and the function:
   - Reaches every bound node by a path computed at build time (`elements[2].firstChild.nextSibling`), without searching the DOM and without ids
   - Creates signal subscriptions for each binding (text, attribute, style, or event)
4. **Runtime:** When the component mounts, the binding function runs once. From then on, only signal subscriptions drive DOM updates — no diffing, no reconciliation.

← [Back to Docs](README.md)
