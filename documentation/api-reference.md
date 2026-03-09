# API Reference

Complete API surface for the Thane framework, covering all public exports, global template functions, and types.

## Package Exports

### `thane` (main entry)

#### Reactive Primitives

| Export | Signature | Description |
|:-------|:----------|:------------|
| `signal` | `<T>(initialValue: T) => Signal<T>` | Create a reactive signal |
| `computed` | `<T>(derivation: () => T) => ReadonlySignal<T> & { dispose: () => void }` | Create a derived signal that auto-tracks dependencies |
| `effect` | `(fn: () => void) => () => void` | Create a side-effect that re-runs on dependency change. Returns dispose function |
| `batch` | `(fn: () => void) => void` | Batch multiple signal updates — notifications fire once after |
| `untrack` | `<T>(fn: () => T) => T` | Read signals without creating dependencies |

#### Component API

| Export | Signature | Description |
|:-------|:----------|:------------|
| `defineComponent` | `<P>(setup: SetupFunction<P>) => ComponentHTMLSelector<P>` | Define a component |
| `defineComponent` | `<P>(selector: string, setup: SetupFunction<P>) => ComponentHTMLSelector<P>` | Define a component with explicit selector |
| `mount` | `(options: MountOptions) => MountHandle` | Mount a component to the DOM |
| `unmount` | `(handle: MountHandle) => void` | Destroy a mounted component |
| `registerGlobalStyles` | `(...styles: string[]) => void` | Register global styles (deduplicated) |

### `thane/router` (subpath export)

| Export | Signature | Description |
|:-------|:----------|:------------|
| `defineRoutes` | `<T extends RoutesConfig>(routes: T) => RegisteredRoutes<keyof T & string>` | Define the route map with type-safe keys |

---

## Global Template Functions

These are available globally inside `html` tagged templates. The compiler transforms them at build time — they do not exist as runtime values you import.

| Function | Signature | Description |
|:---------|:----------|:------------|
| `html` | `` (strings: TemplateStringsArray, ...values: any[]) => any `` | Tagged template for HTML content |
| `css` | `` (strings: TemplateStringsArray, ...values: any[]) => any `` | Tagged template for CSS content |
| `when` | `(condition: boolean) => string` | Conditional rendering — show/hide an element |
| `whenElse` | `<T, F>(condition: boolean, thenTemplate: T, elseTemplate: F) => T \| F` | If/else conditional rendering |
| `repeat` | `<T>(items: T[], templateFn: (item: T, index: number) => any, emptyTemplate?: any, trackBy?: (item: T, index: number) => string \| number) => any[]` | List rendering with keyed reconciliation |
| `navigate` | `(path: RoutePaths) => void` | Navigate to a path (type-safe when routes are registered) |
| `navigateBack` | `() => void` | Navigate back in browser history |
| `currentPath` | `ReadonlySignal<string>` | Read-only signal with the current pathname |

---

## Types

### Core Types

```typescript
type Signal<T> = {
  (): T;                // Read
  (newValue: T): T;     // Write
  subscribe: (callback: (value: T) => void, skipInitial?: boolean) => () => void;
};

type ReadonlySignal<T> = {
  (): T;                // Read only
  subscribe: (callback: (value: T) => void, skipInitial?: boolean) => () => void;
};

type ComponentRoot = HTMLElement;
```

### Component Types

```typescript
interface ComponentContext<P = {}, S extends string = string> {
  root: ComponentRoot;              // Host DOM element
  props: Readonly<P>;                // Component props
  route: RouteContextForSelector<S>; // Route context (when using router)
}

type ComponentReturnType = {
  template?: string;
  styles?: string;
  onMount?: (() => void) | undefined;
  onDestroy?: (() => void) | undefined;
};

type ComponentHTMLSelector<P> = (props: P) => string;
```

### Mount Types

```typescript
interface MountOptions {
  component?: ComponentHTMLSelector<any>;  // Component to mount
  target?: HTMLElement;                     // Default: document.body
  props?: Record<string, any>;             // Root component props
  router?: RouterConfig;                   // Router configuration
}

interface MountHandle {
  root: ComponentRoot;   // Host element
  destroy: () => void;   // Teardown
}
```

### Router Types

```typescript
interface Route {
  component: RouteComponent;      // Lazy or eager component
  title?: string;                  // Document title
}

type RouteComponent = LazyRouteComponent | EagerRouteComponent;
type LazyRouteComponent = () => Promise<any>;
type EagerRouteComponent = ComponentHTMLSelector<any>;

type RoutesConfig = Record<string, Route> & { notFound: Route };

interface RouterConfig {
  routes: RoutesConfig;
  outletId?: `router-${string}`;                        // Default: 'router-outlet'
  scrollRestoration?: boolean | ScrollRestorationConfig;  // Default: enabled
}

interface ScrollRestorationConfig {
  behavior?: ScrollBehavior;       // 'auto' | 'smooth'
  left?: number;                   // Reset left offset
  top?: number;                    // Reset top offset
  resetOnNavigate?: boolean;       // Default: true
  restoreOnBackForward?: boolean;  // Default: true
}
```

### Route Context

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

### Type-Safe Route Utilities

```typescript
// Converts route pattern to navigable path type
type RouteToPath<T extends string> = ...;  // e.g., '/users/:id' → `/users/${string}`

// Extracts parameter names from route patterns
type ExtractRouteParams<T extends string> = ...; // e.g., '/users/:id' → 'id'

// Maps params to an object type
type RouteParamsObject<T extends string> = { readonly [K in ExtractRouteParams<T>]: string };
```

---

## CSS Module Declaration

The `thane/client` subpath provides type declarations for CSS file imports:

```typescript
// client.d.ts
declare module '*.css' {
  const css: string;
  export default css;
}
```

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["thane/client"]
  }
}
```

← [Back to Docs](README.md)
