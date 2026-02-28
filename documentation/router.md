# Router

Thane includes a built-in client-side router with per-route code splitting, type-safe navigation, and zero overhead for apps that don't use routing.

## Quick Start

### 1. Define Routes

Create a `routes.ts` file with your route definitions:

```ts
// routes.ts
import { defineRoutes } from 'thane/router';

const Routes = defineRoutes({
  '/':          { component: () => import('./pages/home.js'), title: 'Home' },
  '/about':     { component: () => import('./pages/about.js'), title: 'About' },
  '/users/:id': { component: () => import('./pages/user.js'), title: 'User Profile' },
  notFound:     { component: () => import('./pages/not-found.js'), title: '404 — Not Found' },
});

type Routes = typeof Routes;

// Register routes for type-safe navigate() and getRouteParam()
declare module 'thane' {
  interface Register {
    routes: Routes;
  }
}

export default Routes;
```

> **Why `type Routes = typeof Routes`?** This creates a dual value/type name so the
> `Register` interface can reference `Routes` without the user writing `typeof` in the
> module augmentation. The compiler sees the value when you import it and the type when
> you use it in `Register`.

### 2. Bootstrap Your App

Choose one of three bootstrap modes depending on your app structure.

---

## Bootstrap Modes

### Mode A — Component Only (No Router)

For apps that don't need routing. Mount a single component directly.

```ts
// main.ts
import { mount } from 'thane';
import { App } from './app.js';

mount({ component: App });
```

With a custom target element:

```ts
mount({
  component: App,
  target: document.getElementById('app')!,
});
```

**This mode includes zero router code in the bundle.**

---

### Mode B — Shell Component + Router

For apps with a persistent layout (nav, sidebar, footer) and a content area where pages render.

```ts
// main.ts
import { mount } from 'thane';
import { ShellApp } from './shell-app.js';
import Routes from './routes.js';

mount({
  component: ShellApp,
  router: { routes: Routes },
});
```

Your shell component must include an element with `id="router-outlet"`:

```ts
// shell-app.ts
import { defineComponent } from 'thane';

export const ShellApp = defineComponent(() => {
  const t = html`
    <nav>
      <a href="/" onclick="navigate('/'); return false;">Home</a>
      <a href="/about" onclick="navigate('/about'); return false;">About</a>
    </nav>
    <div id="router-outlet"></div>
    <footer>© 2026</footer>
  `;
  return { template: t };
});
```

The router renders each page component inside the `#router-outlet` element.

**Custom outlet ID:**

```ts
mount({
  component: ShellApp,
  router: {
    routes: Routes,
    outletId: 'router-content',  // must match an element in ShellApp's template
  },
});
```

The `outletId` must follow the pattern `` `router-${string}` `` (e.g. `router-content`, `router-sidebar`).

---

### Mode C — Router Only (No Shell)

For apps where the router controls the entire page — no persistent layout.

```ts
// main.ts
import { mount } from 'thane';
import Routes from './routes.js';

mount({
  router: { routes: Routes },
});
```

Page components render directly into `document.body`. To use a custom container:

```ts
mount({
  target: document.getElementById('app')!,
  router: { routes: Routes },
});
```

**No outlet element is created.** Pages mount directly into the target.

---

## Navigation

### `navigate(path)`

Navigate programmatically using HTML5 History `pushState`:

```ts
navigate('/about');
navigate('/users/42');
```

`navigate` is a global function — no imports needed in page components. It's type-safe when the `Register` interface is augmented (see [Type-Safe Navigation](#type-safe-navigation)).

### `navigateBack()`

Go back in history (wrapper around `history.back()`):

```ts
navigateBack();
```

### `getRouteParam(name)`

Retrieve a named route parameter from the current URL:

```ts
// For route '/users/:id' matched against '/users/42':
const userId = getRouteParam('id'); // '42'
```

Both `navigate` and `getRouteParam` are global functions — no imports needed.

---

## Route Parameters

Use `:param` syntax in route patterns:

```ts
const Routes = defineRoutes({
  '/users/:id':               { component: () => import('./pages/user.js') },
  '/posts/:postId/comments/:commentId': { component: () => import('./pages/comment.js') },
  notFound:                   { component: () => import('./pages/not-found.js') },
});
```

Inside a page component:

```ts
export const UserPage = defineComponent(() => {
  const userId = getRouteParam('id');
  // ...
});
```

### Root-Level Params Are Blocked

To prevent fully-dynamic routes that would match everything, root-level params are disallowed:

```ts
// ❌ Compile-time AND runtime error:
defineRoutes({
  '/:slug': { component: () => import('./pages/dynamic.js') },
  notFound: { component: () => import('./pages/not-found.js') },
});

// ✅ Must have a static first segment:
defineRoutes({
  '/pages/:slug': { component: () => import('./pages/dynamic.js') },
  notFound:       { component: () => import('./pages/not-found.js') },
});
```

---

## Type-Safe Navigation

When you augment the `Register` interface, TypeScript provides full autocomplete and compile-time checking for `navigate()` and `getRouteParam()`:

```ts
// routes.ts
const Routes = defineRoutes({
  '/':          { component: () => import('./pages/home.js') },
  '/about':     { component: () => import('./pages/about.js') },
  '/users/:id': { component: () => import('./pages/user.js') },
  notFound:     { component: () => import('./pages/not-found.js') },
});

type Routes = typeof Routes;

declare module 'thane' {
  interface Register { routes: Routes }
}
```

Now in any file:

```ts
navigate('/');            // ✅
navigate('/about');       // ✅
navigate('/users/42');    // ✅ — matches pattern /users/:id
navigate('/users/alice'); // ✅ — matches pattern /users/:id
navigate('/typo');        // ❌ — compile error, no matching route
navigate('/users');       // ❌ — compile error, missing :id segment

getRouteParam('id');      // ✅ — declared in /users/:id
getRouteParam('foo');     // ❌ — compile error, no route declares :foo
```

### How It Works

The `Register` interface uses TypeScript's module augmentation. When empty, `navigate()` accepts any `string`. When augmented with `routes`, the `RouteToPath` utility type converts patterns like `/users/:id` into template literal types like `` `/users/${string}` ``, giving you structural matching at the type level — **zero developer effort, no `.d.ts` files needed**.

The `notFound` key is excluded from type-safe navigation — it's the fallback route, not a navigable path.

---

## Code Splitting & Hash Stability

- Each route's `component` function uses dynamic `import()`, so page code is automatically split into separate chunks by esbuild.
- `navigate()`, `navigateBack()`, and `getRouteParam()` live in the thane shared chunk — they have zero knowledge of your routes and never change when routes change.
- Changing a single page component only invalidates that page's chunk hash.
- The router runtime is loaded via dynamic import inside `mount()` — **apps without a `router` option (Mode A) include zero router code**.

---

## API Reference

### `defineRoutes(routes)`

Identity function that preserves literal route keys for type inference. Validates that no route starts with `/:`. The `notFound` key is mandatory at the type level — TypeScript will error if it's missing.

### `mount(options)`

| Property | Type | Default | Description |
|---|---|---|---|
| `component` | `ComponentHTMLSelector` | — | Shell or standalone component |
| `target` | `HTMLElement` | `document.body` | Mount target element |
| `props` | `Record<string, any>` | — | Component props |
| `router` | `RouterConfig` | — | Router configuration |

### `RouterConfig`

| Property | Type | Default | Description |
|---|---|---|---|
| `routes` | `RoutesConfig` | *required* | Return value of `defineRoutes()` |
| `outletId` | `` `router-${string}` `` | `'router-outlet'` | Outlet element ID (Mode B only) |

### `RoutesConfig`

The return type of `defineRoutes()` — a record of path-pattern → Route pairs plus a mandatory `notFound` entry.

### `Route`

| Property | Type | Description |
|---|---|---|
| `component` | `() => Promise<any>` | Lazy component loader |
| `title` | `string?` | Document title |

### Global Functions

| Function | Description |
|---|---|
| `navigate(path)` | Push a new path to history |
| `navigateBack()` | Go back in history |
| `getRouteParam(name)` | Get a route param value |

### `Register` Interface

Augment to enable type-safe navigation:

```ts
type Routes = typeof Routes;

declare module 'thane' {
  interface Register { routes: Routes }
}
```
