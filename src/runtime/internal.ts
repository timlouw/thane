/**
 * Internal runtime exports — consumed only by compiler-generated code.
 *
 * Users should import from 'thane' (the main entry point) for public APIs
 * like signal, computed, defineComponent, mount, etc.
 *
 * This module is mapped to the 'thane/runtime' sub-path export so that
 * compiler-injected imports don't pollute the public API surface.
 *
 * @internal — not part of the public API.
 */

export {
  __registerComponent,
  __registerComponentLean,
  __enableComponentStyles,
  __dc,
} from './component.js';

export { __bindIf, __bindIfExpr, createKeyedReconciler } from './dom-binding.js';
