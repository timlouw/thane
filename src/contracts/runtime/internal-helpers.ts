export const PUBLIC_RUNTIME_SPECIFIER = 'thane';
export const INTERNAL_RUNTIME_SPECIFIER = 'thane/runtime';

export const RUNTIME_HELPER = {
  IF: '__bindIf',
  IF_EXPR: '__bindIfExpr',
  KEYED_RECONCILER: 'createKeyedReconciler',
  ENABLE_STYLES: '__enableComponentStyles',
  REGISTER_COMPONENT: '__registerComponent',
  REGISTER_COMPONENT_LEAN: '__registerComponentLean',
  DESTROY_CHILD: '__dc',
} as const;

export type RuntimeHelperName = (typeof RUNTIME_HELPER)[keyof typeof RUNTIME_HELPER];
