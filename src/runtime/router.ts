/**
 * Router runtime — single-instance client-side router for Thane.
 *
 * Fully tree-shakable: apps that don't import any router symbols pay zero cost.
 * The router supports two bootstrap modes (configured via the `router` option on `mount()`):
 *
 *   B) Shell mode — mount a shell component whose template contains an element
 *      with `id="router-outlet"` (or a custom `router-${string}` id).  Page
 *      components are rendered inside that outlet.
 *
 *   C) Root mode — no shell component; page components are rendered directly
 *      into `document.body` (or a `target` element).  No outlet element is
 *      created or required.
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

// ─────────────────────────────────────────────────────────────
//  Register pattern — module augmentation for type-safe routes
// ─────────────────────────────────────────────────────────────

/**
 * Augment this interface via `declare module 'thane'` to enable
 * type-safe `navigate()`.
 *
 * ```ts
 * const Routes = defineRoutes({ ... });
 * type Routes = typeof Routes;
 *
 * declare module 'thane' {
 *   interface Register { routes: Routes }
 * }
 * ```
 */
declare global {
  namespace ThaneTypeRegistry {
    interface Register {}
    interface RouteComponentRegister {}
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Register extends ThaneTypeRegistry.Register {}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface RouteComponentRegister extends ThaneTypeRegistry.RouteComponentRegister {}

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

/** Exclude the special `notFound` key when computing navigable paths / params. */
type RouteKeys<T> = Exclude<keyof T & string, 'notFound'>;

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

type EffectiveRegister = ThaneTypeRegistry.Register & Register;
type EffectiveRouteComponentRegister = ThaneTypeRegistry.RouteComponentRegister & RouteComponentRegister;

type ExplicitRegisterRoutePaths = EffectiveRegister extends { routePaths: infer P extends string } ? P : never;
type ExplicitRegisterRouteParamNames = EffectiveRegister extends { routeParamNames: infer P extends string }
  ? P
  : never;
type RegisteredRoutePatterns = [ExplicitRegisterRoutePaths] extends [never]
  ? EffectiveRegister extends { routes: infer R extends Record<string, any> }
    ? RegisteredRoutePaths<R>
    : never
  : ExplicitRegisterRoutePaths;

/** Resolves to the navigable path union when Register is augmented, else `string`. */
export type RoutePaths = [RegisteredRoutePatterns] extends [never] ? string : RouteToPath<RegisteredRoutePatterns>;

/** Resolves to the route param name union when Register is augmented, else `string`. */
export type RouteParamNames = [ExplicitRegisterRouteParamNames] extends [never]
  ? [RegisteredRoutePatterns] extends [never]
    ? string
    : ExtractRouteParams<RegisteredRoutePatterns>
  : ExplicitRegisterRouteParamNames;

export type RouteParamsObject<T extends string> = [ExtractRouteParams<T>] extends [never]
  ? Record<string, never>
  : { readonly [K in ExtractRouteParams<T>]: string };

type RegisteredRoutePatternForSelector<S extends string> = S extends keyof EffectiveRouteComponentRegister
  ? EffectiveRouteComponentRegister[S] extends string
    ? EffectiveRouteComponentRegister[S]
    : never
  : never;

type RouteContextBase<TPattern extends string, TPath extends string, TParams> = Readonly<{
  pattern: TPattern;
  path: TPath;
  params: TParams;
  searchParams: URLSearchParams;
  hash: string;
  title: string;
  state: unknown;
}>;

type ResolvedRouteContext<TPattern extends string> = TPattern extends 'notFound'
  ? RouteContextBase<'notFound', string, Record<string, never>>
  : RouteContextBase<TPattern, RouteToPath<TPattern>, RouteParamsObject<TPattern>>;

export interface UntypedRouteContext extends RouteContextBase<string, string, Record<string, string>> {
  /** @deprecated Run thane dev, thane build, or thane serve once to generate route-aware component types. */
  readonly params: Record<string, string>;
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

/**
 * A single route definition.
 *
 * ```ts
 * const Routes = defineRoutes({
 *   '/':      { component: () => import('./pages/home.js'), title: 'Home' },
 *   notFound: { component: () => import('./pages/404.js'), title: '404' },
 * });
 * ```
 */
export interface Route {
  /** Lazy loader or eager page component (return value of defineComponent). */
  component: RouteComponent;
  /** Optional document title to set when this route is active. */
  title?: string | undefined;
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
export type RoutesConfig = Record<string, Route> & { notFound: Route };
type RouteRecordFromKeys<K extends string> = Record<Exclude<K, 'notFound'>, Route> & { notFound: Route };
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

/**
 * Options for the `router` property of `mount()`.
 *
 * ```ts
 * mount({
 *   component: Shell,
 *   router: { routes: Routes, outletId: 'router-main' },
 * });
 * ```
 */
export interface RouterConfig {
  /** Route map from `defineRoutes()`. */
  routes: RoutesConfig;
  /**
   * ID of the outlet element inside a shell component's template.
   * Only used in Mode B (shell + router).  Defaults to `'router-outlet'`.
   * Must match the pattern `router-${string}`.
   */
  outletId?: `router-${string}` | undefined;
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
type ValidateRoutes<T extends Record<string, Route>> = {
  [K in keyof T]: K extends 'notFound' ? T[K] : K extends `/:${string}` ? never : T[K];
};

/**
 * Define the application's route map with type-safe keys.
 *
 * Includes route patterns mapped to `Route` objects plus a mandatory `notFound`
 * fallback route.  This is an identity function at runtime — its purpose is to
 * preserve literal string keys so that `navigate()` gets
 * full autocomplete and compile-time checking via the Register pattern.
 *
 * ```ts
 * const Routes = defineRoutes({
 *   '/':          { component: () => import('./pages/home.js'), title: 'Home' },
 *   '/about':     { component: () => import('./pages/about.js') },
 *   '/users/:id': { component: () => import('./pages/user.js') },
 *   notFound:     { component: () => import('./pages/not-found.js'), title: '404' },
 * });
 * type Routes = typeof Routes;
 * ```
 *
 * @throws {Error} At runtime if any route key is a root-level param (`/:...`).
 */
export function defineRoutes<const T extends RoutesConfig>(
  routes: ValidateRoutes<T> & T,
): RegisteredRoutes<keyof T & string> {
  // Register the router mount handler with component.ts so mount() can delegate.
  // This is the entry point that activates routing — if defineRoutes is never called,
  // mount() won't find a router and the entire router module is tree-shaken away.
  __setRouterMount((options: MountOptions, target: HTMLElement): MountHandle => {
    const routerConfig = options.router!;
    const { notFound, ...routeMap } = routerConfig.routes;

    // ── Mode B: shell component + router ──
    if (options.component) {
      const shellHandle = mountComponent(options.component, target, options.props);
      const outletId = routerConfig.outletId ?? 'router-outlet';
      const outlet = shellHandle.root.querySelector<HTMLElement>(`#${outletId}`) ?? document.getElementById(outletId);

      if (!outlet) {
        throw new Error(
          `[thane] Router outlet element with id="${outletId}" not found. ` +
            "In Mode B (shell + router), your shell component's template must contain " +
            `an element with id="${outletId}".`,
        );
      }

      startRouter({ routes: routeMap, notFound }, outlet, routerConfig);

      return {
        root: shellHandle.root,
        destroy: () => {
          stopRouter();
          shellHandle.destroy();
        },
      };
    }

    // ── Mode C: router only (no shell) ──
    startRouter({ routes: routeMap, notFound }, target, routerConfig);
    return {
      root: target as any,
      destroy: () => {
        stopRouter();
      },
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

let _config: { routes: RoutesMap; notFound: Route } | null = null;
let _target: HTMLElement | null = null;
const _currentPath: Signal<string> = signal<string>(typeof window !== 'undefined' ? window.location.pathname : '');
let _currentHandle: MountHandle | null = null;
let _currentRoutePattern = typeof window !== 'undefined' ? window.location.pathname : '';
let _currentRouteTitle = typeof document !== 'undefined' ? document.title : '';
let _routeParams: Record<string, string> = {};
let _started = false;
let _popstateHandler: ((event: PopStateEvent) => void) | null = null;
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

const DEFAULT_SCROLL_RESTORATION: NormalizedScrollRestorationConfig = {
  enabled: true,
  behavior: 'auto',
  left: 0,
  top: 0,
  resetOnNavigate: true,
  restoreOnBackForward: true,
};

let _scrollConfig: NormalizedScrollRestorationConfig = DEFAULT_SCROLL_RESTORATION;

const SCROLL_STATE_KEY = '__thaneScroll';

const currentPathSignal = _currentPath as ReadonlySignal<string>;

const installCurrentPathGlobal = (): void => {
  (globalThis as { currentPath?: ReadonlySignal<string> }).currentPath = currentPathSignal;
};

installCurrentPathGlobal();

const createCurrentRouteContext = (): UntypedRouteContext => ({
  params: { ..._routeParams },
  path: typeof window !== 'undefined' ? window.location.pathname : _currentPath(),
  pattern: _currentRoutePattern,
  searchParams: new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''),
  hash: typeof window !== 'undefined' ? window.location.hash : '',
  title: _currentRouteTitle,
  state: typeof window !== 'undefined' ? window.history.state : undefined,
});

__setRouteContextProvider(() => createCurrentRouteContext());

const normalizeScrollRestoration = (config?: boolean | ScrollRestorationConfig): NormalizedScrollRestorationConfig => {
  if (config === false) {
    return { ...DEFAULT_SCROLL_RESTORATION, enabled: false };
  }
  if (config === true || config === undefined) {
    return { ...DEFAULT_SCROLL_RESTORATION };
  }

  return {
    enabled: true,
    behavior: config.behavior ?? DEFAULT_SCROLL_RESTORATION.behavior,
    left: config.left ?? DEFAULT_SCROLL_RESTORATION.left,
    top: config.top ?? DEFAULT_SCROLL_RESTORATION.top,
    resetOnNavigate: config.resetOnNavigate ?? DEFAULT_SCROLL_RESTORATION.resetOnNavigate,
    restoreOnBackForward: config.restoreOnBackForward ?? DEFAULT_SCROLL_RESTORATION.restoreOnBackForward,
  };
};

const readScrollPositionFromHistoryState = (state: unknown): { left: number; top: number } | null => {
  if (!state || typeof state !== 'object' || !(SCROLL_STATE_KEY in state)) return null;

  const candidate = (state as Record<string, unknown>)[SCROLL_STATE_KEY];
  if (!candidate || typeof candidate !== 'object') return null;

  const left = (candidate as Record<string, unknown>)['left'];
  const top = (candidate as Record<string, unknown>)['top'];
  if (typeof left !== 'number' || typeof top !== 'number') return null;

  return { left, top };
};

const persistCurrentScrollPosition = (): void => {
  if (!_scrollConfig.enabled || typeof window === 'undefined') return;

  _scrollPositions.set(window.location.pathname, { left: window.scrollX, top: window.scrollY });

  const currentState = window.history.state;
  const baseState = currentState && typeof currentState === 'object' ? currentState : {};
  window.history.replaceState(
    {
      ...baseState,
      [SCROLL_STATE_KEY]: { left: window.scrollX, top: window.scrollY },
    },
    '',
    window.location.pathname,
  );
};

const schedulePersistCurrentScrollPosition = (): void => {
  if (_scrollPersistScheduled || typeof window === 'undefined') return;

  _scrollPersistScheduled = true;
  requestAnimationFrame(() => {
    _scrollPersistScheduled = false;
    persistCurrentScrollPosition();
  });
};

const applyScrollPosition = (pathname: string): void => {
  if (!_scrollConfig.enabled || typeof window === 'undefined') return;

  const action = _pendingScrollAction;
  _pendingScrollAction = 'init';

  const saved =
    action === 'pop' && _scrollConfig.restoreOnBackForward
      ? (_pendingPopScrollPosition ?? _scrollPositions.get(pathname))
      : undefined;
  const target =
    saved ??
    (action === 'navigate' && _scrollConfig.resetOnNavigate
      ? { left: _scrollConfig.left, top: _scrollConfig.top }
      : undefined);

  _pendingPopScrollPosition = null;

  if (!target) return;

  const apply = () => {
    window.scrollTo({ left: target.left, top: target.top, behavior: _scrollConfig.behavior });
  };

  queueMicrotask(() => {
    requestAnimationFrame(() => {
      apply();
      if (action === 'pop') {
        requestAnimationFrame(apply);
        _scrollRestorationTimers = [setTimeout(apply, 100)];
      }
    });
  });
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

const resolveRouteComponent = async (route: Route): Promise<ComponentHTMLSelector<any> | undefined> => {
  if (isEagerRouteComponent(route.component)) {
    return route.component;
  }

  const mod = await route.component();
  return normalizeLoadedRouteComponent(mod);
};

// ─────────────────────────────────────────────────────────────
//  Route matching
// ─────────────────────────────────────────────────────────────

interface MatchResult {
  pattern: string;
  route: Route;
  params: Record<string, string>;
}

/** @internal — exported for unit testing only. */
export const matchRoute = (pathname: string, routes: RoutesMap, notFound?: Route): MatchResult | null => {
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
        params[pp.slice(1)] = seg;
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

const loadRoute = async (): Promise<void> => {
  if (!_config || !_target) return;

  const pathname = window.location.pathname;

  // Skip if already on this path (guard against redundant popstate)
  if (pathname === _currentPath() && _currentHandle) return;

  // Tear down current route
  if (_currentHandle) {
    unmount(_currentHandle);
    _target.innerHTML = '';
    _currentHandle = null;
  }

  _currentPath(pathname);

  const match = matchRoute(pathname, _config.routes, _config.notFound);
  if (!match) {
    _currentRoutePattern = pathname;
    _currentRouteTitle = typeof document !== 'undefined' ? document.title : '';
    _routeParams = {};
    _target.innerHTML = '';
    return;
  }

  _currentRoutePattern = match.pattern;
  _routeParams = match.params;

  // Set document title if provided
  if (match.route.title) {
    document.title = match.route.title;
  }
  _currentRouteTitle = match.route.title ?? (typeof document !== 'undefined' ? document.title : '');

  try {
    const component = await resolveRouteComponent(match.route);

    // Guard: the user may have navigated away while we were loading
    if (window.location.pathname !== _currentPath()) return;

    if (component) {
      _currentHandle = mountComponent(component, _target, undefined, { route: createCurrentRouteContext() });
      applyScrollPosition(pathname);
    }
  } catch (error) {
    console.error('[thane-router] Failed to load route:', error);
  }
};

// ─────────────────────────────────────────────────────────────
//  Navigation API — generic, zero knowledge of user routes
// ─────────────────────────────────────────────────────────────

/**
 * Navigate to the given path using HTML5 History pushState.
 *
 * Type-safe when the Register interface is augmented with `routes`.
 */
export function navigate(path: RoutePaths): void {
  if (_currentPath() === path) return;
  persistCurrentScrollPosition();
  _pendingScrollAction = 'navigate';
  window.history.pushState({ [SCROLL_STATE_KEY]: { left: _scrollConfig.left, top: _scrollConfig.top } }, '', path);
  void loadRoute();
}

/**
 * Navigate back in history (wrapper around `history.back()`).
 */
export function navigateBack(): void {
  window.history.back();
}

/**
// ─────────────────────────────────────────────────────────────
//  Router lifecycle — called internally by mount()
// ─────────────────────────────────────────────────────────────

/**
 * Initialise and start the router.
 *
 * @internal — called by `mount()` when the `router` option is provided.
 * Not part of the public API; use `mount({ router: ... })` instead.
 *
 * @param config - Router configuration with routes map and notFound.
 * @param target - The element to render pages into (outlet in Mode B, body/target in Mode C).
 */
export function startRouter(
  config: { routes: RoutesMap; notFound: Route },
  target: HTMLElement,
  routerConfig?: Pick<RouterConfig, 'scrollRestoration'>,
): void {
  if (_started) {
    console.warn('[thane-router] Router already started — only one instance is allowed.');
    return;
  }
  _started = true;
  _config = config;
  _target = target;
  _scrollConfig = normalizeScrollRestoration(routerConfig?.scrollRestoration);
  _pendingPopScrollPosition =
    typeof window !== 'undefined' ? readScrollPositionFromHistoryState(window.history.state) : null;
  _pendingScrollAction = _pendingPopScrollPosition ? 'pop' : 'init';

  // Expose navigation helpers globally (like when, whenElse, repeat)
  const g = globalThis as any;
  g.currentPath = currentPathSignal;
  g.navigate = navigate;
  g.navigateBack = navigateBack;

  if (_scrollConfig.enabled && typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
    _previousHistoryScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
  }

  if (_scrollConfig.enabled && typeof window !== 'undefined') {
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

  // Load the initial route
  void loadRoute();
}

/**
 * Stop the router, destroy the current route component, and clean up.
 * Primarily useful for testing and hot module replacement.
 */
export function stopRouter(): void {
  if (!_started) return;

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

  if (_scrollHandler) {
    window.removeEventListener('scroll', _scrollHandler);
    _scrollHandler = null;
  }

  // Remove globals
  const g = globalThis as any;
  delete g.navigate;
  delete g.navigateBack;

  _config = null;
  _target = null;
  _currentPath(typeof window !== 'undefined' ? window.location.pathname : '');
  _currentRoutePattern = typeof window !== 'undefined' ? window.location.pathname : '';
  _currentRouteTitle = typeof document !== 'undefined' ? document.title : '';
  _routeParams = {};
  _started = false;
  _pendingPopScrollPosition = null;
  for (const id of _scrollRestorationTimers) clearTimeout(id);
  _scrollRestorationTimers = [];
  _scrollPositions = new Map<string, { left: number; top: number }>();
  _scrollConfig = DEFAULT_SCROLL_RESTORATION;
  _pendingScrollAction = 'init';
  _scrollPersistScheduled = false;

  if (
    _previousHistoryScrollRestoration !== null &&
    typeof window !== 'undefined' &&
    'scrollRestoration' in window.history
  ) {
    window.history.scrollRestoration = _previousHistoryScrollRestoration;
    _previousHistoryScrollRestoration = null;
  }
}
