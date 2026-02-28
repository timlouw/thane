export { FRAMEWORK_FN as FN, COMPILER_BIND_FN as BIND_FN } from '../../contracts/index.js';

export const PROP = {
  SELECTOR: 'selector',
  COMPONENT_MODULE: 'componentModule',
  /** New-style route property: directly resolves to the component factory. */
  COMPONENT: 'component',
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

/** Shared browser targets used by the esbuild build runner.
 * Minimum versions are set to support CSS Nesting (used by component scoped styles)
 * and modern JS features (optional chaining, nullish coalescing, etc.).
 */
export const BROWSER_TARGETS = ['es2022', 'chrome120', 'firefox117', 'safari17.2', 'edge120'] as const;

export const generateSelectorHTML = (selector: string): string => `<${selector}></${selector}>`;
