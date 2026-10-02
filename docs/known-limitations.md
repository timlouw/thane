# Known Limitations

This page documents current constraints, browser requirements, and by-design decisions in Thane.

## Compiler Constraints

### `html` Templates Inside Others

An `html` template inside another is compiled where it is the whole `${…}`, a directive argument, a branch of a
ternary, an `&&` or a `.map()` row in content, or a child component's prop (a slot). Anywhere else, such as an argument of your own function, it would
be a plain value (THANE404). A ternary with a template on one side and text on the other is a build error too.

### Unique Selectors

A component's selector is the class of its host element, which scopes its styles. Two components of an app with one selector (two components declared under one name, each with a derived selector) share it: the styles of the one registered first apply to both. The build reports them (THANE013). Give one of them another name or an explicit selector. A child component call, `${Card({ … })}`, is resolved through the file's own declarations and imports, so two components with one name in different files are never confused for each other.


### One Return Object per Setup

A setup function returns one object (THANE412). The compiler builds one static template per component, so an early `return { template: … }` in a branch cannot work. Choose in the template instead, with `when()` or a ternary.

### Hot Updates Swap Whole Components

`thane dev` swaps a changed component file in the open page, but a swapped component starts again: its own signals
start from their initial values (its stores, and the rest of the page, keep theirs). A change to any other module
reloads the page.

### `const` Required for Components and Templates

- Components must be declared with `const` (THANE408)
- `html` and `css` tagged templates must be assigned to `const` (THANE403)
- Components must use named exports, never default exports (THANE400)

### No Conditional Template Initialization

Template variables cannot use ternary or logical operators (THANE405). Use `when()` for conditional rendering instead.

### User IDs

Your `id` attributes are kept on every element, bound or not. The compiler adds no ids of its own and never uses one to find an element. Inside `repeat()` rows an `id` is repeated on every row, so prefer `data-*` attributes there.

A comment written like one of the compiler's own markers (`<!--b0-->`) is reported as THANE009 when the compiler uses that name in the same template; change or remove it.

### One Root Element per Repeat Row

Every `repeat()` row is cloned from one element and moved, updated and removed by that element, so a row template must have exactly one root element. A row such as `(item) => html\`<dt>${item.term}</dt><dd>${item.def}</dd>\`` is reported at build time as THANE007; wrap the pair in a single element instead. A row that is only a directive (a `when()`, `when()` or nested `repeat()`) is THANE007 as well. A row that is a child component call, `(item) => Card({ item })`, has no markup of its own and is not affected.

For the same reason a row's root element cannot carry `when()` (THANE008): filter the list, or put the `when()` on an element inside the row.

Inside the row, anything a component template can hold works, at any depth: bindings, event handlers, child components, `when()`, `when()` and further lists.

### Empty Templates Are Static

The empty template of a `repeat()`, its third argument, is inserted as written, as one element: it holds no bindings or event handlers. An empty template with a `${…}`, more than one root, or text outside an element is a build error (THANE011). For an empty state that changes, put a `when()` next to the list.

### Whitespace Between Elements

Whitespace-only text between two tags that holds a line break is removed from compiled templates: two elements written on separate lines render without a space between them, where a browser would show one. Write them on one line (`<b>x</b> <i>y</i>` keeps its space), put the space inside one of the elements, or write it as `&#32;`. See [Templates](templates.md#whitespace).

## Runtime Constraints

### Light DOM Only

Thane uses Light DOM exclusively — no Shadow DOM. This means:

- Parent styles **cascade into** child components
- Standard CSS specificity rules apply across component boundaries
- Style isolation depends on auto-scoped CSS class selectors, not shadow boundaries

### CSS Nesting Required

Scoped styles depend on native CSS Nesting (the `&` selector). This sets the minimum browser versions:

| Chrome | Firefox | Safari | Edge |
| :----: | :-----: | :----: | :--: |
|  120+  |  117+   | 17.2+  | 120+ |

Older browsers will not render scoped styles correctly.

### Modern Browsers Only

Thane targets modern browsers and uses APIs without polyfills:

- `adoptedStyleSheets` for style management
- `CSSStyleSheet.replaceSync()` for style injection
- `queueMicrotask` for async error surfacing
- `HTMLTemplateElement` for template cloning
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

Cycles are detected in development builds only: when subscribers keep setting each other's signals, a development build stops the cycle with an error after 500 rounds. A production build has no check, so there a cycle that never settles ends in a stack overflow (`RangeError: Maximum call stack size exceeded`), and afterwards later writes may never be notified. See [Signals](signals.md#circular-dependencies).

### A Signal Notified Twice in One Cascade

When a cascade has several signals waiting, they are notified one after the other. A signal that one of the earlier ones sets again is notified at once, with its new value, and then once more in its own turn, with the same value. A subscriber that must run once per change can compare the value with the one it saw last.

## Missing Features

These features are **not currently supported**:

| Feature                           | Status                                                      |
| :-------------------------------- | :---------------------------------------------------------- |
| Shadow DOM                        | By design — Light DOM only                                  |
| SSR / Server-Side Rendering       | Not supported                                               |
| Context / Provide / Inject        | Not available — use module-level signals for shared state   |
| Async component setup             | Not supported — use `onMount` for async work                |
| Multiple router instances         | Not supported — single-instance only                        |
| Animated route transitions        | Not built-in                                                |

## Production Build Behavior

### `console.*` Stripping

Production builds (`thane build --prod`) strip all `console.*` calls by default. Override with `--no-drop-console` if needed.

### `debugger` Stripping

Production builds strip `debugger` statements by default. Override with `--no-drop-debugger`.

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

### Route Type Generation

Type-safe routing requires running `thane dev`, `thane build`, or `thane types` at least once to generate the `.thane/types/router/` type definitions. Until then, `route.params` is typed as `Record<string, string>` and `navigate()` accepts any string.

← [Back to Docs](README.md)
