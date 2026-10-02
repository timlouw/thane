# Routing

Thane includes a built-in client-side router that is fully tree-shakable. If your app doesn't import any router symbols, the router code is completely eliminated from the bundle.

## Defining Routes

Use `defineRoutes()` from `thane/router` to declare your route map:

```typescript
import { defineRoutes } from 'thane/router';

const Routes = defineRoutes({
  '/': { component: () => import('./pages/home.js'), meta: { title: 'Home' } },
  '/about': { component: () => import('./pages/about.js'), meta: { title: 'About' } },
  '/users/:id': { component: () => import('./pages/user.js'), meta: { title: 'User Details' } },
  'notFound': { component: () => import('./pages/not-found.js'), meta: { title: '404' } },
});

export default Routes;
```

Each route consists of:

| Property    | Type                                            | Description                                                                  |
| :---------- | :---------------------------------------------- | :--------------------------------------------------------------------------- |
| `component` | `() => Promise<any>` \| `ComponentHTMLSelector` | Lazy loader or eager component                                               |
| `meta`      | fields \| `(route) => fields` _(optional)_      | The document head while the route is active: see [Route Heads](#route-heads) |

The `notFound` route is **required** — it renders when no other route matches. An `error` route is optional: it renders when a page cannot be shown (see [The Error Route](#the-error-route)). Route patterns starting with `/:param` (root-level parameters) are rejected at runtime.

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
    ${Navbar()}
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

### Links

A plain link to one of the app's routes navigates in the app: the router takes the click, so the page is not
loaded again, and the link keeps everything a link does (open in a new tab, copy the address, a crawler
follows it).

```typescript
template: html`
  <a href="/">Home</a>
  <a href=${href('/users/:id', { id: user.id })}>${user.name}</a>
`;
```

The browser keeps these clicks:
- a click that a handler of the link has already taken (`@click.prevent=${…}`);
- a click with a modifier key or another mouse button (a new tab or window);
- a link with a `target` other than `_self`, a `download`, or `rel="external"`;
- a link to another site, or to a `#hash` on this page;
- a link to a path that no route has, such as a file (`/sitemap.xml`, `/report.pdf`): it loads as usual.

A production build leaves the link handling out when no template, and no `index.html`, has a plain link
to a path (an `<a href>` without its own click handler); an app that has one pays about 565 B raw, 220 B
gzipped.

### `navigate(path)`

Navigate programmatically using HTML5 History pushState:

```typescript
navigate('/about');
navigate('/users/42');
```

In templates, a [link](#links) is usually the better choice; to navigate from a click on something else, bind it directly:

```typescript
template: html`
  <a @click=${navigate('/')}>Home</a>
  <a @click=${navigate('/about')}>About</a>
`;
```

`navigate()` is **type-safe** when you register your routes (see [Type-Safe Routes](#type-safe-routes) below).

### `navigate(pattern, params)` and `href()`

For a route with parameters, pass its pattern and a value for each parameter, rather than building the path
by hand. Each value is URL-encoded, and a page reads it back decoded from `route.params`:

```typescript
import { href } from 'thane/router';

navigate('/users/:id', { id: user.id });

template: html`<a href=${href('/users/:id', { id: user.id })} @click.prevent=${navigate('/users/:id', { id: user.id })}>${user.name}</a>`;
```

`href(pattern, params)` gives the path (`/users/7`) as a value: for an `href` attribute, or to keep in a
`RoutePaths` variable. Both are typed from the routes: the pattern must be one of them, with parameters,
and `params` must give each of its parameters a string or a number and nothing else.

### `navigateBack()`

Go back in browser history:

```typescript
template: html`<button @click=${navigateBack}>← Back</button>`;
```

### `currentPath()`

A read-only signal containing the current pathname. Use it for active link styling:

```typescript
template: html` <a class=${currentPath() === '/' ? 'active' : ''} @click=${navigate('/')}>Home</a> `;
```

## Redirects and Guards

A route can send its path elsewhere with `redirectTo`, or decide with `canEnter` whether it may be entered.
Both run before the page's chunk is fetched.

```typescript
const Routes = defineRoutes({
  '/old-about': { redirectTo: '/about' },
  '/members/:id': { redirectTo: (route) => `/users/${route.params.id}` },
  '/account': { component: () => import('./pages/account.js'), canEnter: () => signedIn() || '/login' },
  '/admin': { component: () => import('./pages/admin.js'), canEnter: async () => (await session()).isAdmin },
  // …
});
```

- **`redirectTo`** is a path, or a function of the route that returns one. The redirect replaces the history
  entry, so the redirected path is not in the history and back goes past it. A redirect route has no page, head or
  guard of its own.
- **`canEnter(route)`** gets the route about to load (its `pattern`, `params`, `searchParams`) and returns:
  - `true` to enter;
  - a path to go there instead, as a redirect;
  - `false` to stay on the page on screen: the address bar shows its URL again. On the first load there is no
    page on screen, so the `notFound` route is shown.

  It may be async; a navigation started while it runs wins, as for a slow chunk.
- Both paths are typed as `RoutePaths`: a path that is no route is a type error.
- A loop of redirects stops after 10 in a row, with an error in the console.

A production build leaves this step out of the router when no route has `canEnter` or `redirectTo` (the build
reads the route table); an app that uses them pays about 530 B raw, 185 B gzipped.

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

Parameters are decoded: `/users/ada%20lovelace` gives `id` the value `ada lovelace`. A segment that is not valid percent-encoding (`/users/100%`) is kept as written.

## Search Parameters

A route declares the query parameters its page reads in a `search` schema: each name with a parser. The page
reads the parsed values on `route.search`, typed from the schema.

```typescript
import { defineRoutes, searchFlag, searchNumber, searchOneOf, searchString } from 'thane/router';

'/products': {
  component: () => import('./pages/products.js'),
  search: {
    page: searchNumber(1), // number: 1 when missing or not a number
    q: searchString(), // string | undefined
    sale: searchFlag(), // boolean: true for ?sale or ?sale=1
    sort: searchOneOf(['price', 'name'], 'name'), // 'price' | 'name'
    tags: (raw): string[] => raw?.split(',') ?? [], // any parser: typed from its return type annotation
  },
},

// pages/products.ts: /products?page=2&sort=price
const { page, sort } = route!.search; // 2, 'price'
```

| Helper                        | Value                                                                |
| :---------------------------- | :------------------------------------------------------------------- |
| `searchString(fallback?)`     | the value, or `fallback` when the URL has none                       |
| `searchNumber(fallback?)`     | the value as a number, or `fallback` when missing or not a number    |
| `searchFlag()`                | `true` when present, `false` when missing, `0` or `false`            |
| `searchOneOf(values, fallback?)` | one of `values`, or `fallback` for anything else                  |

A parser gets the raw value, or `undefined` when the URL has none; any function of that shape works. Without a
fallback, a helper's value may be `undefined`. `route.searchParams` still holds every query parameter, raw.

`href()` and `navigate()` take the declared values next to the path parameters and write them into the query:

```typescript
href('/products', { page: 2, sale: true }); // '/products?page=2&sale='
navigate('/users/:id', { id: user.id, tab: 'posts' }); // if /users/:id declares tab
```

A flag that is on is written as its bare name, and one that is off, or a value that is `undefined`, is left
out. A value the schema does not declare is a type error. A production build leaves the parsing and the writing
out when no route has a `search` schema.

## Route Context

Every component has access to route context via `ctx.route`:

| Property       | Type                     | Description                                |
| :------------- | :----------------------- | :----------------------------------------- |
| `path`         | `string`                 | Current URL pathname                       |
| `pattern`      | `string`                 | Matched route pattern (e.g., `/users/:id`) |
| `params`       | `Record<string, string>` | Extracted route parameters                 |
| `searchParams` | `URLSearchParams`        | URL query parameters                       |
| `search`       | typed from the schema    | The route's [search parameters](#search-parameters), parsed |
| `hash`         | `string`                 | URL hash fragment                          |
| `title`        | `string`                 | The document title the route's head set    |
| `state`        | `unknown`                | History state object                       |
| `error`        | `unknown`                | On the error route: what failed            |

The context is captured when the route mounts. A navigation that changes the pathname or the query mounts the route again, so a fresh instance reads the new `params` and `searchParams`; a navigation that changes only the hash keeps the current instance, and `hash` is not updated on it.

## Route Heads

A route's `meta` sets the document head while the route is active: the title, the description, the
link-preview image, the canonical link and more. The Open Graph and Twitter tags that search engines and
link previews read are derived from them, so a route states each fact once.

```typescript
import { defineRoutes, metaName } from 'thane/router';

const Routes = defineRoutes(
  {
    '/': { component: () => import('./pages/home.js').then((m) => m.HomePage) },
    '/about': {
      component: () => import('./pages/about.js').then((m) => m.AboutPage),
      meta: { title: 'About', description: 'Who we are', image: '/og/about.png', author: 'Ada Lovelace' },
    },
    '/users/:id': {
      component: () => import('./pages/user.js').then((m) => m.UserPage),
      meta: (route) => ({ title: `User ${route.params.id}` }),
    },
    notFound: { component: () => import('./pages/404.js').then((m) => m.NotFound), meta: { title: 'Not found', robots: 'noindex' } },
  },
  {
    // The site: its address, a title template, and the default of every field
    meta: {
      siteUrl: 'https://example.com',
      title: 'Example',
      titleTemplate: '%s | Example',
      description: 'Everything about Example',
      image: '/og/default.png',
      siteName: 'Example',
      twitter: { site: '@example' },
    },
    // The app's own fields (see Custom Fields)
    customMeta: { author: metaName('author') },
  },
);
```

A route's fields override the site's one by one (the Twitter handles too). A route without a title shows the
site's `title` as it is; a route with one shows it through `titleTemplate` (`'%s | Example'`, or a function of
the title). A route with parameters can compute its fields from the route, as `/users/:id` does above.

| Field         | Type                                      | Tags                                                                       |
| :------------ | :---------------------------------------- | :------------------------------------------------------------------------- |
| `title`       | `string`                                  | `document.title`, `og:title`, `twitter:title`                              |
| `description` | `string`                                  | `<meta name="description">`, `og:description`, `twitter:description`       |
| `image`       | `string` \| `{ url, alt, width, height, type }` | `og:image` (with `:alt`, `:width`, `:height`, `:type`), `twitter:image`, `twitter:image:alt` |
| `canonical`   | `string` \| `false`                       | `<link rel="canonical">` and `og:url`; defaults to `siteUrl` and the path   |
| `robots`      | `string`                                  | `<meta name="robots">`, such as `'noindex, nofollow'`                      |
| `type`        | `string`                                  | `og:type`, `'website'` unless set                                          |
| `siteName`    | `string`                                  | `og:site_name`                                                             |
| `locale`      | `string`                                  | `og:locale`, such as `'en_ZA'`                                             |
| `twitter`     | `{ card, site, creator }`                 | `twitter:card` (`summary_large_image` when there is an image, else `summary`), `twitter:site`, `twitter:creator` |
| `jsonLd`      | `object` \| `object[]`                    | one `<script type="application/ld+json">`                                  |

The site's `meta` also takes `siteUrl` (canonical links, `og:url`, and image paths that start with `/` are
made absolute with it), `titleTemplate`, and `trailingSlash`: canonical URLs are written without a slash at the
end (`https://example.com/about`) however the page was reached, or with one when `trailingSlash` is `true`.

An app whose routes set nothing but titles gets the title alone, as before: no other tag is added.

### Data that arrives later

A page whose head depends on data it fetches sets it with `setMeta()` once the data is there. The fields go
over the route's own and hold until the next route loads:

```typescript
import { setMeta } from 'thane/router';

const product = await loadProduct(route.params.id);
setMeta({ title: product.name, description: product.summary, image: product.photo });
```

### Custom Fields

`customMeta` declares the app's own head fields, each once. Routes, the site's `meta` and `setMeta()` then
accept them, typed:

```typescript
import { defineRoutes, linkTag, metaName, metaProperty } from 'thane/router';

defineRoutes(routes, {
  customMeta: {
    author: metaName('author'), // <meta name="author" content="…">
    fbAppId: metaProperty('fb:app_id'), // <meta property="fb:app_id" content="…">
    feed: linkTag('alternate', { type: 'application/rss+xml' }), // <link rel="alternate" type="…" href="…">
    // anything else: a function from the value to the tags it stands for
    hreflang: (langs: Record<string, string>) =>
      Object.entries(langs).map(([hreflang, href]) => ({ link: { rel: 'alternate', hreflang, href } })),
  },
});

// a route
meta: { title: 'About', author: 'Ada Lovelace', hreflang: { af: '/af/about', en: '/about' } }
```

A helper field takes a string. A function field takes what its parameter's type says, and returns one tag or
several (`{ meta: { … } }`, `{ link: { … } }` or `{ script: { type, text } }`), or nothing. `setMeta()` knows the
custom fields through the generated route types; a function's parameter type must be one the generated file can
name (a built-in type, an imported one, or one the routes file exports), or `setMeta()` takes that field as
`unknown`.

### How the head is written

- **In the browser**, on every navigation, the router updates each tag in place: a tag is the same tag on the
  next page when its kind and every attribute but its value match (`meta[name="description"]`,
  `link[rel="alternate"][hreflang="af"]`). A tag with that key in `index.html` is taken over, never duplicated.
  A tag the previous page had and this one does not is removed.
- **In a production build**, every route without parameters also gets its own page, `about/index.html` for
  `/about`, with its head already written, for crawlers and link-preview bots that do not run JavaScript. The
  root `index.html` gets the head of `/`. The build reads the values from the source: literals, template
  strings, objects and arrays, and `const` names in the routes file or imported from the project. A meta
  function, and a custom field defined by a function, are applied in the browser only (`--verbose` lists them).
  Hosts serve `about/index.html` for `/about`, and many redirect `/about` to `/about/`; the router matches a
  path with a trailing slash to its route, and `thane serve --prod` serves the page for both.
- **Size.** The head renderer is about 1 KB gzipped. A production build leaves it out when the routes use no
  field but `title` and nothing calls `setMeta()`.

## Code Splitting

Use dynamic `import()` for lazy-loaded route components. Each page becomes a separate chunk:

```typescript
const Routes = defineRoutes({
  '/': { component: () => import('./pages/home.js') },
  '/settings': { component: () => import('./pages/settings.js') },
  'notFound': { component: () => import('./pages/404.js') },
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

### What happens while a page loads

The URL and `currentPath()` change as soon as a navigation starts, so an active link updates at once. The page on screen stays mounted until the next page's component has arrived; the two are then swapped, and the scroll position is set, in a single step. The outlet is never painted empty, whether the chunk takes two seconds or is already cached.

- **A newer navigation cancels an older one.** If the user clicks another link while a chunk is still loading, only the latest page mounts; the overtaken one never appears.
- **Going back to the page on screen keeps it.** If the user returns (back button, or the same link) before the next page has arrived, the load is cancelled and the current page is not re-created, so its state survives.
- **A chunk that fails to load**, or a page component that throws while it mounts, is reported with `console.error`, and the error route is shown in its place (the outlet is left empty without one). The router stays usable and other pages still load. Browsers remember a failed module import for the life of the document, so that one page needs a reload to recover.

### The Error Route

An `error` route next to `notFound` is shown when a page's chunk fails to load (the network dropped, a deploy replaced the chunk) or its component throws while mounting. The URL stays the failed page's; the error route's head applies, and its page receives what failed as `route.error`:

```typescript
// routes.ts
error: { component: () => import('./pages/error.js'), meta: { title: 'Something went wrong' } },

// pages/error.ts
export const ErrorPage = defineComponent('error-page', ({ route }) => {
  const message = route!.error instanceof Error ? route!.error.message : String(route!.error);
  return {
    template: html`<p>${message}</p><button @click=${() => location.reload()}>Reload</button>`,
  };
});
```

A reload is the way back from a failed chunk, because the browser keeps the failed import. `error` is not a path: `navigate('error')` is a type error, and a build writes no page for it.

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
      resetOnNavigate: true, // scroll to top on navigate() — default: true
      restoreOnBackForward: true, // restore position on back/forward — default: true
      behavior: 'auto', // 'auto' | 'smooth' — default: 'auto'
      top: 0, // reset top offset — default: 0
      left: 0, // reset left offset — default: 0
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
4. Type the patterns and parameters of `href()` and `navigate(pattern, params)`

The types are generated at the start of every build, and by `thane types`, from your `defineRoutes()` call. A project with several route tables, such as two apps that share one `tsconfig.json`, gets one entry per table, keyed by its file: `navigate()` accepts the paths of all of them. Include `.thane/types` in your `tsconfig.json` so your editor sees them (see [Getting Started](getting-started.md#installation)).

To type a variable or prop that holds a navigation target, use `RoutePaths`:

```typescript
import type { RoutePaths } from 'thane';

const backTo: RoutePaths = '/my-cart';
navigate(backTo);
```

## Full Example — E-Commerce Shell

```typescript
// routes.ts
import { defineRoutes } from 'thane/router';

const Routes = defineRoutes({
  '/': { component: () => import('./pages/Products/Products.js'), meta: { title: 'Products' } },
  '/my-cart': { component: () => import('./pages/Cart/Cart.js'), meta: { title: 'My Cart' } },
  '/product-details/:productID': {
    component: () => import('./pages/ProductDetails/ProductDetails.js'),
    meta: { title: 'Product Details' },
  },
  'notFound': { component: () => import('./pages/NotFound/NotFound.js'), meta: { title: 'Not Found' } },
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
    ${Navbar()}
    <div id="router-outlet"></div>
  `,
  styles: appStyles,
}));
```

← [Back to Docs](README.md)
