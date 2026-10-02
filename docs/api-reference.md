# API Reference

Complete API surface for the Thane framework, covering all public exports, the template markers, the router globals, and types.

## Package Exports

| Entry           | What it holds                                                                                              |
| :-------------- | :--------------------------------------------------------------------------------------------------------- |
| `thane`         | Signals, components, mounting, global styles, the template markers, and the types an app writes in its own code |
| `thane/router`  | `defineRoutes`, `navigate`, `navigateBack`, `href`, `setMeta`, and the head-field helpers `metaName`, `metaProperty`, `linkTag` |
| `thane/client`  | Type declarations for `.css` imports, which `thane` includes (see below)                                   |
| `thane/runtime` | The helpers that compiled code calls. Only the compiler imports it: never import it in an app. It is not an API and changes with every version |
| `thane/runtime/dom` | Node's `cloneNode` and `insertBefore`, for compiled lists. Only compiled code imports it |
| `thane/ts-plugin` | The TypeScript plugin for the editor ([Event Handling](event-handling.md#in-the-editor)) |

### `thane` (main entry)

#### Reactive Primitives

| Export     | Signature                                                                 | Description                                                                      |
| :--------- | :------------------------------------------------------------------------ | :------------------------------------------------------------------------------- |
| `signal`   | `<T>(initialValue: T) => Signal<T>`                                       | Create a reactive signal                                                         |
| `computed` | `<T>(derivation: () => T) => ReadonlySignal<T> & { dispose: () => void }` | Create a derived signal that auto-tracks dependencies; one created in a setup is disposed with its component |
| `effect`   | `(fn: () => void \| (() => void)) => () => void`                         | Create a side-effect that re-runs on dependency change. Returns dispose function; `fn` may return a cleanup, run before each re-run and on dispose |
| `onCleanup` | `(fn: () => void) => void`                                               | Run `fn` when what is running ends: the component whose setup or `onMount` calls it, when it is destroyed; the effect whose run calls it, before its next run |
| `batch`    | `(fn: () => void) => void`                                                | Batch multiple signal updates — each changed signal notifies once, after `fn`    |
| `untrack`  | `<T>(fn: () => T) => T`                                                   | Read signals without creating dependencies                                       |

#### Component API

| Export                 | Signature                                                          | Description                               |
| :--------------------- | :----------------------------------------------------------------- | :---------------------------------------- |
| `defineComponent`      | `<P>(setup: (ctx: ComponentContext<P>) => ComponentReturnType) => ComponentHTMLSelector<P>`                   | Define a component                        |
| `defineComponent`      | `<P>(selector: string, setup: (ctx: ComponentContext<P>) => ComponentReturnType) => ComponentHTMLSelector<P>` | Define a component with explicit selector |
| `mount`                | `(options: MountOptions) => MountHandle`                           | Mount a component to the DOM              |
| `unmount`              | `(handle: MountHandle) => void`                                    | Destroy a mounted component               |
| `registerGlobalStyles` | `(...styles: string[]) => void`                                    | Register global styles (deduplicated)     |

`ComponentReturnType` and `MountOptions` are described under [Shapes You Pass In](#shapes-you-pass-in).

#### Template Markers

`import { html, css, when, repeat } from 'thane'`. The compiler turns each use into DOM code at build time, so none of them reaches the bundle. It finds them by name: import them under their own names (THANE413). Called at run time, outside a compiled template, each one throws.

| Export     | Signature                                                                                                                                                                         | Description                                  |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------- |
| `html`     | `(strings: TemplateStringsArray, ...values: any[]) => Fragment`                                                                                                                   | Tagged template for HTML content             |
| `css`      | `(strings: TemplateStringsArray, ...values: any[]) => any`                                                                                                                        | Tagged template for CSS content              |
| `when`     | `<T>(condition: T) => string`: in an element's tag, `<p ${when(open())}>`                                                                                                        | Show the element while the condition is truthy |
| `when`     | `<T>(value: T, then: Fragment \| ((value: Truthy<T>) => Fragment), otherwise?: Fragment) => Fragment`: in content                                                                 | Show `then` while the value is truthy, `otherwise` (or nothing) while it is not |
| `repeat`   | `<T>(items: readonly T[], row: (item: T, index: number) => Fragment, options?: { key?: keyof T \| ((item: T, index: number) => string \| number); empty?: Fragment }) => Fragment` | List rendering with keyed reconciliation     |

A condition is not a function: pass a signal's value, `when(open())`, not the signal. `repeat()`'s options are written in the call (THANE010); its key is the name of a property whose values are strings or numbers, or a function of the item. A directive's templates may also be plain template literals of markup; a component's `template` is an `html` template.

### `thane/router` (subpath export)

| Export         | Signature                                               | Description                                                              |
| :------------- | :------------------------------------------------------ | :----------------------------------------------------------------------- |
| `defineRoutes` | `(routes: { [pattern: string]: Route; notFound: Route; error?: Route }, options?: RouterOptions) => typeof routes` | Define the route map with type-safe keys; required before `mount()` with a `router` option. `options` gives the site's head and the app's own head fields ([Route Heads](routing.md#route-heads)) |
| `navigate`     | `(path: RoutePaths) => void`, `(pattern, params) => void` | Navigate to a path, or to a route pattern with its parameters filled in (also available as a global) |
| `href`         | `(pattern, params) => RoutePaths`                       | A route pattern's path with its parameters filled in, URL-encoded: `href('/users/:id', { id: 7 })` is `/users/7`; the route's search values go into the query |
| `searchString`, `searchNumber`, `searchFlag`, `searchOneOf` | `(…) => SearchParser<T>` | Parsers for a route's `search` schema ([Search Parameters](routing.md#search-parameters)) |
| `navigateBack` | `() => void`                                            | Navigate back in browser history (also available as a global)            |
| `setMeta`      | `(meta: AppRouteMeta) => void`                          | Set head fields of the page on screen, until the next route loads         |
| `metaName`     | `(name: string) => CustomMetaField<string>`             | A custom head field for `<meta name="…">`                                |
| `metaProperty` | `(property: string) => CustomMetaField<string>`         | A custom head field for `<meta property="…">`                            |
| `linkTag`      | `(rel: string, attributes?: Record<string, string>) => CustomMetaField<string>` | A custom head field for `<link rel="…" href="…">`       |

Its types: `RouteMeta` (the built-in head fields), `SiteMeta` (those and `siteUrl`, `titleTemplate`), `RouteImage`,
`HeadTag`, `CustomMetaField`, and `AppRouteMeta` (the built-in fields and the app's own, as `setMeta()` takes them).

### `thane/runtime`

The entry that compiled code imports its helpers from (`__registerComponent`, `__bindIf`, `createKeyedReconciler` and the others). An app never imports it, and nothing in it is covered by the version's API: helpers change whenever the compiler's output does.

---

## Router Globals

The router installs these as globals when it starts, so a template calls them without an import. `navigate` and `navigateBack` are also exported from `thane/router`.

| Global         | Signature                | Description                                               |
| :------------- | :----------------------- | :-------------------------------------------------------- |
| `navigate`     | `(path: RoutePaths) => void`, `(pattern, params) => void` | Navigate to a path, or to a route pattern with its parameters (type-safe when routes are registered) |
| `navigateBack` | `() => void`             | Navigate back in browser history                          |
| `currentPath`  | `ReadonlySignal<string>` | Read-only signal with the current pathname                |

---

## Types

`thane` exports these types for an app to write in its own code:

| Type                       | Use it for                                                                                  |
| :------------------------- | :------------------------------------------------------------------------------------------ |
| `Signal<T>`                | A read/write signal: component fields, signal props, service state                          |
| `ReadonlySignal<T>`        | A signal that others may only read, such as state a service owns and exposes                |
| `ComponentContext<P>`      | The setup function's parameter, for example in a helper shared by several setup functions  |
| `ComponentHTMLSelector<P>` | What `defineComponent()` returns: a parameter that receives a component to `mount()`        |
| `Fragment`                 | An `html` template as a value: a fragment a module exports, a prop that holds one           |
| `MountHandle`              | The result of `mount()`, kept to destroy the component later                                |
| `RoutePaths`               | A variable or prop that holds a navigation target                                           |

```typescript
import type {
  Signal,
  ReadonlySignal,
  ComponentContext,
  ComponentHTMLSelector,
  Fragment,
  MountHandle,
  RoutePaths,
} from 'thane';
```

### Core Types

```typescript
type ReadonlySignal<T> = {
  (): T; // Read only
  subscribe: (callback: (value: T) => void, skipInitial?: boolean) => () => void;
};

type Signal<T> = ReadonlySignal<T> & {
  (newValue: T): T; // Write
};
```

### Component Types

```typescript
interface ComponentContext<P = {}, S extends string = string> {
  root: HTMLElement; // Host DOM element
  props: Readonly<P>; // Component props
  route?: RouteContextForSelector<S>; // Route context (when mounted by the router)
}

// Calling a component in a template gives a Fragment
type ComponentHTMLSelector<P> = (props: P) => Fragment;

// An html template, a child component call or a directive: it has no members
interface Fragment {}

interface MountHandle {
  root: HTMLElement; // Host element
  destroy: () => void; // Teardown
}
```

### `RoutePaths`

The paths `navigate()` accepts. Before Thane has generated the route types (any `thane` command does), it is `string`. After that it is the union of the app's route patterns, with each `:param` segment written as `${string}`:

```typescript
// Routes '/', '/about' and '/users/:id'
type RoutePaths = '/' | '/about' | `/users/${string}`;
```

---

## Shapes You Pass In

The objects below are typed where you write them — TypeScript infers them, and editors show them in hovers under these names — but they are not exported. An app does not need to import them.

### Setup Return Object (`ComponentReturnType`)

```typescript
type ComponentReturnType = {
  template?: Fragment; // html`` template
  styles?: string; // css`` template or an imported .css file
  onMount?: () => void;
  onDestroy?: () => void;
};
```

A setup function returns one such object (THANE412).

### Mount Options (`MountOptions`)

```typescript
interface MountOptions {
  component?: ComponentHTMLSelector<any>; // Component to mount
  target?: HTMLElement; // Default: document.body
  props?: Record<string, any>; // Root component props
  router?: RouterConfig; // Router configuration
}
```

### Router Options

```typescript
interface Route {
  component: (() => Promise<any>) | ComponentHTMLSelector<any>; // Lazy or eager component
  meta?: RouteMeta | ((route: UntypedRouteContext) => RouteMeta); // The document head (routing.md, Route Heads)
}

interface RouterOptions {
  meta?: SiteMeta; // siteUrl, titleTemplate, and the default of every head field
  customMeta?: Record<string, CustomMetaField>; // The app's own head fields
}

interface RouterConfig {
  routes: { [pattern: string]: Route; notFound: Route; error?: Route }; // From defineRoutes()
  outletId?: `router-${string}`; // Default: 'router-outlet'
  scrollRestoration?: boolean | ScrollRestorationConfig; // Default: enabled
}

interface ScrollRestorationConfig {
  behavior?: ScrollBehavior; // 'auto' | 'smooth'
  left?: number; // Reset left offset
  top?: number; // Reset top offset
  resetOnNavigate?: boolean; // Default: true
  restoreOnBackForward?: boolean; // Default: true
}
```

### Route Context

What `ctx.route` holds in a routed page. Before route types are generated it is this untyped form; after that, `pattern`, `path` and `params` are typed per page from its route pattern:

```typescript
interface UntypedRouteContext {
  readonly path: string;
  readonly pattern: string;
  readonly params: Record<string, string>;
  readonly searchParams: URLSearchParams;
  readonly hash: string;
  readonly title: string;
  readonly state: unknown;
}
```

---

## CSS Module Declaration

`thane` includes the type declarations for CSS file imports, from its `client.d.ts`:

```typescript
// client.d.ts
declare module '*.css' {
  const css: string;
  export default css;
}
```

A project needs no `tsconfig.json` entry for them. The `thane/client` subpath is the same file: a project that lists
`"types": ["thane/client"]` keeps working, with the declaration once.

← [Back to Docs](README.md)
