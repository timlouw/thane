# Router

Thane includes a built-in client-side router with optional per-route code splitting, type-safe navigation, and zero overhead for apps that don't use routing.

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

export default Routes;
```

Routes can be declared in two ways:

- Lazy route: `component: () => import('./pages/about.js')`
- Eager route: `component: AboutPage`

Lazy routes produce separate chunks when code splitting is enabled. Eager routes are bundled into the main app graph like normal imports.

Run `thane dev`, `thane build`, or `thane serve` once and Thane will generate hidden
types under `.thane/types/...`. Router declarations live in `.thane/types/router/...`, and
shared ambient declarations such as CSS module support live alongside them.

If you want to generate those hidden types without building, run `thane types`.

Before the first Thane command runs, router component context falls back to broad types.
That keeps the app buildable while still nudging you toward generated route-aware types.

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
  router: {
    routes: Routes,
    scrollRestoration: true,
  },
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

`navigate` is a global function — no imports needed in page components. It becomes type-safe
after the hidden router type file has been generated.

### `navigateBack()`

Go back in history (wrapper around `history.back()`):

```ts
navigateBack();
```

### `route.params`

Read route params from the component setup context:

```ts
export const UserPage = defineComponent('user-page', ({ route }) => {
  const userId = route.params.id;

  return {
    template: html`<h1>User ${userId}</h1>`,
  };
});
```

Generated route typing also gives you `route.path`, `route.pattern`, `route.searchParams`,
`route.hash`, `route.title`, and `route.state`.

### `currentPath`

The active router path is also exposed globally as a read-only signal:

```ts
const path = currentPath();

currentPath.subscribe((nextPath) => {
  console.log('route changed to', nextPath);
});
```

`currentPath` is intentionally read-only in application code. Use `navigate(...)` or browser navigation to change the route.

---

## Scroll Restoration

Router-managed scroll restoration is enabled by default.

```ts
mount({
  component: ShellApp,
  router: {
    routes: Routes,
    scrollRestoration: true,
  },
});
```

You can also configure it:

```ts
mount({
  router: {
    routes: Routes,
    scrollRestoration: {
      behavior: 'auto',
      top: 0,
      left: 0,
      resetOnNavigate: true,
      restoreOnBackForward: true,
    },
  },
});
```

- `resetOnNavigate`: scroll to the configured top/left position after `navigate(...)`
- `restoreOnBackForward`: restore the saved position when the user navigates with browser back/forward
- `behavior`: forwarded to `window.scrollTo(...)`

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
export const UserPage = defineComponent('user-page', ({ route }) => {
  const userId = route.params.id;
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

After the first `thane dev`, `thane build`, or `thane serve` run, Thane generates a hidden
route typing file from your `defineRoutes(...)` call. That gives TypeScript full autocomplete
and compile-time checking for `navigate()` and typed page-local `route.params` access.

Now in any file:

```ts
navigate('/');            // ✅
navigate('/about');       // ✅
navigate('/users/42');    // ✅ — matches pattern /users/:id
navigate('/users/alice'); // ✅ — matches pattern /users/:id
navigate('/typo');        // ❌ — compile error, no matching route
navigate('/users');       // ❌ — compile error, missing :id segment
```

Inside a routed page component:

```ts
export const UserPage = defineComponent('user-page', ({ route }) => {
  route.params.id;   // ✅
  route.pattern;     // '/users/:id'
  route.path;        // `/users/${string}`
});
```

### How It Works

The generated `.thane/types/router/...` file augments Thane's route typing internally. It
records your route pattern union for `navigate(...)` and maps routed page selectors back to
their route patterns so `defineComponent('user-page', ({ route }) => ...)` can get a local,
exact `route.params` type.

The folder layout is intentionally scalable:

```text
.thane/
  types/
    client.d.ts
    router/
      src/routes.generated.d.ts
```

The `notFound` key is excluded from type-safe navigation — it's the fallback route, not a navigable path.

---

## Code Splitting & Hash Stability

- Each route's `component` function uses dynamic `import()`, so page code is automatically split into separate chunks by esbuild.
- `navigate()` and `navigateBack()` live in the thane shared chunk — they have zero knowledge of your routes and never change when routes change.
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
| `component` | `ComponentHTMLSelector<any> \| (() => Promise<any>)` | Eager page component or lazy component loader |
| `title` | `string?` | Document title |

### Global Functions

| Function | Description |
|---|---|
| `navigate(path)` | Push a new path to history |
| `navigateBack()` | Go back in history |
| `currentPath()` | Read the active router path signal |

### Hidden Router Types

Generated during `thane dev`, `thane build`, and `thane serve`:

```ts
/* Auto-generated by Thane. Do not edit by hand. */
declare module 'thane' {
  interface Register {
    routePaths: '/' | '/about' | '/users/:id';
  }

  interface RouteComponentRegister {
    'user-page': '/users/:id';
  }
}
```

Thane stores that file under a framework-owned `.thane` directory, similar to how Next.js uses
`.next/types`, SvelteKit uses `.svelte-kit/types`, Nuxt uses `.nuxt`, and Astro uses `.astro`.
