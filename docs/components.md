# Components

Components are the building blocks of a Thane application. Each component is a setup function that returns its
template, or an object with the template, styles and lifecycle hooks. The compiler transforms them into optimized DOM
operations at build time.

## Defining a Component

Use `defineComponent()` to create a component. A setup with nothing but its template returns the template:

```typescript
import { defineComponent, html } from 'thane';

export const MyButton = defineComponent(() => html`<button>Click me</button>`);
```

One with styles or lifecycle hooks returns an object:

```typescript
export const MyButton = defineComponent(() => ({
  template: html`<button>Click me</button>`,
  styles: css`button { padding: 1rem; }`,
  onMount: () => console.log('mounted'),
}));
```

The compiler auto-derives the CSS selector from the name the component is declared under: `MyButton` → `my-button`. The selector is used as a CSS class on the host element for style scoping.

### Explicit Selector

Pass a string as the first argument to set the selector manually:

```typescript
export const MyButton = defineComponent('custom-button', () => html`<button>Click me</button>`);
```

A route's page that reads its typed `route.params` has one: the route types find the page by its selector
([Routing](routing.md)).

## Props

Components accept typed props via the generic parameter:

```typescript
import { defineComponent, html } from 'thane';

type GreeterProps = {
  name: string;
};

export const Greeter = defineComponent<GreeterProps>(({ props }) => html`<h1>Hello, ${props.name}!</h1>`);
```

Props are passed when embedding a child component in a parent's template:

```typescript
${Greeter({ name: 'World' })}
```

### Signal Props

Props can be signals for reactive references. The child reads the signal and automatically updates when the parent changes it. A zero-argument call on a prop in a template, `props.count()`, is compiled as a signal read, so pass a signal (not a plain function) for any prop the template calls. A child that only reads it takes a `ReadonlySignal`, which a `computed()` is too:

```typescript
import { defineComponent, html } from 'thane';
import type { ReadonlySignal } from 'thane';

type CounterDisplayProps = {
  count: ReadonlySignal<number>;
};

export const CounterDisplay = defineComponent<CounterDisplayProps>(({ props }) => html`<span>Count: ${props.count()}</span>`);
```

Parent component:

```typescript
import { defineComponent, signal, html } from 'thane';
import { CounterDisplay } from './counter-display.js';

export const Parent = defineComponent(() => {
  const count = signal(0);
  return html`
    <button @click=${count(count() + 1)}>Increment</button>
    ${CounterDisplay({ count })}
  `;
});
```

Pass the signal itself, `CounterDisplay({ count })`. A prop that takes a plain value gets the value the signal has when the
child mounts, and never sees it change: the build warns when a prop reads a signal (THANE416).

### Slots

A prop typed `Fragment` is a slot: the parent passes markup, and the child places it. The parent writes the
template as the prop's value; the child reads the prop where the markup goes:

```typescript
import { defineComponent, html, type Fragment } from 'thane';

interface PanelProps {
  title: string;
  body: Fragment;
  footer?: Fragment;
}

export const Panel = defineComponent<PanelProps>(
  ({ props }) => html`
    <section>
      <h3>${props.title}</h3>
      ${props.body}
      <footer>${props.footer}</footer>
    </section>
  `,
);
```

```typescript
export const Cart = defineComponent(() => {
  const count = signal(0);
  return html`
    ${Panel({
      title: 'Cart',
      body: html`<p>${count()} items</p>
        <button @click=${count(count() + 1)}>Add</button>`,
    })}
  `;
});
```

The template is compiled in the parent, where it is written: its bindings read the parent's signals and its handlers
are the parent's, and it goes when the child goes. A component has as many slots as it has `Fragment` props; one the
parent leaves out (`footer` here) renders nothing. A slot can be a `const` of the parent's (`Panel({ title, body })`)
or a fragment another module exports. The compiler reads which props are slots from the child's props type as
written in its file (a type literal, or an interface or type alias of that file); a child reads a slot as
`${props.body}`, also as a `when()` branch or a branch of a ternary.

## Component Context

The setup function receives a `ComponentContext` object:

```typescript
export const MyComponent = defineComponent<MyProps>('my-component', (ctx) => {
  ctx.root; // HTMLElement — the host element
  ctx.props; // Readonly<MyProps> — component props
  ctx.route; // Route context — available when mounted via the router

  return html`...`;
});
```

| Property | Type           | Description                                     |
| :------- | :------------- | :---------------------------------------------- |
| `root`   | `HTMLElement`  | The host DOM element the component renders into |
| `props`  | `Readonly<P>`  | Props passed by the parent                      |
| `route`  | `RouteContext` | Current route info (when used with the router)  |

To reach an element of the template, give it a ref rather than querying `root`
([Element Refs](templates.md#element-refs)).

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

const handle = mount(App);
```

`mount(component, options?)` takes the component, and options:

| Option              | Type                                  | Default         | Description                                                            |
| :------------------ | :------------------------------------ | :-------------- | :--------------------------------------------------------------------- |
| `target`            | `HTMLElement`                         | `document.body` | DOM element to mount into                                              |
| `props`             | `Record<string, any>`                 | `{}`            | Props for the root component                                           |
| `routes`            | the result of `defineRoutes()`        | _(none)_        | The component is the app's shell, and pages go into its `<router-outlet>` ([Routing](routing.md#mounting)) |
| `scrollRestoration` | `boolean` \| `ScrollRestorationConfig` | enabled         | With `routes`: [Scroll Restoration](routing.md#scroll-restoration)     |

`mount(Routes)` mounts the routes alone, without a shell.

### MountHandle

`mount()` returns a `MountHandle`:

```typescript
const handle = mount(App);

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

export const App = defineComponent(
  () => html`
    ${Navbar()}
    <main>Content</main>
    ${Footer()}
  `,
);
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

const OrderRow = defineComponent<{ order: Order }>(({ props }) => html`<li>${props.order.name}: ${props.order.total}</li>`);

export const Orders = defineComponent(() => {
  const orders = signal<Order[]>([]);
  return html`<ul>${repeat(orders(), (o) => OrderRow({ order: o }), { key: 'id' })}</ul>`;
});
```

A private component's selector is derived from its name like an exported one's (`OrderRow` → `order-row`).
Selectors must differ across the app: two components with one selector would share their host class, its styles
and its hot updates, so the build fails for them (THANE013). Give one of them another name or a selector of its
own.

## One Return

A setup function returns once: one object, or one template (lint rule THANE412). The compiler builds one static template per component, so a setup cannot choose between templates with early returns. Choose inside the template instead:

```typescript
// ❌ BAD — two returns
export const Profile = defineComponent(() => {
  const user = signal<User | null>(null);
  if (!user()) return html`<p>Loading…</p>`;
  return html`<p>${user()!.name}</p>`;
});

// ✅ GOOD — one return; when() picks the branch, and narrows the user
export const Profile = defineComponent(() => {
  const user = signal<User | null>(null);
  return html`${when(user(), (u) => html`<p>${u.name}</p>`, html`<p>Loading…</p>`)}`;
});
```

Returns inside nested functions, such as event handlers and helpers defined in the setup, are not affected.

## A Template Alone

A component with nothing but a template returns the template itself, as in the examples above: it is the same as
returning `{ template }`. A component with styles or hooks returns the object.

← [Back to Docs](README.md)
