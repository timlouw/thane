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
  KEYED_RECONCILER: 'createKeyedReconciler',
  ENABLE_STYLES: '__enableComponentStyles',
  REGISTER_COMPONENT: '__registerComponent',
  REGISTER_COMPONENT_LEAN: '__registerComponentLean',
  DESTROY_CHILD: '__dc',
} as const;

/** Shared browser targets used by the esbuild build runner.
 * Minimum versions are set to support CSS Nesting (used by component scoped styles)
 * and modern JS features (optional chaining, nullish coalescing, etc.).
 */
export const BROWSER_TARGETS = ['es2022', 'chrome120', 'firefox117', 'safari17.2', 'edge120'] as const;

export const generateSelectorHTML = (selector: string): string => `<${selector}></${selector}>`;
