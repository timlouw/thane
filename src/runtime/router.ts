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
 *   • navigate / navigateBack / getRouteParam are generic functions with zero
 *     knowledge of user routes — they live in the thane shared chunk.
 *   • The ROUTES map is only imported by the file that calls mount(), so changing
 *     a single page only invalidates that page's chunk.
 *   • Type safety for paths uses the Register pattern — no compiler-generated
 *     .d.ts files are needed.
 */

import type { MountHandle, ComponentHTMLSelector } from './component.js';
import { mountComponent, unmount, __setRouterMount } from './component.js';
import type { MountOptions } from './component.js';

// ─────────────────────────────────────────────────────────────
//  Register pattern — module augmentation for type-safe routes
// ─────────────────────────────────────────────────────────────

/**
 * Augment this interface via `declare module 'thane'` to enable
 * type-safe `navigate()` and `getRouteParam()`.
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
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Register {}

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

/** Union of all navigable paths, expanding parameterised patterns. */
type NavigablePaths<T extends Record<string, any>> = {
  [K in RouteKeys<T>]: RouteToPath<K>;
}[RouteKeys<T>];

/** Extracts all parameter names from all route patterns. */
type ExtractParams<T extends string> = T extends `${string}:${infer Param}/${infer Rest}`
  ? Param | ExtractParams<Rest>
  : T extends `${string}:${infer Param}`
    ? Param
    : never;

type AllRouteParams<T extends Record<string, any>> = ExtractParams<RouteKeys<T>>;

/** Resolves to the navigable path union when Register is augmented, else `string`. */
export type RoutePaths = Register extends { routes: infer R extends Record<string, any> } ? NavigablePaths<R> : string;

/** Resolves to the route param name union when Register is augmented, else `string`. */
export type RouteParamNames = Register extends { routes: infer R extends Record<string, any> }
  ? AllRouteParams<R>
  : string;

// ─────────────────────────────────────────────────────────────
//  Public types
// ─────────────────────────────────────────────────────────────

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
  /** Lazy loader that resolves to the component factory (return value of defineComponent). */
  component: () => Promise<any>;
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
 * preserve literal string keys so that `navigate()` and `getRouteParam()` get
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
export function defineRoutes<const T extends Record<string, Route> & { notFound: Route }>(
  routes: ValidateRoutes<T> & T,
): T {
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

      startRouter({ routes: routeMap, notFound }, outlet);

      return {
        root: shellHandle.root,
        destroy: () => {
          stopRouter();
          shellHandle.destroy();
        },
      };
    }

    // ── Mode C: router only (no shell) ──
    startRouter({ routes: routeMap, notFound }, target);
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
  return routes;
}

// ─────────────────────────────────────────────────────────────
//  Internal state (single-instance)
// ─────────────────────────────────────────────────────────────

let _config: { routes: RoutesMap; notFound: Route } | null = null;
let _target: HTMLElement | null = null;
let _currentPath = '';
let _currentHandle: MountHandle | null = null;
let _routeParams: Record<string, string> = {};
let _started = false;
let _popstateHandler: (() => void) | null = null;

// ─────────────────────────────────────────────────────────────
//  Route matching
// ─────────────────────────────────────────────────────────────

interface MatchResult {
  route: Route;
  params: Record<string, string>;
}

/** @internal — exported for unit testing only. */
export const matchRoute = (pathname: string, routes: RoutesMap, notFound?: Route): MatchResult | null => {
  // 1. Exact match (fastest path)
  if (routes[pathname]) {
    return { route: routes[pathname]!, params: {} };
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
      return { route: routes[pattern]!, params };
    }
  }

  // 3. Not found
  if (notFound) {
    return { route: notFound, params: {} };
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
  if (pathname === _currentPath && _currentHandle) return;

  // Tear down current route
  if (_currentHandle) {
    unmount(_currentHandle);
    _target.innerHTML = '';
    _currentHandle = null;
  }

  _currentPath = pathname;

  const match = matchRoute(pathname, _config.routes, _config.notFound);
  if (!match) {
    _routeParams = {};
    _target.innerHTML = '';
    return;
  }

  _routeParams = match.params;

  // Set document title if provided
  if (match.route.title) {
    document.title = match.route.title;
  }

  try {
    const mod = await match.route.component();
    // The dynamic import may return the component directly or as a module
    // with a default export.  Normalise both forms.
    const component: ComponentHTMLSelector<any> | undefined =
      mod && typeof mod === 'object' && '__f' in mod ? mod : (mod?.default ?? mod);

    // Guard: the user may have navigated away while we were loading
    if (window.location.pathname !== _currentPath) return;

    if (component) {
      _currentHandle = mountComponent(component, _target);
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
  if (_currentPath === path) return;
  window.history.pushState({}, '', path);
  void loadRoute();
}

/**
 * Navigate back in history (wrapper around `history.back()`).
 */
export function navigateBack(): void {
  window.history.back();
}

/**
 * Retrieve the value of a named route parameter from the current URL.
 *
 * For a route pattern `/users/:id` matched against `/users/42`,
 * `getRouteParam('id')` returns `'42'`.
 *
 * Type-safe when the Register interface is augmented with `routes`.
 */
export function getRouteParam(name: RouteParamNames): string {
  return _routeParams[name as string] ?? '';
}

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
export function startRouter(config: { routes: RoutesMap; notFound: Route }, target: HTMLElement): void {
  if (_started) {
    console.warn('[thane-router] Router already started — only one instance is allowed.');
    return;
  }
  _started = true;
  _config = config;
  _target = target;

  // Expose navigation helpers globally (like when, whenElse, repeat)
  const g = globalThis as any;
  g.navigate = navigate;
  g.navigateBack = navigateBack;
  g.getRouteParam = getRouteParam;

  // Listen for browser back/forward
  _popstateHandler = () => {
    _currentPath = '';
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

  // Remove globals
  const g = globalThis as any;
  delete g.navigate;
  delete g.navigateBack;
  delete g.getRouteParam;

  _config = null;
  _target = null;
  _currentPath = '';
  _routeParams = {};
  _started = false;
}
