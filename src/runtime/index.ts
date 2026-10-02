// The `.css` import declarations come with `thane`: a project needs no "types": ["thane/client"]. The
// generated .thane/types/client.d.ts references the same file, so the declaration is in a program once.
/// <reference path="../../client.d.ts" preserve="true" />
/** Runtime entry point. */

// The public API: what an app calls, and the types an app writes in its own code. Every other
// type stays in the module declarations, so hovers and inference still show it. Compiler helpers
// are in ./internal.ts ('thane/runtime'), the router values in ./router-exports.ts ('thane/router').
export type { Signal, ReadonlySignal } from './types.js';
export { signal, batch, computed, effect, untrack, onCleanup } from './signal.js';
export { html, css, when, repeat, type Fragment } from './markers.js';
export { ref, type Ref } from './ref.js';
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
