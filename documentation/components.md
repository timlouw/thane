# Components

Components are the building blocks of a Thane application. Each component is a function that returns a template, optional styles, and optional lifecycle hooks. The compiler transforms them into optimized DOM operations at build time.

## Defining a Component

Use `defineComponent()` to create a component:

```typescript
import { defineComponent } from 'thane';

export const MyButton = defineComponent(() => {
  return {
    template: html`<button>Click me</button>`,
  };
});
```

The compiler auto-derives the CSS selector from the export name: `MyButton` → `my-button`. The selector is used as a CSS class on the host element for style scoping.

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
import { defineComponent } from 'thane';

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

Props can be signals for reactive references. The child reads the signal and automatically updates when the parent changes it:

```typescript
import { defineComponent } from 'thane';
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
import { defineComponent, signal } from 'thane';
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
  ctx.root;  // HTMLElement — the host element
  ctx.props; // Readonly<MyProps> — component props
  ctx.route; // Route context — available when mounted via the router

  return { template: html`...` };
});
```

| Property | Type | Description |
|:---------|:-----|:------------|
| `root` | `HTMLElement` | The host DOM element the component renders into |
| `props` | `Readonly<P>` | Props passed by the parent |
| `route` | `RouteContext` | Current route info (when used with the router) |

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

| Hook | When it fires | Use case |
|:-----|:-------------|:---------|
| `onMount` | After the template is in the DOM and all bindings are initialized | Start intervals, fetch data, attach listeners |
| `onDestroy` | When the component is removed from the DOM | Clean up intervals, abort fetches, remove listeners |

**Important:** `onDestroy` fires when:
- `mount().destroy()` is called
- A `when()` directive hides the component
- The router navigates away from the route containing the component
- A parent component is destroyed (destruction propagates to children)

## Mounting

Use `mount()` to attach a component to the DOM:

```typescript
import { mount } from 'thane';
import { App } from './app.js';

const handle = mount({ component: App });
```

`mount()` accepts:

| Option | Type | Default | Description |
|:-------|:-----|:--------|:------------|
| `component` | `ComponentHTMLSelector` | *(required for Mode A)* | Component from `defineComponent` |
| `target` | `HTMLElement` | `document.body` | DOM element to mount into |
| `props` | `Record<string, any>` | `{}` | Props for the root component |
| `router` | `RouterConfig` | *(none)* | Router configuration (see [Routing](routing.md)) |

### MountHandle

`mount()` returns a `MountHandle`:

```typescript
const handle = mount({ component: App });

handle.root;    // HTMLElement — the component's host element
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
    ${Navbar({})}
    <main>Content</main>
    ${Footer({})}
  `,
}));
```

The compiler automatically manages the child's lifecycle. When the parent is destroyed, all children are destroyed too.

## Multiple Instances

Each component instance has independent state:

```typescript
template: html`
  ${Counter({})}
  ${Counter({})}
`
```

These two `Counter` instances maintain their own signal values.

## One Component Per File

The compiler enforces one `defineComponent` per file (lint rule THANE407). This ensures each component gets a unique selector and avoids ambiguity in the compilation pipeline.

## Expression-Body Syntax

For simple components, use an expression-body arrow function:

```typescript
export const Badge = defineComponent<{ text: string }>('ui-badge', ({ props }) => ({
  template: html`<span class="badge">${props.text}</span>`,
}));
```

← [Back to Docs](README.md)
