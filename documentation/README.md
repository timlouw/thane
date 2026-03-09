# Thane Developer Documentation

Thane is a **compile-time component framework** for TypeScript. Templates are compiled to optimized vanilla JavaScript at build time — static template cloning, direct DOM navigation, and fine-grained signal subscriptions — so the browser does the absolute minimum work at runtime.

**~3 KB gzip** · Zero virtual DOM · TypeScript-first · 12 compile-time lint rules

---

## Getting Started

Install Thane, scaffold your first component, and run the dev server.

```typescript
import { defineComponent, signal, mount } from 'thane';

export const Counter = defineComponent(() => {
  const count = signal(0);
  return {
    template: html`<button @click=${() => count(count() + 1)}>Clicks: ${count()}</button>`,
  };
});

mount({ component: Counter });
```

**→ [Getting Started](getting-started.md)**

---

## Signals

Reactive primitives — `signal()`, `computed()`, `effect()`, `batch()`, `untrack()`.

```typescript
const name = signal('world');
const greeting = computed(() => `Hello, ${name()}!`);
effect(() => console.log(greeting())); // logs: "Hello, world!"
name('Thane');                          // logs: "Hello, Thane!"
```

**→ [Signals](signals.md)**

---

## Components

Define components with `defineComponent()`, receive typed props, use lifecycle hooks, and mount to the DOM.

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

Tagged template literals — `html```, text bindings, attribute bindings, style bindings, and HTML fragment injection.

```typescript
template: html`
  <span :style=${'color:' + color()}>
    ${label()}: ${count()}
  </span>
`
```

**→ [Templates](templates.md)**

---

## Event Handling

Bind DOM events with `@event` syntax and typed handlers.

```typescript
template: html`<button @click=${(e: MouseEvent) => console.log(e)}>Click</button>`
```

**→ [Event Handling](event-handling.md)**

---

## Directives

Conditional rendering and list rendering — `when()`, `whenElse()`, `repeat()`.

```typescript
template: html`
  <div ${when(isVisible())}>Shown conditionally</div>
  ${repeat(items(), (item) => html`<li>${item()}</li>`, html`<li>No items</li>`, (item) => item().id)}
`
```

**→ [Directives Overview](directives/README.md)** · [when](directives/when.md) · [whenElse](directives/when-else.md) · [repeat](directives/repeat.md)

---

## Routing

Type-safe client-side routing with `defineRoutes()`, lazy loading, route parameters, and scroll restoration.

```typescript
const Routes = defineRoutes({
  '/':          { component: () => import('./pages/home.js'), title: 'Home' },
  '/users/:id': { component: () => import('./pages/user.js'), title: 'User' },
  notFound:     { component: () => import('./pages/404.js'), title: '404' },
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

`thane dev`, `thane build`, `thane serve`, `thane typecheck`, `thane types` — plus configuration file support.

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

12 compile-time lint rules (THANE400–THANE411) that catch silent failures before they reach the browser.

**→ [Lint Rules](lint-rules.md)**

---

## API Reference

Complete API surface — all exports from `thane` and `thane/router`, global template functions, and types.

**→ [API Reference](api-reference.md)**

---

## Known Limitations

Compiler constraints, runtime constraints, browser requirements, and features not yet supported.

**→ [Known Limitations](known-limitations.md)**

---

## Examples

### E-Commerce App

A full walkthrough of the `example-apps/thane-app/` SPA — routing, state management, data fetching, cart, and component composition.

**→ [E-Commerce App Walkthrough](examples/e-commerce-app.md)**
