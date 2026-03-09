export { TSCTypeCheckerPlugin } from './tsc-type-checker/tsc-type-checker.js';
export { ProjectTypesSyncPlugin } from './router-typegen/router-typegen.js';

export { ComponentPrecompilerPlugin } from './component-precompiler/component-precompiler.js';

export { ReactiveBindingPlugin } from './reactive-binding-compiler/index.js';

export { ThaneLinterPlugin } from './thane-linter/thane-linter.js';
export type { ThaneLinterOptions } from './thane-linter/thane-linter.js';
export type { LintRule, LintRuleMeta, LintRuleDefinition } from './thane-linter/rules/types.js';

export { GlobalCSSBundlerPlugin } from './global-css-bundler/global-css-bundler.js';

export { HTMLBootstrapInjectorPlugin } from './html-bootstrap-injector/html-bootstrap-injector.js';

export { MinificationPlugin, minifySelectorsInHTML } from './minification/minification.js';

export { JSOutputOptimizerPlugin } from './js-output-optimizer/js-output-optimizer.js';

export { PostBuildPlugin } from './post-build-processor/post-build-processor.js';
