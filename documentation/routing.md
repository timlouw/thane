# Routing

Thane includes a built-in client-side router that is fully tree-shakable. If your app doesn't import any router symbols, the router code is completely eliminated from the bundle.

## Defining Routes

Use `defineRoutes()` from `thane/router` to declare your route map:

```typescript
import { defineRoutes } from 'thane/router';

const Routes = defineRoutes({
  '/':              { component: () => import('./pages/home.js'), title: 'Home' },
  '/about':         { component: () => import('./pages/about.js'), title: 'About' },
  '/users/:id':     { component: () => import('./pages/user.js'), title: 'User Details' },
  notFound:         { component: () => import('./pages/not-found.js'), title: '404' },
});

export default Routes;
```

Each route consists of:

| Property | Type | Description |
|:---------|:-----|:------------|
| `component` | `() => Promise<any>` \| `ComponentHTMLSelector` | Lazy loader or eager component |
| `title` | `string` *(optional)* | Sets `document.title` when the route is active |

The `notFound` route is **required** — it renders when no other route matches. Route patterns starting with `/:param` (root-level parameters) are rejected at runtime.

## Bootstrap Modes

Thane supports three ways to mount a routed application:

### Mode A — Component Only (No Router)

```typescript
import { mount } from 'thane';
import { App } from './app.js';

mount({ component: App });
```

No routing. Use this for single-page apps that don't need URL-based navigation.

### Mode B — Shell + Router

```typescript
import { mount } from 'thane';
import { App } from './app.js';
import Routes from './routes.js';

mount({
  component: App,
  router: { routes: Routes },
});
```

The shell component (`App`) wraps the router. Its template must contain an element with `id="router-outlet"`:

```typescript
export const App = defineComponent('store-app', () => ({
  template: html`
    ${Navbar({})}
    <div id="router-outlet"></div>
  `,
}));
```

Page components render inside the outlet. The shell (including Navbar) persists across navigations.

### Mode C — Router Only

```typescript
import { mount } from 'thane';
import Routes from './routes.js';

mount({
  router: { routes: Routes },
});
```

No shell component. Page components render directly into `document.body` (or a `target` element).

## Navigation

### `navigate(path)`

Navigate programmatically using HTML5 History pushState:

```typescript
navigate('/about');
navigate('/users/42');
```

In templates, bind directly to click handlers:

```typescript
template: html`
  <a @click=${navigate('/')}>Home</a>
  <a @click=${navigate('/about')}>About</a>
`
```

`navigate()` is **type-safe** when you register your routes (see [Type-Safe Routes](#type-safe-routes) below).

### `navigateBack()`

Go back in browser history:

```typescript
template: html`<button @click=${navigateBack}>← Back</button>`
```

### `currentPath()`

A read-only signal containing the current pathname. Use it for active link styling:

```typescript
template: html`
  <a class=${currentPath() === '/' ? 'active' : ''} @click=${navigate('/')}>Home</a>
`
```

## Route Parameters

Define parameters with `:param` syntax:

```typescript
'/users/:id':     { component: () => import('./pages/user.js') },
'/posts/:postId': { component: () => import('./pages/post.js') },
```

Access parameters via `route.params` in the page component:

```typescript
export const UserPage = defineComponent('user-page', ({ route }) => {
  const userId = route.params.id;

  return {
    template: html`<h1>User: ${userId}</h1>`,
  };
});
```

## Route Context

Every component has access to route context via `ctx.route`:

| Property | Type | Description |
|:---------|:-----|:------------|
| `path` | `string` | Current URL pathname |
| `pattern` | `string` | Matched route pattern (e.g., `/users/:id`) |
| `params` | `Record<string, string>` | Extracted route parameters |
| `searchParams` | `URLSearchParams` | URL query parameters |
| `hash` | `string` | URL hash fragment |
| `title` | `string` | Document title from route config |
| `state` | `unknown` | History state object |

## Code Splitting

Use dynamic `import()` for lazy-loaded route components. Each page becomes a separate chunk:

```typescript
const Routes = defineRoutes({
  '/':         { component: () => import('./pages/home.js') },
  '/settings': { component: () => import('./pages/settings.js') },
  notFound:    { component: () => import('./pages/404.js') },
});
```

For eager loading (bundled with the main chunk), pass the component directly:

```typescript
import { HomePage } from './pages/home.js';

const Routes = defineRoutes({
  '/': { component: HomePage },
  // ...
});
```

## Scroll Restoration

The router manages scroll position automatically:

- **On navigate:** Scrolls to top (0, 0)
- **On back/forward:** Restores the saved scroll position

### Configuration

```typescript
mount({
  component: App,
  router: {
    routes: Routes,
    scrollRestoration: {
      resetOnNavigate: true,        // scroll to top on navigate() — default: true
      restoreOnBackForward: true,    // restore position on back/forward — default: true
      behavior: 'auto',             // 'auto' | 'smooth' — default: 'auto'
      top: 0,                       // reset top offset — default: 0
      left: 0,                      // reset left offset — default: 0
    },
  },
});
```

Disable scroll restoration entirely:

```typescript
mount({
  component: App,
  router: {
    routes: Routes,
    scrollRestoration: false,
  },
});
```

## Custom Outlet ID

By default, the router looks for `id="router-outlet"`. Customize it with the `outletId` option:

```typescript
mount({
  component: App,
  router: {
    routes: Routes,
    outletId: 'router-main',
  },
});
```

The outlet ID must match the pattern `` `router-${string}` ``.

## Type-Safe Routes

Thane generates type definitions for your routes automatically. After running `thane dev`, `thane build`, or `thane types`, the `.thane/types/router/` directory contains generated `.d.ts` files that:

1. Make `navigate()` autocomplete valid paths
2. Type `route.params` correctly for each page component
3. Reject invalid paths at compile time

The types are generated by the `router-typegen` compiler plugin, which scans your `defineRoutes()` call and emits corresponding TypeScript declarations.

## Full Example — E-Commerce Shell

```typescript
// routes.ts
import { defineRoutes } from 'thane/router';

const Routes = defineRoutes({
  '/':                          { component: () => import('./pages/Products/Products.js'), title: 'Products' },
  '/my-cart':                   { component: () => import('./pages/Cart/Cart.js'), title: 'My Cart' },
  '/product-details/:productID': { component: () => import('./pages/ProductDetails/ProductDetails.js'), title: 'Product Details' },
  notFound:                     { component: () => import('./pages/NotFound/NotFound.js'), title: 'Not Found' },
});

export default Routes;

// main.ts
import { mount } from 'thane';
import { App } from './app.js';
import Routes from './routes.js';

mount({ component: App, router: { routes: Routes } });

// app.ts — shell component
export const App = defineComponent('store-app', () => ({
  template: html`
    ${Navbar({})}
    <div id="router-outlet"></div>
  `,
  styles: appStyles,
}));
```

← [Back to Docs](README.md)
