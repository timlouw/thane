// The `.css` import declarations come with `thane`: a project needs no "types": ["thane/client"]. The
// generated .thane/types/client.d.ts references the same file, so the declaration is in a program once.
/// <reference path="../../client.d.ts" preserve="true" />
/** Runtime entry point. */

// Router globals: `navigate()` and the others are real values the router installs for templates
declare global {
  /**
   * Navigate to a path (router).
   * Type-safe once Thane has generated the route types (any `thane` command does).
   */
  function navigate(path: import('./router.js').RoutePaths): void;
  function navigate<P extends import('./router.js').RoutePatternWithParams>(
    pattern: P,
    params: import('./router.js').RouteParamValues<P>,
  ): void;

  /**
   * Navigate back in history (router).
   */
  function navigateBack(): void;

  /**
   * The active router path as a read-only signal.
   * Available globally when the router is used.
   */
  const currentPath: import('./types.js').ReadonlySignal<string>;
}

// The public API: what an app calls, and the types an app writes in its own code. Every other
// type stays in the module declarations, so hovers and inference still show it. Compiler helpers
// are in ./internal.ts ('thane/runtime'), the router values in ./router-exports.ts ('thane/router').
export type { Signal, ReadonlySignal } from './types.js';
export { signal, batch, computed, effect, untrack, onCleanup } from './signal.js';
export { html, css, when, repeat, type Fragment } from './markers.js';
export {
  defineComponent,
  registerGlobalStyles,
  mount,
  unmount,
  type ComponentContext,
  type ComponentHTMLSelector,
  type MountHandle,
} from './component.js';
export type { RoutePaths } from './router.js';
