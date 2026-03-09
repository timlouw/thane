# Known Limitations

This page documents current constraints, browser requirements, and by-design decisions in Thane.

## Compiler Constraints

### One Component Per File

Only one `defineComponent()` call is allowed per file (THANE407). The compiler processes the entire file as a single component unit — multiple calls cause silent skipping.

### No Nested `html` Tags

`html` tagged templates cannot be nested inside other `html` templates (THANE404). Inner templates must be extracted to `const` variables:

```typescript
// ❌ Not allowed
template: html`<div>${html`<span>nested</span>`}</div>`

// ✅ Allowed
const inner = html`<span>nested</span>`;
template: html`<div>${inner}</div>`
```

Templates inside directive callbacks (`repeat`, `whenElse`) are the exception — these are processed independently.

### Template Variables Must Be Local

`html` template variables used inside `defineComponent()` must be defined in the same file (THANE410). The compiler resolves templates via AST analysis and cannot process imported variables. CSS imports are unaffected.

### CTFE Sandboxing

The compiler's Compile-Time Function Evaluation (CTFE) runs component setup functions in a sandboxed context. Side-effectful code in the module scope (e.g., DOM access, network calls, global mutations) may behave differently or fail during compilation. Keep side effects inside `onMount`.

### `const` Required for Components and Templates

- Components must be declared with `const` (THANE408)
- `html` and `css` tagged templates must be assigned to `const` (THANE403)
- Components must use named exports, never default exports (THANE400)

### No Conditional Template Initialization

Template variables cannot use ternary or logical operators (THANE405). Use `whenElse()` for conditional rendering instead.

## Runtime Constraints

### Light DOM Only

Thane uses Light DOM exclusively — no Shadow DOM. This means:

- Parent styles **cascade into** child components
- Standard CSS specificity rules apply across component boundaries
- Style isolation depends on auto-scoped CSS class selectors, not shadow boundaries

### CSS Nesting Required

Scoped styles depend on native CSS Nesting (the `&` selector). This sets the minimum browser versions:

| Chrome | Firefox | Safari | Edge |
|:------:|:-------:|:------:|:----:|
| 120+   | 117+    | 17.2+  | 120+ |

Older browsers will not render scoped styles correctly.

### Modern Browsers Only

Thane targets modern browsers and uses APIs without polyfills:

- `adoptedStyleSheets` for style management
- `CSSStyleSheet.replaceSync()` for style injection
- `queueMicrotask` for async error surfacing
- `HTMLTemplateElement` for template cloning
- `TreeWalker` for binding marker discovery
- CSS Nesting for scoped styles

### No Async Component Setup

The `defineComponent()` setup function must be synchronous. It cannot be `async` and cannot `await` promises. Data fetching and other async work should go in `onMount`:

```typescript
// ❌ Not allowed
export const Page = defineComponent(async () => {
  const data = await fetch('/api/data');
  ...
});

// ✅ Correct pattern
export const Page = defineComponent(() => {
  const data = signal(null);

  return {
    template: html`<div>${data()}</div>`,
    onMount: () => {
      fetch('/api/data')
        .then(res => res.json())
        .then(d => data(d));
    },
  };
});
```

### Single Router Instance

Only one router instance is supported. Calling `mount()` with a `router` option a second time logs a warning and is ignored.

### Circular Signal Dependencies

Cascading signal updates that form a cycle are detected after 100 iterations and throw `Error: Circular signal dependency`. This protects against infinite loops but means some recursive reactive patterns are not possible.

## Missing Features

These features are **not currently supported**:

| Feature | Status |
|:--------|:-------|
| Shadow DOM | By design — Light DOM only |
| SSR / Server-Side Rendering | Not supported |
| `ref` API (direct element access) | Not available — use `ctx.root.querySelector()` in `onMount` |
| Context / Provide / Inject | Not available — use module-level signals for shared state |
| Async component setup | Not supported — use `onMount` for async work |
| Multiple router instances | Not supported — single-instance only |
| Route guards / middleware | Not built-in |
| Animated route transitions | Not built-in |

## Production Build Behavior

### `console.*` Stripping

Production builds (`thane build --prod`) strip all `console.*` calls by default. Override with `--dropConsole false` if needed.

### `debugger` Stripping

Production builds strip `debugger` statements by default. Override with `--dropDebugger false`.

### Source Maps

Source maps are **disabled** in production builds by default. Enable with `--sourcemap`.

## Dev Server Requirement

The `thane dev` command requires the **Bun** runtime. Running it with Node.js produces an error:

```
Error: Thane CLI requires the Bun runtime.
```

Install Bun from [bun.sh](https://bun.sh).

## Router Constraints

### No Root-Level Parameters

Route patterns starting with `/:param` are rejected at runtime. Every route must begin with a static segment:

```typescript
// ❌ Rejected
'/:slug': { component: ... }

// ✅ Allowed
'/pages/:slug': { component: ... }
```

### Outlet ID Pattern

When using Mode B (shell + router), the outlet element's `id` must match the pattern `` `router-${string}` ``. The default is `router-outlet`.

### Route Type Generation

Type-safe routing requires running `thane dev`, `thane build`, or `thane types` at least once to generate the `.thane/types/router/` type definitions. Until then, `route.params` is typed as `Record<string, string>` and `navigate()` accepts any string.

← [Back to Docs](README.md)
