/**
 * Router runtime — single-instance client-side router for Thane.
 *
 * Fully tree-shakable: apps that don't import any router symbols pay zero cost.
 * The router mounts in one of two ways:
 *
 *   mount(Shell, { routes }) — a shell component whose template has a `<router-outlet>` element: page
 *      components are rendered inside it.
 *
 *   mount(Routes) — no shell: page components are rendered directly into `document.body` (or the
 *      `target` element).
 *
 * Hash-stability guarantees:
 *   • navigate / navigateBack are generic functions with zero
 *     knowledge of user routes — they live in the thane shared chunk.
 *   • The ROUTES map is only imported by the file that calls mount(), so changing
 *     a single page only invalidates that page's chunk.
 *   • Route typing is updated by hidden generated .d.ts files during normal
 *     Thane commands, so page components can read `route.params` locally.
 */

import type { MountHandle, ComponentHTMLSelector } from './component.js';
import { mountComponent, unmount, __setRouteContextProvider, __setRouterMount } from './component.js';
import type { MountOptions } from './component.js';
import { signal } from './signal.js';
import type { ReadonlySignal, Signal } from './types.js';
import { applyHead, resolveHead } from './router-head.js';
import type { CustomMetaFields, CustomMetaValues, RouteMeta, SiteMeta } from './router-head.js';
import type { SearchSchema } from './router-search.js';

/**
 * False in a production build of an app whose routes use no head field but `title` (the build reads
 * them): the head renderer is then left out. Undefined everywhere else, which keeps it.
 */
declare const __THANE_HEAD__: boolean | undefined;
/**
 * False in a production build of an app whose routes have no `canEnter` and no `redirectTo` (the build
 * reads them): the guard and redirect step is then left out. Undefined everywhere else, which keeps it.
 */
declare const __THANE_GUARDS__: boolean | undefined;
/**
 * False in a production build of an app with no plain link (an `<a href>` without its own click
 * handler) in its templates or its index.html: the router's link handling is then left out.
 */
declare const __THANE_LINKS__: boolean | undefined;
/**
 * False in a production build of an app whose routes have no `search` schema: parsing `route.search` and
 * writing search values into a path are then left out.
 */
declare const __THANE_SEARCH__: boolean | undefined;

// ─────────────────────────────────────────────────────────────
//  Route type registry — augmented by generated files
// ─────────────────────────────────────────────────────────────

/**
 * The hidden files that `thane build`, `dev`, `serve` and `types` generate in
 * `.thane/types` add one entry per route table to `RouteTables`, keyed by the table's file:
 * its paths, its custom head fields, and the route pattern of each page component's selector.
 * That makes `navigate()`, `RoutePaths`, `setMeta()` and a page's `ctx.route` type-safe. Two
 * tables in one program (two apps that share a tsconfig) add up. `Register` and
 * `RouteComponentRegister` take the same information written by hand.
 */
declare global {
  namespace ThaneTypeRegistry {
    interface RouteTables {}
    interface Register {}
    interface RouteComponentRegister {}
  }
}

// ─────────────────────────────────────────────────────────────
//  Type-safe route path utilities
// ─────────────────────────────────────────────────────────────

/**
 * Converts a route pattern like `/users/:id/posts/:postId` into
 * a template literal type `/users/${string}/posts/${string}`.
 * Static routes like `/about` remain exact literal types.
 */
export type RouteToPath<T extends string> = T extends `${infer Before}:${infer _Param}/${infer After}`
  ? `${Before}${string}/${RouteToPath<After>}`
  : T extends `${infer Before}:${infer _Param}`
    ? `${Before}${string}`
    : T;

/** Exclude the special `notFound` and `error` keys when computing navigable paths / params. */
type RouteKeys<T> = Exclude<keyof T & string, 'notFound' | 'error'>;

/** Extracts all parameter names from all route patterns. */
type ExtractParams<T extends string> = T extends `${string}:${infer Param}/${infer Rest}`
  ? Param | ExtractParams<Rest>
  : T extends `${string}:${infer Param}`
    ? Param
    : never;

export type ExtractRouteParams<T extends string> = ExtractParams<T>;

declare const ROUTE_PATHS: unique symbol;

type RouteMetadata<T extends Record<string, any>> = {
  readonly [ROUTE_PATHS]?: RouteKeys<T>;
};

type RegisteredRoutePaths<T extends Record<string, any>> = T extends { readonly [ROUTE_PATHS]?: infer P extends string }
  ? P
  : RouteKeys<T>;

type EffectiveRegister = ThaneTypeRegistry.Register;
type EffectiveRouteComponentRegister = ThaneTypeRegistry.RouteComponentRegister;

/** Every generated route table's entry, as a union (never when there is none) */
type RouteTableEntry = ThaneTypeRegistry.RouteTables[keyof ThaneTypeRegistry.RouteTables];
type TablePaths<T> = T extends { routePaths: infer P extends string } ? P : never;

type ExplicitRegisterRoutePaths = EffectiveRegister extends { routePaths: infer P extends string } ? P : never;
type ExplicitRegisterRouteParamNames = EffectiveRegister extends { routeParamNames: infer P extends string }
  ? P
  : never;
type HandRegisteredRoutePatterns = [ExplicitRegisterRoutePaths] extends [never]
  ? EffectiveRegister extends { routes: infer R extends Record<string, any> }
    ? RegisteredRoutePaths<R>
    : never
  : ExplicitRegisterRoutePaths;
type RegisteredRoutePatterns = TablePaths<RouteTableEntry> | HandRegisteredRoutePatterns;

/** A path, and the same path with a query or a hash */
type WithQuery<T extends string> = T | `${T}?${string}` | `${T}#${string}`;

/** Resolves to the navigable path union when Register is augmented, else `string`. */
export type RoutePaths = [RegisteredRoutePatterns] extends [never]
  ? string
  : WithQuery<RouteToPath<RegisteredRoutePatterns>>;

/** Every table's search types, by pattern */
type TableSearch<T> = T extends { search: infer S } ? S : never;
type PatternSearch<S, P extends string> = S extends unknown ? (P extends keyof S ? S[P] : never) : never;
type SearchPatterns =
  TableSearch<RouteTableEntry> extends infer S ? (S extends unknown ? keyof S & string : never) : never;

/** What a page of the route reads on `route.search`, from the route's `search` schema; `{}` without one */
export type RouteSearchValues<P extends string> = [PatternSearch<TableSearch<RouteTableEntry>, P>] extends [never]
  ? {}
  : Readonly<PatternSearch<TableSearch<RouteTableEntry>, P>>;

/** The search values `href()` and `navigate()` take for a route: any of its schema's, each optional */
type RouteSearchInput<P extends string> = [RegisteredRoutePatterns] extends [never]
  ? { readonly [key: string]: string | number | boolean | undefined }
  : { readonly [K in keyof RouteSearchValues<P>]?: Exclude<RouteSearchValues<P>[K], undefined> };

/**
 * The registered patterns that have parameters (`/users/:id`) or a search schema, else `string`: what
 * `href()` takes.
 */
export type RoutePatternWithParams = [RegisteredRoutePatterns] extends [never]
  ? string
  : Extract<RegisteredRoutePatterns, `${string}:${string}`> | Extract<SearchPatterns, RegisteredRoutePatterns>;

/** A value for each of a pattern's parameters, `{ id: 7 }` for `/users/:id`, and any of its search values. */
export type RouteParamValues<P extends string> = {
  readonly [K in ExtractRouteParams<P>]: string | number;
} & RouteSearchInput<P>;

/** Resolves to the route param name union when Register is augmented, else `string`. */
export type RouteParamNames = [ExplicitRegisterRouteParamNames] extends [never]
  ? [RegisteredRoutePatterns] extends [never]
    ? string
    : ExtractRouteParams<RegisteredRoutePatterns>
  : ExplicitRegisterRouteParamNames;

export type RouteParamsObject<T extends string> = [ExtractRouteParams<T>] extends [never]
  ? Record<string, never>
  : { readonly [K in ExtractRouteParams<T>]: string };

/** The pattern a selector is mounted for in one table's components (never when it is not there) */
type PatternIn<C, S extends string> = C extends unknown ? (S extends keyof C ? Extract<C[S], string> : never) : never;
type TableComponents<T> = T extends { components: infer C } ? C : never;

type RegisteredRoutePatternForSelector<S extends string> =
  PatternIn<TableComponents<RouteTableEntry>, S> | PatternIn<EffectiveRouteComponentRegister, S>;

type RouteContextBase<
  TPattern extends string,
  TPath extends string,
  TParams,
  TSearch = Readonly<Record<string, unknown>>,
> = Readonly<{
  pattern: TPattern;
  path: TPath;
  params: TParams;
  searchParams: URLSearchParams;
  /** The query parameters the route's `search` schema declares, parsed */
  search: TSearch;
  hash: string;
  title: string;
  state: unknown;
}>;

type ResolvedRouteContext<TPattern extends string> = TPattern extends 'notFound'
  ? RouteContextBase<'notFound', string, Record<string, never>>
  : TPattern extends 'error'
    ? RouteContextBase<'error', string, Record<string, never>> & {
        /** What failed: the page's chunk did not load, or its component threw while mounting */
        readonly error: unknown;
      }
    : RouteContextBase<TPattern, RouteToPath<TPattern>, RouteParamsObject<TPattern>, RouteSearchValues<TPattern>>;

export interface UntypedRouteContext extends RouteContextBase<string, string, Record<string, string>> {
  /**
   * The route's parameters, untyped: the component is no route's page, or its route types are not generated yet
   * (every thane command generates them)
   */
  readonly params: Record<string, string>;
  /** On the error route: what failed */
  readonly error?: unknown;
}

export type RouteContextForSelector<S extends string> = [RegisteredRoutePatternForSelector<S>] extends [never]
  ? UntypedRouteContext
  : ResolvedRouteContext<RegisteredRoutePatternForSelector<S>>;

// ─────────────────────────────────────────────────────────────
//  Public types
// ─────────────────────────────────────────────────────────────

export type LazyRouteComponent = () => Promise<any>;
export type EagerRouteComponent = ComponentHTMLSelector<any>;
export type RouteComponent = LazyRouteComponent | EagerRouteComponent;

/** A route's head: its fields, or a function of the route that returns them (for a route with parameters) */
export type RouteMetaInput<M = RouteMeta> = M | ((route: UntypedRouteContext) => M);

/**
 * A single route definition.
 *
 * ```ts
 * const Routes = defineRoutes({
 *   '/':      { component: () => import('./pages/home.js'), meta: { title: 'Home' } },
 *   notFound: { component: () => import('./pages/404.js'), meta: { title: 'Not found', robots: 'noindex' } },
 * });
 * ```
 */
export type Route = PageRoute | RedirectRoute;

/** What a guard decides: `true` enters, a path goes there instead, `false` stays on the page on screen */
export type RouteGuardResult = boolean | RoutePaths;

/** A route that shows a page */
export interface PageRoute {
  /** Lazy loader or eager page component (return value of defineComponent). */
  component: RouteComponent;
  /** The document head while this route is active: its title, description, preview image and more */
  meta?: RouteMetaInput<RouteMeta & Record<string, unknown>> | undefined;
  /**
   * Decides, before the page is fetched, whether it may be entered: `true` enters, a path redirects
   * there (`'/login'`), `false` keeps the page on screen. It may be async.
   */
  canEnter?: ((route: UntypedRouteContext) => RouteGuardResult | Promise<RouteGuardResult>) | undefined;
  /**
   * The query parameters its page reads on `route.search`, each with its parser:
   * `{ page: searchNumber(1), sort: searchOneOf(['price', 'name'], 'name') }`.
   */
  search?: SearchSchema | undefined;
  redirectTo?: undefined;
}

/** A route that sends its path elsewhere, replacing the history entry: `'/old': { redirectTo: '/new' }` */
export interface RedirectRoute {
  /** The path to go to, or a function of the route that returns it (for a route with parameters) */
  redirectTo: RoutePaths | ((route: UntypedRouteContext) => RoutePaths);
  component?: undefined;
  meta?: undefined;
  canEnter?: undefined;
  search?: undefined;
}

/**
 * The second argument of `defineRoutes()`: the site's head, and the app's own head fields.
 *
 * ```ts
 * defineRoutes(routes, {
 *   meta: { siteUrl: 'https://example.com', titleTemplate: '%s | Example', description: '…' },
 *   customMeta: { author: metaName('author') },
 * });
 * ```
 */
export interface RouterOptions<C extends CustomMetaFields = {}> {
  /** The site's URL, the title template, and the default of every head field */
  meta?: (SiteMeta & CustomMetaValues<NoInfer<C>>) | undefined;
  /** The app's own head fields: `metaName('…')`, `metaProperty('…')`, `linkTag('…')`, or a function from the value to tags */
  customMeta?: C | undefined;
}

/**
 * A map of path patterns to Route objects.
 * Path params use `:param` syntax.  Root-level params (e.g. `/:slug`) are
 * forbidden — every route must start with a static segment.
 */
export type RoutesMap<T extends string = string> = Record<T, Route>;

/**
 * The return type of `defineRoutes()` — a routes map with a mandatory `notFound` route.
 */
export type RoutesConfig = Record<string, Route> & {
  notFound: Route;
  /** Shown when a page's chunk fails to load or its component throws while mounting, given the error */
  error?: Route;
};
type RouteRecordFromKeys<K extends string> = Record<Exclude<K, 'notFound' | 'error'>, Route> & {
  notFound: Route;
  error?: Route;
};
export type RegisteredRoutes<K extends string = string> = RouteRecordFromKeys<K> &
  RouteMetadata<RouteRecordFromKeys<K>>;

export interface ScrollRestorationConfig {
  /** Scroll behavior to use when applying restoration or reset. */
  behavior?: ScrollBehavior | undefined;
  /** Left offset used when resetting on programmatic navigation. */
  left?: number | undefined;
  /** Top offset used when resetting on programmatic navigation. */
  top?: number | undefined;
  /** Reset scroll on navigate(path). Defaults to true. */
  resetOnNavigate?: boolean | undefined;
  /** Restore saved positions on browser back/forward. Defaults to true. */
  restoreOnBackForward?: boolean | undefined;
}

/** What the router reads from `mount()`'s options */
interface RouterConfig {
  /** Enable or configure router-managed scroll restoration. Defaults to enabled. */
  scrollRestoration?: boolean | ScrollRestorationConfig | undefined;
}

// ─────────────────────────────────────────────────────────────
//  defineRoutes — identity helper that preserves literal keys
// ─────────────────────────────────────────────────────────────

/**
 * Validates route patterns at the type level: root-level params are disallowed.
 * `/:anything` is rejected — every route must begin with a static segment.
 * The special `notFound` key is exempt from path validation.
 */
type ValidateRoutes<T extends Record<string, Route>, C extends CustomMetaFields> = {
  [K in keyof T]: K extends 'notFound' | 'error'
    ? CheckRoute<T[K], C>
    : K extends `/:${string}`
      ? never
      : CheckRoute<T[K], C>;
};

/** Each head field a route sets, typed as the field is: a field that does not exist is `never` */
type CheckMeta<M, F> = { [K in keyof M]: K extends keyof F ? F[K] : never };
/** A route whose head fields are checked against the built-in and the custom ones */
type CheckRoute<R, C extends CustomMetaFields> = R extends { meta: infer M }
  ? M extends (route: UntypedRouteContext) => infer Out
    ? { meta: (route: UntypedRouteContext) => CheckMeta<Out, RouteMeta & CustomMetaValues<C>> }
    : { meta: CheckMeta<M, RouteMeta & CustomMetaValues<C>> }
  : unknown;

/**
 * Define the application's route map with type-safe keys.
 *
 * Includes route patterns mapped to `Route` objects plus a mandatory `notFound`
 * fallback route.  This is an identity function at runtime — its purpose is to
 * preserve literal string keys so that `navigate()` gets
 * full autocomplete and compile-time checking via the Register pattern.
 *
 * The second argument gives the site's head (its URL, a title template, and defaults for every
 * field) and the app's own head fields, which routes and `setMeta()` then accept, typed.
 *
 * ```ts
 * const Routes = defineRoutes(
 *   {
 *     '/':          { component: () => import('./pages/home.js') },
 *     '/about':     { component: () => import('./pages/about.js'), meta: { title: 'About', author: 'Ada' } },
 *     '/users/:id': { component: () => import('./pages/user.js'), meta: (route) => ({ title: `User ${route.params.id}` }) },
 *     notFound:     { component: () => import('./pages/not-found.js'), meta: { title: 'Not found', robots: 'noindex' } },
 *   },
 *   {
 *     meta: { siteUrl: 'https://example.com', title: 'Example', titleTemplate: '%s | Example', description: '…' },
 *     customMeta: { author: metaName('author') },
 *   },
 * );
 * ```
 *
 * @throws {Error} At runtime if any route key is a root-level param (`/:...`).
 */
export function defineRoutes<const T extends RoutesConfig, const C extends CustomMetaFields = {}>(
  routes: ValidateRoutes<T, NoInfer<C>> & T,
  options?: RouterOptions<C>,
): RegisteredRoutes<keyof T & string> {
  if (typeof __THANE_HEAD__ === 'undefined' || __THANE_HEAD__) {
    _siteMeta = options?.meta ?? {};
    _customMeta = options?.customMeta;
  }
  // Register the router mount handler with component.ts so mount() can delegate.
  // This is the entry point that activates routing — if defineRoutes is never called,
  // mount() won't find a router and the entire router module is tree-shaken away.
  __setRouterMount((shell, routes, options: MountOptions, target: HTMLElement): MountHandle => {
    const routerConfig: RouterConfig = options;
    const { notFound, error, ...routeMap } = routes;

    // ── A shell component, whose <router-outlet> the pages go into ──
    if (shell) {
      const shellHandle = mountComponent(shell, target, options.props);
      // The shell's own, or one of the page (index.html) when the shell has none
      const outlet =
        shellHandle.root.querySelector<HTMLElement>('router-outlet') ??
        document.querySelector<HTMLElement>('router-outlet');

      if (!outlet) {
        // The shell goes again: the app did not start, and must not stay half mounted
        shellHandle.destroy();
        throw new Error(
          "[thane] The shell's template has no <router-outlet> element: put one where the pages go, or mount the routes alone (mount(Routes)).",
        );
      }

      startRouter({ routes: routeMap, notFound, error }, outlet, routerConfig);

      return {
        root: shellHandle.root,
        destroy: () => {
          stopRouter();
          shellHandle.destroy();
        },
      };
    }

    // ── The routes alone: pages go into the target ──
    startRouter({ routes: routeMap, notFound, error }, target, routerConfig);
    return {
      root: target as any,
      destroy: stopRouter,
    };
  });

  // Runtime guard: block root-level params
  for (const key of Object.keys(routes)) {
    if (key !== 'notFound' && /^\/:/.test(key)) {
      throw new Error(
        `[thane-router] Root-level route parameter "${key}" is not allowed. ` +
          'Every route must begin with a static segment (e.g. "/users/:id" not "/:id").',
      );
    }
  }
  return routes as RegisteredRoutes<keyof T & string>;
}

// ─────────────────────────────────────────────────────────────
//  Internal state (single-instance)
// ─────────────────────────────────────────────────────────────

let _config: { routes: RoutesMap; notFound: Route; error?: Route | undefined } | null = null;
let _target: HTMLElement | null = null;
const _currentPath: Signal<string> = signal<string>(typeof window !== 'undefined' ? window.location.pathname : '');
let _currentHandle: MountHandle | null = null;
let _currentRoutePattern = typeof window !== 'undefined' ? window.location.pathname : '';
let _currentRouteTitle = typeof document !== 'undefined' ? document.title : '';
let _routeParams: Record<string, string> = {};
/** On the error route, what failed */
let _routeError: unknown;
/** The current route's search values, parsed by its schema */
let _routeSearch: Record<string, unknown> = {};
/** The site's head and the app's own fields, from the last defineRoutes() call */
let _siteMeta: SiteMeta & Record<string, unknown> = {};
let _customMeta: CustomMetaFields | undefined;
/** The current route's head, and the fields setMeta() has set since it loaded */
let _routeMeta: RouteMeta & Record<string, unknown> = {};
let _metaOverrides: RouteMeta & Record<string, unknown> = {};
let _started = false;
let _popstateHandler: ((event: PopStateEvent) => void) | null = null;
/** Path and query of the mounted route; a change in either loads the route again */
let _loadedUrl: string | null = null;
/** Ticket of the newest route load. A load that finds a newer ticket once its component has arrived stands down. */
let _navigationId = 0;
/** True while the next route's component is being fetched: the URL is the new entry's, the page on screen is not */
let _routePending = false;
const locationUrl = (): string => window.location.pathname + window.location.search;
let _scrollHandler: (() => void) | null = null;
let _previousHistoryScrollRestoration: History['scrollRestoration'] | null = null;
let _pendingScrollAction: 'init' | 'navigate' | 'pop' = 'init';
let _pendingPopScrollPosition: { left: number; top: number } | null = null;
let _scrollPersistScheduled = false;
let _scrollPositions = new Map<string, { left: number; top: number }>();
let _scrollRestorationTimers: ReturnType<typeof setTimeout>[] = [];

interface NormalizedScrollRestorationConfig {
  enabled: boolean;
  behavior: ScrollBehavior;
  left: number;
  top: number;
  resetOnNavigate: boolean;
  restoreOnBackForward: boolean;
}

const normalizeScrollRestoration = (config?: boolean | ScrollRestorationConfig): NormalizedScrollRestorationConfig => {
  const c: ScrollRestorationConfig = config && typeof config === 'object' ? config : {};
  return {
    enabled: config !== false,
    behavior: c.behavior ?? 'auto',
    left: c.left ?? 0,
    top: c.top ?? 0,
    resetOnNavigate: c.resetOnNavigate ?? true,
    restoreOnBackForward: c.restoreOnBackForward ?? true,
  };
};

let _scrollConfig: NormalizedScrollRestorationConfig = normalizeScrollRestoration();

const SCROLL_STATE_KEY = '__thaneScroll';

/** Called once a route's page is on screen; set by markActiveLinks() */
let _onRouteShown: (() => void) | undefined;

/**
 * Marks the links to the current path with `aria-current="page"`, from now on: each time a route's page is on screen,
 * every `<a href>` of the document whose path is the current path gets it, and the others lose it. One CSS rule then
 * styles the active link (`a[aria-current='page']`), and assistive technology announces it. Call it once, in the
 * entry; an app that does not call it does not bundle it.
 */
export const markActiveLinks = (): void => {
  const mark = (): void => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const here = link.origin === location.origin && matchesPath(link.pathname, location.pathname);
      if (here) link.setAttribute('aria-current', 'page');
      else if (link.getAttribute('aria-current') === 'page') link.removeAttribute('aria-current');
    }
  };
  _onRouteShown = mark;
  if (_started) mark();
};

/** The current path, as a signal: `${currentPath()}` in a template follows it */
export const currentPath: ReadonlySignal<string> = _currentPath;

/** A pattern for isActive(): a route's, or one ending in `/*`, for the route and every path below it */
type ActivePattern = [RegisteredRoutePatterns] extends [never]
  ? string
  : RegisteredRoutePatterns | `${RegisteredRoutePatterns}/*` | '/*';

/** Whether `path` is the pattern's: each `:param` matches one segment, and a pattern ending in `/*` the paths below it */
const matchesPath = (pattern: string, path: string): boolean => {
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const below = pattern.endsWith('/*');
  if (pattern === '/*') return true;
  const parts = (below ? pattern.slice(0, -2) : pattern).split('/');
  const segments = path.split('/');
  if (below ? segments.length < parts.length : segments.length !== parts.length) return false;
  return parts.every((part, i) => (part.startsWith(':') ? segments[i] !== '' : part === segments[i]));
};

/**
 * Whether the current path is the route's: `isActive('/about')`, `isActive('/users/:id')`, or, ending in `/*`, the
 * route and every path below it (`isActive('/work/*')`). A template that calls it follows the path:
 * `<a href="/work" class:active=${isActive('/work/*')}>`.
 */
export const isActive: ((pattern: ActivePattern) => boolean) & Pick<ReadonlySignal<string>, 'subscribe'> =
  Object.assign((pattern: ActivePattern): boolean => matchesPath(pattern, _currentPath()), {
    // A signal's subscribe reads the signal from `this`
    subscribe: (callback: (path: string) => void, skipInitial?: boolean) =>
      _currentPath.subscribe(callback, skipInitial),
  });

const createCurrentRouteContext = (): UntypedRouteContext => ({
  params: { ..._routeParams },
  path: typeof window !== 'undefined' ? window.location.pathname : _currentPath(),
  pattern: _currentRoutePattern,
  searchParams: new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''),
  search: _routeSearch,
  hash: typeof window !== 'undefined' ? window.location.hash : '',
  title: _currentRouteTitle,
  state: typeof window !== 'undefined' ? window.history.state : undefined,
  error: _routeError,
});

__setRouteContextProvider(createCurrentRouteContext);

const readScrollPositionFromHistoryState = (state: unknown): { left: number; top: number } | null => {
  const s = (state as any)?.[SCROLL_STATE_KEY];
  return s && typeof s.left === 'number' && typeof s.top === 'number' ? s : null;
};

const persistCurrentScrollPosition = (): void => {
  if (!_scrollConfig.enabled) return;
  // While the next route loads, the scroll offset belongs to the page still on screen and the
  // URL to the entry being loaded: writing one into the other would restore a wrong position later.
  if (_routePending) return;

  _scrollPositions.set(window.location.pathname, { left: window.scrollX, top: window.scrollY });

  const currentState = window.history.state;
  const baseState = currentState && typeof currentState === 'object' ? currentState : {};
  window.history.replaceState(
    {
      ...baseState,
      [SCROLL_STATE_KEY]: { left: window.scrollX, top: window.scrollY },
    },
    '',
    // the entry keeps its full URL: replacing it with the pathname alone dropped the query and hash
    window.location.href,
  );
};

const schedulePersistCurrentScrollPosition = (): void => {
  if (_scrollPersistScheduled) return;

  _scrollPersistScheduled = true;
  requestAnimationFrame(() => {
    _scrollPersistScheduled = false;
    persistCurrentScrollPosition();
  });
};

const applyScrollPosition = (
  pathname: string,
  action: 'init' | 'navigate' | 'pop',
  popScrollPosition: { left: number; top: number } | null,
): void => {
  if (!_scrollConfig.enabled) return;

  const saved =
    action === 'pop' && _scrollConfig.restoreOnBackForward
      ? (popScrollPosition ?? _scrollPositions.get(pathname))
      : undefined;
  const target =
    saved ??
    (action === 'navigate' && _scrollConfig.resetOnNavigate
      ? { left: _scrollConfig.left, top: _scrollConfig.top }
      : undefined);

  if (!target) return;

  const apply = () => {
    window.scrollTo({ left: target.left, top: target.top, behavior: _scrollConfig.behavior });
  };

  // The first write is synchronous: the new page is already in the DOM, so it is painted at its
  // final position instead of at the previous page's offset for one frame. A restored position
  // is applied again once content that arrives late (images, data) has had a chance to grow the page.
  apply();
  if (action === 'pop') {
    requestAnimationFrame(apply);
    _scrollRestorationTimers = [setTimeout(apply, 100)];
  }
};

const isEagerRouteComponent = (value: unknown): value is ComponentHTMLSelector<any> => {
  return !!value && typeof value === 'object' && '__f' in value;
};

const normalizeLoadedRouteComponent = (value: unknown): ComponentHTMLSelector<any> | undefined => {
  if (isEagerRouteComponent(value)) {
    return value;
  }

  if (value && typeof value === 'object' && 'default' in value) {
    return normalizeLoadedRouteComponent((value as { default?: unknown }).default);
  }

  return undefined;
};

const resolveRouteComponent = async (route: PageRoute): Promise<ComponentHTMLSelector<any> | undefined> => {
  if (isEagerRouteComponent(route.component)) {
    return route.component;
  }

  const mod = await route.component();
  return normalizeLoadedRouteComponent(mod);
};

/** The context of a route that is about to load, for its guard or its redirect function */
const routeContextFor = (match: MatchResult): UntypedRouteContext => ({
  ...createCurrentRouteContext(),
  pattern: match.pattern,
  params: { ...match.params },
  search: parseSearch(match.route),
});

/** A route's search values, parsed from the query string by its schema (none without one) */
const parseSearch = (route: Route): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  const schema = route.search;
  if (schema) {
    const params = new URLSearchParams(window.location.search);
    for (const key in schema) values[key] = schema[key]!(params.get(key) ?? undefined);
  }
  return values;
};

/** Redirects in a row, reset once a load gets past them: a loop of redirects stops at the limit */
let _redirects = 0;
const MAX_REDIRECTS = 10;

// ─────────────────────────────────────────────────────────────
//  Route matching
// ─────────────────────────────────────────────────────────────

interface MatchResult {
  pattern: string;
  route: Route;
  params: Record<string, string>;
}

/** A route parameter as the URL means it (`a%20b` is `a b`); a malformed escape is kept as written. */
const decodeParam = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** @internal — exported for unit testing only. */
export const matchRoute = (pathname: string, routes: RoutesMap, notFound?: Route): MatchResult | null => {
  // `/about/` is `/about`: a host serves a route's own page (about/index.html) there, and may redirect to it
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  // 1. Exact match (fastest path)
  if (routes[pathname]) {
    return { pattern: pathname, route: routes[pathname]!, params: {} };
  }

  // 2. Parameterised match (:param segments)
  const pathParts = pathname.split('/');
  for (const pattern of Object.keys(routes)) {
    const patternParts = pattern.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i]!;
      const seg = pathParts[i]!;
      if (pp.startsWith(':')) {
        params[pp.slice(1)] = decodeParam(seg);
      } else if (pp !== seg) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { pattern, route: routes[pattern]!, params };
    }
  }

  // 3. Not found
  if (notFound) {
    return { pattern: 'notFound', route: notFound, params: {} };
  }

  return null;
};

// ─────────────────────────────────────────────────────────────
//  Route loading
// ─────────────────────────────────────────────────────────────

/** The current route's head, with what setMeta() has set, applied to the document */
const applyRouteMeta = (): void => {
  applyHead(resolveHead(_siteMeta, { ..._routeMeta, ..._metaOverrides }, window.location.pathname, _customMeta));
  _currentRouteTitle = document.title;
};

const loadRoute = async (): Promise<void> => {
  if (!_config || !_target) return;

  const target = _target;
  const pathname = window.location.pathname;
  const url = locationUrl();

  // How this load was triggered belongs to this load alone: a navigation that supersedes it,
  // or one started while it mounts, must not inherit its scroll action or saved position.
  const scrollAction = _pendingScrollAction;
  const popScrollPosition = _pendingPopScrollPosition;
  _pendingScrollAction = 'init';
  _pendingPopScrollPosition = null;

  // Every load takes a ticket, also one that turns out to have nothing to do: taking it is
  // what cancels a load that is still waiting for its component.
  const navigationId = ++_navigationId;

  _currentPath(pathname);

  // Skip when this path and query are already mounted: a redundant popstate, a change in the
  // hash alone, or the user returning to the page on screen while another one was loading
  // (that load is now cancelled and the page keeps its state). A change in the query alone
  // mounts the route again, so `route.searchParams` is current.
  if (url === _loadedUrl && _currentHandle) {
    _routePending = false;
    return;
  }

  let match = matchRoute(pathname, _config.routes, _config.notFound);
  _routeError = undefined;

  // Once for the route, and once more for the error route when the route's page failed to load or mount
  for (;;) {
    // Fetch the next page while the current one stays on screen. Tearing the current page down
    // before this await left the outlet empty for as long as the chunk took to arrive, and for
    // one painted frame even when it was already cached: the document collapsed to the shell,
    // the footer jumped to the top and the page flashed.
    let component: ComponentHTMLSelector<any> | undefined;
    let failure: unknown;
    let failed = false;
    if (match) {
      const route = match.route;
      _routePending = true;
      // A redirect, or the route's guard, decides before the page is fetched. A redirect is a guard
      // whose answer is always a path. The build leaves this out when no route has either.
      if (typeof __THANE_GUARDS__ === 'undefined' || __THANE_GUARDS__) {
        const decide = route.redirectTo ?? route.canEnter;
        if (decide) {
          const verdict = typeof decide === 'function' ? await decide(routeContextFor(match)) : decide;
          if (navigationId !== _navigationId || _target !== target) return;
          if (verdict === false) {
            _routePending = false;
            if (_currentHandle) {
              // The page on screen stays, and the address bar shows its URL again
              window.history.replaceState(window.history.state, '', _loadedUrl);
              _currentPath(window.location.pathname);
              return;
            }
            // Nothing is on screen yet (the first load): the notFound route
            if (route === _config.notFound) return;
            match = { pattern: 'notFound', route: _config.notFound, params: {} };
            continue;
          }
          if (typeof verdict === 'string') {
            // The redirected path leaves no history entry; the load keeps how it was triggered. A loop
            // of redirects stops at the limit.
            if (++_redirects > MAX_REDIRECTS) {
              _redirects = 0;
              return console.error('[thane-router] Redirect loop at', verdict);
            }
            window.history.replaceState(null, '', verdict);
            _pendingScrollAction = scrollAction;
            _pendingPopScrollPosition = popScrollPosition;
            return loadRoute();
          }
        }
        _redirects = 0;
      }

      try {
        component = await resolveRouteComponent(route as PageRoute);
      } catch (error) {
        failure = error;
        failed = true;
      }
      // Superseded by a newer navigation, or the router was stopped (or restarted) meanwhile:
      // the outlet and the pending flag are no longer this load's to touch.
      if (navigationId !== _navigationId || _target !== target) return;
      _routePending = false;
    }

    // From here to the scroll write everything happens in one task, so the browser paints the
    // previous page and then the next one, never the gap between them.
    if (_currentHandle) {
      const previous = _currentHandle;
      _currentHandle = null;
      unmount(previous);
    }
    target.innerHTML = '';
    _loadedUrl = url;

    if (!match) {
      _currentRoutePattern = pathname;
      _currentRouteTitle = document.title;
      _routeParams = {};
      return;
    }

    _currentRoutePattern = match.pattern;
    _routeParams = match.params;
    if (typeof __THANE_SEARCH__ === 'undefined' || __THANE_SEARCH__) _routeSearch = parseSearch(match.route);

    // The route's head goes on before the page mounts, so the page reads its title and may add to it
    if (typeof __THANE_HEAD__ === 'undefined' || __THANE_HEAD__) {
      const meta = match.route.meta;
      _routeMeta = (typeof meta === 'function' ? meta(createCurrentRouteContext()) : meta) ?? {};
      _metaOverrides = {};
      applyRouteMeta();
    } else {
      // Without head support (the build found no field but titles), a route's head is its title
      const title = (match.route.meta as RouteMeta | undefined)?.title;
      if (title) document.title = title;
      _currentRouteTitle = document.title;
    }

    if (component) {
      try {
        _currentHandle = mountComponent(component, target, undefined, { route: createCurrentRouteContext() });
      } catch (error) {
        failure = error;
        failed = true;
      }
    }

    if (failed) {
      console.error('[thane-router] Failed to load route:', failure);
      // The error route, given what failed. Browsers cache a failed module import, so recovery is
      // a reload, which the error page can offer. Without an error route the outlet stays empty.
      const errorRoute = _config.error;
      if (!errorRoute || match.route === errorRoute) return;
      match = { pattern: 'error', route: errorRoute, params: {} };
      _routeError = failure;
      continue;
    }

    // A page that navigates while it mounts (a redirect) has started a newer load, which owns the scroll
    if (component && navigationId === _navigationId) {
      applyScrollPosition(pathname, scrollAction, popScrollPosition);
      _onRouteShown?.();
    }
    return;
  }
};

// ─────────────────────────────────────────────────────────────
//  Navigation API — generic, zero knowledge of user routes
// ─────────────────────────────────────────────────────────────

const fillParams = (pattern: string, params: Record<string, string | number | boolean>): string => {
  let path = pattern.replace(/\/:([^/]+)/g, (_, name: string) => '/' + encodeURIComponent(params[name]!));
  // The other values are search values, in the query: a flag that is on as the bare name, one that is off left out
  if (typeof __THANE_SEARCH__ === 'undefined' || __THANE_SEARCH__) {
    const query = new URLSearchParams();
    for (const key in params) {
      const value = params[key];
      if (!pattern.split('/').includes(':' + key) && value !== undefined && value !== null && value !== false) {
        query.append(key, value === true ? '' : String(value));
      }
    }
    const text = query.toString();
    if (text) path += '?' + text;
  }
  return path;
};

/**
 * A route's path with its parameters filled in, each one URL-encoded: `href('/users/:id', { id: 7 })`
 * is `'/users/7'`. Values its `search` schema declares go into the query:
 * `href('/users/:id', { id: 7, tab: 'posts' })` is `'/users/7?tab=posts'`. The pattern, the parameters
 * and the search values are typed from the app's routes.
 */
export const href = fillParams as <P extends RoutePatternWithParams>(
  pattern: P,
  params: RouteParamValues<P>,
) => WithQuery<RouteToPath<P>>;

/**
 * Navigate to the given path using HTML5 History pushState: `navigate('/about')`, or a pattern and its
 * parameters, `navigate('/users/:id', { id: 7 })` (see `href()`).
 *
 * Type-safe when the Register interface is augmented with `routes`.
 */
export function navigate(path: RoutePaths): void;
export function navigate<P extends RoutePatternWithParams>(pattern: P, params: RouteParamValues<P>): void;
export function navigate(path: string, params?: Record<string, string | number | boolean>): void {
  if (params) path = fillParams(path, params);
  // Nothing to do when the whole URL, query and hash included, is already the current one
  const target = new URL(path, window.location.href);
  if (target.pathname + target.search + target.hash === locationUrl() + window.location.hash) return;
  persistCurrentScrollPosition();
  _pendingScrollAction = 'navigate';
  // The entry carries the position to restore only when the router restores scroll positions
  window.history.pushState(
    _scrollConfig.enabled ? { [SCROLL_STATE_KEY]: { left: _scrollConfig.left, top: _scrollConfig.top } } : null,
    '',
    path,
  );
  void loadRoute();
}

/**
 * Navigate back in history (wrapper around `history.back()`).
 */
export function navigateBack(): void {
  window.history.back();
}

/** The app's own head fields, as the generated route types give them (from `customMeta`), every table's together */
type TableCustomMeta<T> = T extends { customMeta: infer C extends object } ? C : never;
type IntersectionOf<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;
type AllCustomMeta = TableCustomMeta<RouteTableEntry> | TableCustomMeta<EffectiveRegister>;
type RegisteredCustomMeta = [AllCustomMeta] extends [never] ? {} : IntersectionOf<AllCustomMeta>;

/** The head fields a page may set: the built-in ones and the app's own */
export type AppRouteMeta = RouteMeta & RegisteredCustomMeta;

/**
 * Set head fields of the page on screen, for what is known only once its data has arrived (a
 * product's name and photo). They are applied over the route's own and hold until the next route loads.
 *
 * ```ts
 * setMeta({ title: product.name, description: product.summary, image: product.photo });
 * ```
 */
export function setMeta(meta: AppRouteMeta): void {
  _metaOverrides = { ..._metaOverrides, ...meta };
  applyRouteMeta();
}

// ─────────────────────────────────────────────────────────────
//  Router lifecycle — called internally by mount()
// ─────────────────────────────────────────────────────────────

/**
 * A plain click on a link to one of the app's routes navigates in the app instead of loading the page
 * again, so `<a href="/about">` is a router link. The browser keeps a click that is already handled
 * (`@click.prevent`), a modified one (a new tab, a download), a link with a `target`, a `download` or
 * `rel="external"`, one to another origin or to a hash on this page, and one to a path that no route
 * has (a file such as `/sitemap.xml`).
 */
const followLink = (event: MouseEvent): void => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const link = (event.target as Element | null)?.closest?.('a[href]');
  if (!link || link.hasAttribute('download') || /\bexternal\b/.test(link.getAttribute('rel') ?? '')) return;
  const target = link.getAttribute('target');
  if (target && target !== '_self') return;
  // An SVG link has no href property, so the attribute is read, resolved against the page
  const url = new URL(link.getAttribute('href')!, window.location.href);
  if (url.origin !== window.location.origin || (url.hash && url.pathname + url.search === locationUrl())) return;
  if (!_config || !matchRoute(url.pathname, _config.routes)) return;
  event.preventDefault();
  navigate((url.pathname + url.search + url.hash) as RoutePaths);
};

/**
 * Start the router: it renders each route's page into `target`, the shell's `<router-outlet>` for
 * `mount(Shell, { routes })`, or the mount's target for `mount(Routes)`. Only one router runs.
 *
 * @internal — called by `mount()`; an app mounts its routes instead.
 */
export function startRouter(
  config: { routes: RoutesMap; notFound: Route; error?: Route | undefined },
  target: HTMLElement,
  routerConfig?: Pick<RouterConfig, 'scrollRestoration'>,
): void {
  if (_started) {
    console.warn('[thane-router] Router already started — only one instance is allowed.');
    return;
  }
  _scrollConfig = normalizeScrollRestoration(routerConfig?.scrollRestoration);
  _started = true;
  _config = config;
  _target = target;
  _pendingPopScrollPosition = readScrollPositionFromHistoryState(window.history.state);
  _pendingScrollAction = _pendingPopScrollPosition ? 'pop' : 'init';

  if (_scrollConfig.enabled && 'scrollRestoration' in window.history) {
    _previousHistoryScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
  }

  if (_scrollConfig.enabled) {
    persistCurrentScrollPosition();
    _scrollHandler = () => {
      if (_scrollRestorationTimers.length > 0) {
        for (const id of _scrollRestorationTimers) clearTimeout(id);
        _scrollRestorationTimers = [];
      }
      schedulePersistCurrentScrollPosition();
    };
    window.addEventListener('scroll', _scrollHandler, { passive: true });
  }

  // Listen for browser back/forward
  _popstateHandler = (event?: PopStateEvent) => {
    _pendingPopScrollPosition = readScrollPositionFromHistoryState(event?.state);
    _pendingScrollAction = 'pop';
    void loadRoute();
  };
  window.addEventListener('popstate', _popstateHandler);
  if (typeof __THANE_LINKS__ === 'undefined' || __THANE_LINKS__) window.addEventListener('click', followLink);

  // Load the initial route
  void loadRoute();
}

/**
 * Stop the router, destroy the current route component, and clean up.
 * Primarily useful for testing and hot module replacement.
 */
export function stopRouter(): void {
  if (!_started) return;

  // A load still waiting for its component stands down when it resumes
  _navigationId++;
  _routePending = false;

  if (_currentHandle) {
    unmount(_currentHandle);
    _currentHandle = null;
  }

  if (_target) {
    _target.innerHTML = '';
  }

  if (_popstateHandler) {
    window.removeEventListener('popstate', _popstateHandler);
    _popstateHandler = null;
  }
  if (typeof __THANE_LINKS__ === 'undefined' || __THANE_LINKS__) window.removeEventListener('click', followLink);

  if (_scrollHandler) {
    window.removeEventListener('scroll', _scrollHandler);
    _scrollHandler = null;
  }

  _config = null;
  _target = null;
  _loadedUrl = null;
  _currentPath(window.location.pathname);
  _currentRoutePattern = window.location.pathname;
  _currentRouteTitle = document.title;
  _routeParams = {};
  _started = false;
  _pendingPopScrollPosition = null;
  for (const id of _scrollRestorationTimers) clearTimeout(id);
  _scrollRestorationTimers = [];
  _scrollPositions = new Map<string, { left: number; top: number }>();
  _scrollConfig = normalizeScrollRestoration();
  _pendingScrollAction = 'init';
  _scrollPersistScheduled = false;

  if (_previousHistoryScrollRestoration !== null && 'scrollRestoration' in window.history) {
    window.history.scrollRestoration = _previousHistoryScrollRestoration;
    _previousHistoryScrollRestoration = null;
  }
}
