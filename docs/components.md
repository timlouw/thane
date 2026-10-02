# Components

Components are the building blocks of a Thane application. Each component is a function that returns a template, optional styles, and optional lifecycle hooks. The compiler transforms them into optimized DOM operations at build time.

## Defining a Component

Use `defineComponent()` to create a component:

```typescript
import { defineComponent, html } from 'thane';

export const MyButton = defineComponent(() => {
  return {
    template: html`<button>Click me</button>`,
  };
});
```

The compiler auto-derives the CSS selector from the name the component is declared under: `MyButton` → `my-button`. The selector is used as a CSS class on the host element for style scoping.

### Explicit Selector

Pass a string as the first argument to set the selector manually:

```typescript
export const MyButton = defineComponent('custom-button', () => {
  return {
    template: html`<button>Click me</button>`,
  };
});
```

## Props

Components accept typed props via the generic parameter:

```typescript
import { defineComponent, html } from 'thane';

type GreeterProps = {
  name: string;
};

export const Greeter = defineComponent<GreeterProps>('app-greeter', ({ props }) => {
  return {
    template: html`<h1>Hello, ${props.name}!</h1>`,
  };
});
```

Props are passed when embedding a child component in a parent's template:

```typescript
${Greeter({ name: 'World' })}
```

### Signal Props

Props can be signals for reactive references. The child reads the signal and automatically updates when the parent changes it. A zero-argument call on a prop in a template, `props.count()`, is compiled as a signal read, so pass a signal (not a plain function) for any prop the template calls:

```typescript
import { defineComponent, html } from 'thane';
import type { Signal } from 'thane';

type CounterDisplayProps = {
  count: Signal<number>;
};

export const CounterDisplay = defineComponent<CounterDisplayProps>('counter-display', ({ props }) => {
  return {
    template: html`<span>Count: ${props.count()}</span>`,
  };
});
```

Parent component:

```typescript
import { defineComponent, signal, html } from 'thane';
import { CounterDisplay } from './counter-display.js';

export const Parent = defineComponent(() => {
  const count = signal(0);

  return {
    template: html`
      <button @click=${() => count(count() + 1)}>Increment</button>
      ${CounterDisplay({ count })}
    `,
  };
});
```

## Component Context

The setup function receives a `ComponentContext` object:

```typescript
export const MyComponent = defineComponent<MyProps>('my-component', (ctx) => {
  ctx.root; // HTMLElement — the host element
  ctx.props; // Readonly<MyProps> — component props
  ctx.route; // Route context — available when mounted via the router

  return { template: html`...` };
});
```

| Property | Type           | Description                                     |
| :------- | :------------- | :---------------------------------------------- |
| `root`   | `HTMLElement`  | The host DOM element the component renders into |
| `props`  | `Readonly<P>`  | Props passed by the parent                      |
| `route`  | `RouteContext` | Current route info (when used with the router)  |

## Lifecycle Hooks

Components support two lifecycle hooks:

```typescript
export const Timer = defineComponent(() => {
  const elapsed = signal(0);
  let intervalId: number;

  return {
    template: html`<p>Elapsed: ${elapsed()}s</p>`,

    onMount: () => {
      intervalId = setInterval(() => elapsed(elapsed() + 1), 1000);
    },

    onDestroy: () => {
      clearInterval(intervalId);
    },
  };
});
```

| Hook        | When it fires                                                     | Use case                                            |
| :---------- | :---------------------------------------------------------------- | :-------------------------------------------------- |
| `onMount`   | After the template is in the DOM and all bindings are initialized | Start intervals, fetch data, attach listeners       |
| `onDestroy` | When the component is removed from the DOM                        | Clean up intervals, abort fetches, remove listeners |

**Important:** `onDestroy` fires when:

- `mount().destroy()` is called
- A `when()` hides the component
- The `repeat()` row that holds it is removed, or the list itself goes away with its branch or component
- The router navigates away from the route containing the component
- A parent component is destroyed (destruction propagates to children)

### `onCleanup`

`onCleanup(fn)`, called in the setup or in `onMount`, runs `fn` when the component is destroyed. It keeps what is set up
and what undoes it together, which `onMount` and `onDestroy` pull apart:

```typescript
import { defineComponent, html, onCleanup } from 'thane';

export const Shell = defineComponent(() => {
  const onScroll = () => document.body.classList.toggle('scrolled', window.scrollY > 0);
  return {
    template: html`<header>…</header>`,
    onMount: () => {
      window.addEventListener('scroll', onScroll, { passive: true });
      onCleanup(() => window.removeEventListener('scroll', onScroll));
    },
  };
});
```

A component's `computed()`s and `effect()`s are disposed the same way (see
[Who Disposes a Computed or an Effect](state-management.md#who-disposes-a-computed-or-an-effect)). When it is destroyed,
`onDestroy` runs first, then the `onCleanup()` functions and disposals, in the order they were made. Called anywhere else
(in an event handler, or a store module), `onCleanup()` throws in a development build: nothing would call `fn` there.

## Mounting

Use `mount()` to attach a component to the DOM:

```typescript
import { mount } from 'thane';
import { App } from './app.js';

const handle = mount({ component: App });
```

`mount()` accepts:

| Option      | Type                    | Default                 | Description                                      |
| :---------- | :---------------------- | :---------------------- | :----------------------------------------------- |
| `component` | `ComponentHTMLSelector` | _(required for Mode A)_ | Component from `defineComponent`                 |
| `target`    | `HTMLElement`           | `document.body`         | DOM element to mount into                        |
| `props`     | `Record<string, any>`   | `{}`                    | Props for the root component                     |
| `router`    | `RouterConfig`          | _(none)_                | Router configuration (see [Routing](routing.md)) |

### MountHandle

`mount()` returns a `MountHandle`:

```typescript
const handle = mount({ component: App });

handle.root; // HTMLElement — the component's host element
handle.destroy(); // unmount and run onDestroy
```

### Unmount Helper

```typescript
import { unmount } from 'thane';

unmount(handle); // equivalent to handle.destroy()
```

## Child Components

Embed child components inside a parent's template using function-call syntax:

```typescript
import { Navbar } from './navbar.js';
import { Footer } from './footer.js';

export const App = defineComponent(() => ({
  template: html`
    ${Navbar()}
    <main>Content</main>
    ${Footer()}
  `,
}));
```

The compiler automatically manages the child's lifecycle. When the parent is destroyed, all children are destroyed too.

## Multiple Instances

Each component instance has independent state:

```typescript
template: html` ${Counter()} ${Counter()} `;
```

These two `Counter` instances maintain their own signal values.

## Several Components in One File

A file can declare several components. Each is compiled on its own, with its own template, bindings and
styles. A component the file does not export is private to it: the file's other components mount it like
any child, and no other file can import it.

```typescript
import { defineComponent, html, repeat, signal } from 'thane';

const OrderRow = defineComponent<{ order: Order }>(({ props }) => ({
  template: html`<li>${props.order.name}: ${props.order.total}</li>`,
}));

export const Orders = defineComponent(() => {
  const orders = signal<Order[]>([]);
  return {
    template: html`<ul>${repeat(orders(), (o) => OrderRow({ order: o }), { key: 'id' })}</ul>`,
  };
});
```

A private component's selector is derived from its name like an exported one's (`OrderRow` → `order-row`).
Selectors must differ across the app: two components with one selector share their host class, and the styles
of the one registered first apply to both. The build reports two such components (THANE013); give one of them
another name or an explicit selector.

## One Return Object

A setup function returns one object (lint rule THANE412). The compiler builds one static template per component, so a setup cannot choose between templates with early returns. Choose inside the template instead:

```typescript
// ❌ BAD — two return objects
export const Profile = defineComponent(() => {
  const user = signal<User | null>(null);
  if (!user()) return { template: html`<p>Loading…</p>` };
  return { template: html`<p>${user()!.name}</p>` };
});

// ✅ GOOD — one return object; when() picks the branch
export const Profile = defineComponent(() => {
  const user = signal<User | null>(null);
  return {
    template: html`${when(user() === null, html`<p>Loading…</p>`, html`<p>${user()?.name}</p>`)}`,
  };
});
```

Returns inside nested functions, such as event handlers and helpers defined in the setup, are not affected.

## Expression-Body Syntax

For simple components, use an expression-body arrow function:

```typescript
export const Badge = defineComponent<{ text: string }>('ui-badge', ({ props }) => ({
  template: html`<span class="badge">${props.text}</span>`,
}));
```

← [Back to Docs](README.md)
