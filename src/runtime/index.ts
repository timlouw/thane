/** Runtime entry point. */

// Global type declarations for template tags and directives
declare global {
  /**
   * Tagged template for HTML content
   */
  function html(strings: TemplateStringsArray, ...values: any[]): any;

  /**
   * Tagged template for CSS content
   */
  function css(strings: TemplateStringsArray, ...values: any[]): any;

  /**
   * Conditional directive - shows content when condition is truthy
   */
  function when(condition: boolean | (() => boolean)): string;

  /**
   * Conditional directive with else branch
   */
  function whenElse<T, F>(condition: boolean | (() => boolean), thenTemplate: T, elseTemplate: F): T | F;

  /**
   * Repeat directive for rendering arrays
   */
  function repeat<T>(
    items: T[] | (() => T[]),
    templateFn: (item: T, index: number) => any,
    emptyTemplate?: any,
    trackBy?: (item: T, index: number) => string | number,
  ): any[];

  /**
   * Navigate to a path (router).
   * Type-safe when `Register` is augmented in `routes.ts`.
   */
  function navigate(path: import('./router.js').RoutePaths): void;

  /**
   * Navigate back in history (router).
   */
  function navigateBack(): void;

  /**
   * Get a route parameter value (router).
   * Type-safe when `Register` is augmented in `routes.ts`.
   */
  function getRouteParam(name: import('./router.js').RouteParamNames): string;
}

// Export types
export type { Signal, ReadonlySignal, ComponentRoot } from './types.js';

// Export signal and reactive primitives
export { signal, batch, computed, effect, untrack } from './signal.js';

// Export component (public API only — internal symbols live in ./internal.ts)
export {
  defineComponent,
  registerGlobalStyles,
  mountComponent,
  type ComponentContext,
  type ComponentReturnType,
  type ComponentHTMLSelector,
} from './component.js';

// Export mount (public API) and unmount
export { mount, unmount, type MountOptions, type MountHandle } from './component.js';

// Router types — re-exported so `declare module 'thane' { interface Register { ... } }` works.
// VALUE exports live in the 'thane/router' subpath to keep router code tree-shakable.
export type {
  Register,
  Route,
  RoutesMap,
  RoutesConfig,
  RouterConfig,
  RoutePaths,
  RouteParamNames,
  RouteToPath,
} from './router.js';

// ─────────────────────────────────────────────────────────────
//  Template tag shims
//
//  Compiler replaces html`` / css`` at build time. These shims
//  exist for unit tests and non-compiled contexts.
// ─────────────────────────────────────────────────────────────

/** Escape HTML-significant chars in interpolated values. */
const _esc = (val: unknown): string => {
  const s = String(val);
  if (s.length === 0) return s;
  if (!/[&<>"']/.test(s)) return s;
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/** Runtime shim for `html` — replaced by compiler in production builds. */
export const html = (strings: TemplateStringsArray, ...values: unknown[]): string => {
  let result = strings[0]!;
  for (let i = 0; i < values.length; i++) {
    result += _esc(values[i]) + strings[i + 1]!;
  }
  return result;
};

/** Runtime shim for `css` — plain concatenation (no escaping needed). */
export const css = (strings: TemplateStringsArray, ...values: unknown[]): string =>
  String.raw({ raw: strings }, ...values);
