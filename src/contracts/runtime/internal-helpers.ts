export const PUBLIC_RUNTIME_SPECIFIER = 'thane';
export const INTERNAL_RUNTIME_SPECIFIER = 'thane/runtime';
/** Where a compiled file with a list imports Node's `cloneNode` and `insertBefore` from, as `_cloneNode` and `_insertBefore` */
export const DOM_RUNTIME_SPECIFIER = 'thane/runtime/dom';

export const RUNTIME_HELPER = {
  IF: '__bindIf',
  IF_EXPR: '__bindIfExpr',
  KEYED_RECONCILER: 'createKeyedReconciler',
  BATCH_ROWS: '__batchRows',
  TEMPLATE: '__T',
  NO_CLEANUPS: '__nc',
  ENABLE_STYLES: '__enableComponentStyles',
  ENABLE_KEYFRAMES: '__enableKeyframeScoping',
  REGISTER_COMPONENT: '__registerComponent',
  REGISTER_COMPONENT_LEAN: '__registerComponentLean',
  DESTROY_CHILD: '__dc',
  ROW_CHILD: '__rc',
  MOUNT_FRAGMENT: '__mf',
  SIGNAL: '__sig',
  MOUNT_COMPONENT: 'mountComponent',
} as const;

export type RuntimeHelperName = (typeof RUNTIME_HELPER)[keyof typeof RUNTIME_HELPER];
