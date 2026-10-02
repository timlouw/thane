/** Internal runtime exports used by compiler-generated code. */

export { signal as __sig } from './signal.js';
export {
  __registerComponent,
  __registerComponentLean,
  __enableComponentStyles,
  __enableKeyframeScoping,
  __dc,
  __rc,
  __T,
  mountComponent,
} from './component.js';
export { __bindIf, __bindIfExpr, createKeyedReconciler, __batchRows, __nc } from './dom-binding.js';
export { __mf } from './fragment.js';
export { __hotSignal } from './hot.js';
