# Thane Lint Rules Reference

> Complete reference for all Thane compiler lint rules.
> Rules enforce patterns the TypeScript type system **cannot** catch — silent failures,
> compiler assumptions, and binding-detection edge cases.
>
> Rules are run both at build time (via the `thane-linter` compiler plugin) and in real-time
> inside VS Code (via the `tagged-templates` extension with the linter enabled).
>
> Rules can be suppressed per-file with `// thane-disable THANE4XX`.

---

## Quick Reference

| Code | Name | Severity | Category |
|------|------|----------|----------|
| THANE400 | [no-default-export-component](#thane400--no-default-export-component) | error | Component |
| THANE401 | [component-property-order](#thane401--component-property-order) | error | Component |
| THANE402 | [lifecycle-arrow-function](#thane402--lifecycle-arrow-function) | error | Component |
| THANE403 | [require-const-tagged-templates](#thane403--require-const-tagged-templates) | error | Template |
| THANE404 | [no-nested-html-tags](#thane404--no-nested-html-tags) | error | Template |
| THANE405 | [no-conditional-template-init](#thane405--no-conditional-template-init) | warning | Template |
| THANE406 | [no-element-id](#thane406--no-element-id) | warning | HTML |
| THANE407 | [single-component-per-file](#thane407--single-component-per-file) | error | Component |
| THANE408 | [component-const-declaration](#thane408--component-const-declaration) | error | Component |
| THANE409 | [no-aliased-component-export](#thane409--no-aliased-component-export) | error | Component |
| THANE410 | [no-cross-file-html-template](#thane410--no-cross-file-html-template) | warning | Template |
| THANE411 | [duplicate-mount-target](#thane411--duplicate-mount-target) | warning | Entry Point |

**8 error rules** fail the build. **4 warning rules** emit diagnostics but allow the build to proceed.

---

## 1 · Component Structure

### THANE400 — no-default-export-component

| | |
|---|---|
| **Severity** | error |
| **Why** | The compiler auto-derives the CSS selector from the export name. A default export has no name, so the selector cannot be derived and the component silently fails to register. |

```ts
// ✅ Named export — compiler derives selector "my-counter"
export const MyCounter = defineComponent(() => {
  const count = signal(0);
  const template = html`<span>${count()}</span>`;
  return { template };
});

// ❌ THANE400 — default export, cannot derive selector
export default defineComponent(() => {
  const count = signal(0);
  const template = html`<span>${count()}</span>`;
  return { template };
});
```

---

### THANE401 — component-property-order

| | |
|---|---|
| **Severity** | error |
| **Why** | Enforces a canonical ordering in the return object: `template → styles → onMount → onDestroy`. Consistent ordering makes components scannable and prevents confusion about which lifecycle hooks are present. |

```ts
// ✅ Correct order
return {
  template,
  styles,
  onMount: () => { console.log('mounted'); },
  onDestroy: () => { console.log('destroyed'); },
};

// ❌ THANE401 — "styles" must be declared before "onMount"
return {
  template,
  onMount: () => {},
  styles,
};

// ❌ THANE401 — "template" must be declared before "styles"
return {
  styles,
  template,
};
```

---

### THANE402 — lifecycle-arrow-function

| | |
|---|---|
| **Severity** | error |
| **Why** | `onMount` and `onDestroy` must be inline arrow functions. Method shorthand (`onMount() {}`) and `function()` expressions create their own `this` context and can mask subtle bugs. Variable references prevent the compiler from verifying the callback shape. |

```ts
// ✅ Arrow function
return {
  template,
  onMount: () => {
    console.log('mounted');
  },
};

// ❌ THANE402 — method shorthand
return {
  template,
  onMount() {
    console.log('mounted');
  },
};

// ❌ THANE402 — function expression
return {
  template,
  onMount: function() {
    console.log('mounted');
  },
};

// ❌ THANE402 — non-inline value (variable reference)
const mount = () => console.log('mounted');
return {
  template,
  onMount: mount,
};
```

---

### THANE407 — single-component-per-file

| | |
|---|---|
| **Severity** | error |
| **Why** | Only one `defineComponent()` call is allowed per file. The compiler processes one component per file — additional calls are silently ignored, producing invisible bugs. |

```ts
// ✅ One component per file
export const MyCounter = defineComponent(() => { ... });

// ❌ THANE407 — two components in one file
export const Foo = defineComponent(() => { ... });
export const Bar = defineComponent(() => { ... }); // second call flagged
```

---

### THANE408 — component-const-declaration

| | |
|---|---|
| **Severity** | error |
| **Why** | `defineComponent()` declarations must use `const`. Reassigning a component variable with `let` or `var` breaks the compiler's static analysis and can cause selector collisions. |

```ts
// ✅ const declaration
export const MyCounter = defineComponent(() => { ... });

// ❌ THANE408 — let is reassignable
export let MyCounter = defineComponent(() => { ... });

// ❌ THANE408 — var is reassignable
export var MyCounter = defineComponent(() => { ... });
```

---

### THANE409 — no-aliased-component-export

| | |
|---|---|
| **Severity** | error |
| **Why** | Components must be exported directly at the declaration site. The compiler derives the selector from the declaration name, not the exported name. Aliased exports, re-exports, and deferred exports cause the wrong selector to be generated or no selector at all. |

```ts
// ✅ Inline export at declaration
export const MyCounter = defineComponent(() => { ... });

// ❌ THANE409 — aliased export (selector derived from "_Internal", not "MyCounter")
const _Internal = defineComponent(() => { ... });
export { _Internal as MyCounter };

// ❌ THANE409 — re-export from another file
export { MyCounter } from './counter.js';

// ❌ THANE409 — deferred export (separate from declaration)
const MyCounter = defineComponent(() => { ... });
export { MyCounter };
```

---

## 2 · Template Rules

### THANE403 — require-const-tagged-templates

| | |
|---|---|
| **Severity** | error |
| **Why** | `html` and `css` tagged templates must be declared with `const`. Templates declared with `let` or `var` can be reassigned, and the compiler cannot resolve their value at compile time. |

```ts
// ✅ const declarations
const header = html`<header>Title</header>`;
const styles = css`.card { padding: 16px; }`;

// ❌ THANE403 — let is reassignable
let header = html`<header>Title</header>`;

// ❌ THANE403 — var is reassignable
var styles = css`.card { padding: 16px; }`;
```

---

### THANE404 — no-nested-html-tags

| | |
|---|---|
| **Severity** | error |
| **Why** | The compiler processes `html` tagged templates top-down. A nested `html` inside another `html` is skipped — the inner template is not processed for bindings or subscriptions. Bindings inside the inner template will be inert. |

**Exception:** `html` inside `repeat()`, `when()`, or `whenElse()` directive arguments is allowed — the compiler extracts these as separate templates.

```ts
// ❌ THANE404 — inner html`` bindings are inert
html`<div>${html`<span>${count()}</span>`}</div>`;

// ✅ Extract to const
const inner = html`<span>${count()}</span>`;
html`<div>${inner}</div>`;

// ✅ Inside directives (allowed)
html`<div>${whenElse(show(), html`<p>Yes</p>`, html`<p>No</p>`)}</div>`;
html`<ul>${repeat(items(), (item) => html`<li>${item.name}</li>`)}</ul>`;
```

---

### THANE405 — no-conditional-template-init

| | |
|---|---|
| **Severity** | warning |
| **Why** | The compiler cannot determine which template to use at compile time when a variable is initialized with a ternary or logical expression containing tagged templates. Use `whenElse()` for conditional rendering instead. |

```ts
// ❌ THANE405 — ternary conditional
const tpl = isAdmin ? html`<div>Admin</div>` : html`<div>User</div>`;

// ❌ THANE405 — logical expression
const tpl = show && html`<div>Content</div>`;

// ✅ Use whenElse() for conditional rendering
html`${whenElse(isAdmin(), html`<div>Admin</div>`, html`<div>User</div>`)}`;
```

---

### THANE410 — no-cross-file-html-template

| | |
|---|---|
| **Severity** | warning |
| **Why** | The compiler resolves templates via the local AST. Imported `html` template variables are opaque — the compiler cannot analyze them for bindings. CSS imports are allowed since they're processed separately. |

```ts
// ❌ THANE410 — imported template fragment
import { header } from './shared-templates.js';
html`${header}<main>Content</main>`;

// ✅ Define locally
const header = html`<header>Title</header>`;
html`${header}<main>Content</main>`;

// ✅ CSS imports are fine
import styles from './card.css';
return { template, styles };
```

---

## 3 · HTML Structure

### THANE406 — no-element-id

| | |
|---|---|
| **Severity** | warning |
| **Why** | The compiler generates `id` attributes for binding targets using patterns like `b0`, `b1`, `b2`. User-authored IDs matching this pattern (`bN` where N is digits) cause binding collisions — the compiler's `getElementById` finds the user's element instead of the generated anchor. |

```ts
// ✅ Non-reserved IDs — no conflict
html`<div id="main">${count()}</div>`;
html`<button id="submit-btn" @click=${handler}>Go</button>`;

// ❌ THANE406 — matches compiler binding ID pattern
html`<div id="b0">${count()}</div>`;
html`<span id="b12">${item.name}</span>`;
```

---

## 4 · Entry Point

### THANE411 — duplicate-mount-target

| | |
|---|---|
| **Severity** | warning |
| **Why** | Mounting multiple components to the same target appends duplicate content and causes binding collisions. Each `mount()` call should target a different element. |

```ts
// ❌ THANE411 — duplicate default mount (both target document.body)
mount(App);
mount(Other);

// ❌ THANE411 — same variable target
mount(App, el);
mount(Other, el);

// ✅ Different targets
mount(App, document.getElementById('app'));
mount(Other, document.getElementById('nav'));
```

---

## Summary

| Severity | Count | Build Impact |
|----------|-------|-------------|
| error | 8 | Fails the build |
| warning | 4 | Diagnostic only, build continues |

All 12 rules are implemented and shipping in the current compiler.
