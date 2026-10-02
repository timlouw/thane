# Thane Developer Documentation

Thane is a **compile-time component framework** for TypeScript. Templates are compiled to optimized vanilla JavaScript at build time — static template cloning, direct DOM navigation, and fine-grained signal subscriptions — so the browser does the absolute minimum work at runtime.

**About 1 KB gzipped for a counter app** · Zero virtual DOM · TypeScript-first · Lint rules and build errors for silent failures

---

## Getting Started

Create a project with `thane init`, add components with `thane generate component`, and run the dev server.

```typescript
import { defineComponent, signal, mount, html } from 'thane';

export const Counter = defineComponent(() => {
  const count = signal(0);
  return html`<button @click=${count(count() + 1)}>Clicks: ${count()}</button>`;
});

mount(Counter);
```

**→ [Getting Started](getting-started.md)**

---

## Signals

Reactive primitives — `signal()`, `computed()`, `effect()`, `batch()`, `untrack()`, `onCleanup()`.

```typescript
const name = signal('world');
const greeting = computed(() => `Hello, ${name()}!`);
effect(() => console.log(greeting())); // logs: "Hello, world!"
name('Thane');                          // logs: "Hello, Thane!"
```

**→ [Signals](signals.md)**

---

## Components

Define components with `defineComponent()`, receive typed props, pass templates as slots, use lifecycle hooks and
`onCleanup()`, and mount to the DOM.

```typescript
export const Greeter = defineComponent<{ name: string }>('app-greeter', ({ props }) => ({
  template: html`<h1>Hello, ${props.name}!</h1>`,
  onMount: () => console.log('Mounted'),
  onDestroy: () => console.log('Destroyed'),
}));
```

**→ [Components](components.md)**

---

## Templates

Tagged template literals — `html` templates, text, attribute and style bindings, `class:` toggles, `bind:value`,
element refs, ternaries, `&&` and `.map()`, and fragments.

```typescript
template: html`
  <span style=${'color:' + color()}>
    ${label()}: ${count()}
  </span>
`
```

**→ [Templates](templates.md)**

---

## Event Handling

Bind DOM events with `@event` syntax: each handler's event is typed for its element, and modifiers handle the
usual chores.

```typescript
html`<form @submit.prevent=${save}><input @keydown.esc=${(e) => e.currentTarget.blur()} /></form>`
```

**→ [Event Handling](event-handling.md)**

---

## Directives

Conditional rendering and list rendering — `when()`, with an else branch and a narrowing form, and `repeat()`.

```typescript
template: html`
  <div ${when(isVisible())}>Shown conditionally</div>
  ${repeat(items(), (item) => html`<li>${item()}</li>`, { key: (item) => item().id, empty: html`<li>No items</li>` })}
`
```

**→ [Directives Overview](directives/README.md)** · [when](directives/when.md) · [repeat](directives/repeat.md)

---

## Routing

Type-safe client-side routing with `defineRoutes()`: a `<router-outlet>`, plain `<a href>` links, lazy pages,
typed parameters and search values, guards, heads, active links and scroll restoration.

```typescript
const Routes = defineRoutes({
  '/':          { component: () => import('./pages/home.js'), meta: { title: 'Home' } },
  '/users/:id': { component: () => import('./pages/user.js'), meta: { title: 'User' } },
  notFound:     { component: () => import('./pages/404.js'), meta: { title: '404' } },
});
```

**→ [Routing](routing.md)**

---

## Styling

Scoped CSS via CSS Nesting + `adoptedStyleSheets`, global styles, and CSS file imports.

```typescript
return {
  template: html`<div class="card">...</div>`,
  styles: css`.card { padding: 1rem; & h1 { color: blue; } }`,
};
```

**→ [Styling](styling.md)**

---

## State Management

Patterns for shared state — module-level signals, nested signals for lists, computed aggregations, localStorage persistence.

```typescript
// state/global.ts
export const count = signal(0);
export const doubled = computed(() => count() * 2);
```

**→ [State Management](state-management.md)**

---

## CLI

`thane init`, `thane generate component`, `thane dev` with hot updates, `thane build`, `thane serve`, `thane typecheck`,
`thane types` — plus configuration file support.

```bash
thane dev --port 3000 --open
thane build --prod --gzip --analyze
```

**→ [CLI Reference](cli.md)**

---

## Compiler

How the build pipeline works — esbuild plugins, template compilation, binding generation, and optimizations.

**→ [Compiler](compiler.md)**

---

## Lint Rules

The lint rules (THANE400–THANE416) and the compiler's build errors (THANE006–THANE018) that catch silent failures
before they reach the browser.

**→ [Lint Rules](lint-rules.md)**

---

## API Reference

Complete API surface — all exports from `thane` and `thane/router`, global template functions, and types. (`thane/runtime` is the compiler's own entry: never import it.)

**→ [API Reference](api-reference.md)**

---

## Known Limitations

Compiler constraints, runtime constraints, browser requirements, and features not yet supported.

**→ [Known Limitations](known-limitations.md)**

---

## Examples

### E-Commerce App

A full walkthrough of the `example-apps/store/thane/` SPA — routing, state management, data fetching, cart, and component composition.

**→ [E-Commerce App Walkthrough](examples/e-commerce-app.md)**
