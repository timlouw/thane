export const FN = {
  DEFINE_COMPONENT: 'defineComponent',
  SIGNAL: 'signal',
  WHEN: 'when',
  WHEN_ELSE: 'whenElse',
  REPEAT: 'repeat',
  HTML: 'html',
  CSS: 'css',
} as const;

export const PROP = {
  SELECTOR: 'selector',
  COMPONENT_MODULE: 'componentModule',
} as const;

export const PLUGIN_NAME = {
  TYPE_CHECK: 'type-check',
  ROUTES: 'routes-ctfe',
  COMPONENT: 'component-ctfe',
  REACTIVE: 'reactive-binding',
  LINTER: 'thane-linter',
  GLOBAL_CSS_BUNDLER: 'global-css-bundler',
  POST_BUILD: 'post-build',
} as const;

export const BIND_FN = {
  TEXT: '__bindText',
  STYLE: '__bindStyle',
  ATTR: '__bindAttr',
  IF: '__bindIf',
  IF_EXPR: '__bindIfExpr',
  REPEAT: '__bindRepeat',
  RECONCILER: 'createReconciler',
  KEYED_RECONCILER: 'createKeyedReconciler',
  NESTED_REPEAT: '__bindNestedRepeat',
  FIND_EL: '__findEl',
  FIND_TEXT_NODE: '__findTextNode',
  ENABLE_STYLES: '__enableComponentStyles',
  REGISTER_COMPONENT: '__registerComponent',
  REGISTER_COMPONENT_LEAN: '__registerComponentLean',
} as const;

export const generateSelectorHTML = (selector: string): string => `<${selector}></${selector}>`;
