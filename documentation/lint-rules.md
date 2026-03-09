# Lint Rules

Thane includes 12 compile-time lint rules (THANE400–THANE411) that catch patterns the compiler cannot process correctly. These rules run during `thane dev` and `thane build` — errors prevent the build from completing, warnings are displayed but don't block.

## Summary

| Code | Rule | Severity |
|:-----|:-----|:---------|
| THANE400 | [no-default-export-component](#thane400--no-default-export-component) | Error |
| THANE401 | [component-property-order](#thane401--component-property-order) | Error |
| THANE402 | [lifecycle-arrow-function](#thane402--lifecycle-arrow-function) | Error |
| THANE403 | [require-const-tagged-templates](#thane403--require-const-tagged-templates) | Error |
| THANE404 | [no-nested-html-tags](#thane404--no-nested-html-tags) | Error |
| THANE405 | [no-conditional-template-init](#thane405--no-conditional-template-init) | Warning |
| THANE406 | [no-element-id](#thane406--no-element-id) | Warning |
| THANE407 | [single-component-per-file](#thane407--single-component-per-file) | Error |
| THANE408 | [component-const-declaration](#thane408--component-const-declaration) | Error |
| THANE409 | [no-aliased-component-export](#thane409--no-aliased-component-export) | Error |
| THANE410 | [no-cross-file-html-template](#thane410--no-cross-file-html-template) | Warning |
| THANE411 | [duplicate-mount-target](#thane411--duplicate-mount-target) | Warning |

---

## THANE400 — no-default-export-component

**Severity:** Error

Components must use **named exports**, not default exports. The compiler auto-derives the CSS selector from the export name.

```typescript
// ❌ BAD — default export, no name for the compiler
export default defineComponent(() => ({
  template: html`<div>Hello</div>`,
}));

// ✅ GOOD — named export, selector derived as "my-counter"
export const MyCounter = defineComponent(() => ({
  template: html`<div>Hello</div>`,
}));
```

---

## THANE401 — component-property-order

**Severity:** Error

Properties in the `defineComponent()` return object must follow canonical order: **template → styles → onMount → onDestroy**.

```typescript
// ❌ BAD — styles before template
export const A = defineComponent(() => ({
  styles: css`:host { color: red }`,
  template: html`<div/>`,
}));

// ✅ GOOD
export const A = defineComponent(() => ({
  template: html`<div/>`,
  styles: css`:host { color: red }`,
  onMount: () => {},
  onDestroy: () => {},
}));
```

---

## THANE402 — lifecycle-arrow-function

**Severity:** Error

Lifecycle hooks (`onMount`, `onDestroy`) must be **arrow functions**. Method shorthand and function expressions are rejected to ensure consistent lexical scoping.

```typescript
// ❌ BAD — method shorthand
export const A = defineComponent(() => ({
  template: html`<div/>`,
  onMount() { console.log('hi'); },
}));

// ❌ BAD — function expression
export const A = defineComponent(() => ({
  template: html`<div/>`,
  onDestroy: function() {},
}));

// ✅ GOOD — arrow functions
export const A = defineComponent(() => ({
  template: html`<div/>`,
  onMount: () => { console.log('hi'); },
  onDestroy: () => {},
}));
```

---

## THANE403 — require-const-tagged-templates

**Severity:** Error

`html` and `css` tagged templates must use `const` declarations. Using `let`/`var` makes values opaque to the compiler's template processing pipeline.

```typescript
// ❌ BAD
let header = html`<header>Title</header>`;
var styles = css`:host { color: red }`;

// ✅ GOOD
const header = html`<header>Title</header>`;
const styles = css`:host { color: red }`;
```

---

## THANE404 — no-nested-html-tags

**Severity:** Error

`html` tagged templates must not be nested directly inside other `html` tagged templates. The compiler skips inner templates, so signal bindings inside them won't be processed.

```typescript
// ❌ BAD — nested html tag
template: html`<div>${html`<span>nested</span>`}</div>`

// ✅ GOOD — extract to const variable
const span = html`<span>nested</span>`;
template: html`<div>${span}</div>`

// ✅ GOOD — inside directives (allowed exception)
template: html`<ul>${repeat(items(), (i) => html`<li>${i}</li>`)}</ul>`
```

Templates inside directive callbacks (`repeat`, `whenElse`) are allowed because the compiler processes each callback's template independently.

---

## THANE405 — no-conditional-template-init

**Severity:** Warning

Variables holding `html`/`css` templates must not use conditional or logical initializers. The compiler cannot determine which branch is taken at build time.

```typescript
// ❌ BAD — ternary
const tpl = isAdmin
  ? html`<div>Admin</div>`
  : html`<div>User</div>`;

// ❌ BAD — logical AND
const tpl = show && html`<div>Content</div>`;

// ✅ GOOD — use whenElse for conditional rendering
template: html`<div>${whenElse(isAdmin(), html`<p>Admin</p>`, html`<p>User</p>`)}</div>`
```

---

## THANE406 — no-element-id

**Severity:** Warning

User-defined element IDs must not match the compiler-reserved pattern: `b` followed by digits (`b0`, `b1`, `b12`, etc.). The compiler generates these IDs for binding anchors.

```typescript
// ❌ BAD — conflicts with compiler-generated IDs
html`<div id="b0">...</div>`
html`<div id="b12">...</div>`

// ✅ GOOD
html`<div id="main">...</div>`
html`<button id="run">...</button>`
```

---

## THANE407 — single-component-per-file

**Severity:** Error

Only one `defineComponent()` call is allowed per file. Multiple calls cause the compiler to process only one and silently skip the rest.

```typescript
// ❌ BAD — two components in one file
export const Foo = defineComponent(() => ({ template: html`<div/>` }));
export const Bar = defineComponent(() => ({ template: html`<span/>` }));

// ✅ GOOD — one component per file
export const MyCounter = defineComponent(() => ({
  template: html`<div/>`,
}));
```

---

## THANE408 — component-const-declaration

**Severity:** Error

Components must be declared with `const`. Using `let` or `var` allows reassignment, which breaks the compiler's static analysis and can cause selector collisions.

```typescript
// ❌ BAD
export let MyCounter = defineComponent(() => { ... });
export var MyCounter = defineComponent(() => { ... });

// ✅ GOOD
export const MyCounter = defineComponent(() => { ... });
```

---

## THANE409 — no-aliased-component-export

**Severity:** Error

Components must be exported directly at their declaration site. Aliased exports and re-exports prevent the compiler from deriving the selector correctly.

```typescript
// ❌ BAD — aliased export
const _Internal = defineComponent(() => { ... });
export { _Internal as MyCounter };

// ❌ BAD — re-export
export { MyCounter } from './counter.js';

// ✅ GOOD — direct named export
export const MyCounter = defineComponent(() => { ... });
```

---

## THANE410 — no-cross-file-html-template

**Severity:** Warning

`html` template variables used inside `defineComponent()` must be defined in the **same file**. The compiler resolves templates via AST analysis and cannot process imported variables.

```typescript
// ❌ BAD — imported html template
import { header } from './shared-templates.js';
export const App = defineComponent(() => ({
  template: html`${header}<main>Content</main>`,
}));

// ✅ GOOD — template defined locally
const header = html`<header>Title</header>`;
export const App = defineComponent(() => ({
  template: html`${header}<main>Content</main>`,
}));
```

> Note: CSS imports *are* allowed (`import styles from './Component.module.css'`). This rule only applies to `html` tagged templates.

---

## THANE411 — duplicate-mount-target

**Severity:** Warning

Detects multiple `mount()` calls targeting the same element or using the same default target (`document.body`). Duplicate mounts cause binding collisions.

```typescript
// ❌ BAD — two default mounts (both target document.body)
mount({ component: App });
mount({ component: Other });

// ❌ BAD — same explicit target
const el = document.getElementById('root')!;
mount({ component: App, target: el });
mount({ component: Other, target: el });

// ✅ GOOD — different targets
mount({ component: App, target: document.getElementById('app')! });
mount({ component: Nav, target: document.getElementById('nav')! });
```

← [Back to Docs](README.md)
