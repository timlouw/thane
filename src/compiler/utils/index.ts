/**
 * Compiler utilities index
 */

export { consoleColors, ansi, supportsColor } from './colors.js';
export { logger, Logger } from './logger.js';

export {
  safeReadFile,
  collectFilesRecursively,
  getContentType,
  createBuildContext,
  refreshBuildContext,
  resolveProjectRoot,
  projectRootWarning,
} from './file-utils.js';

export { applyEdits } from './source-editor.js';
export { closestName } from './closest-name.js';
export type { SourceEdit } from './source-editor.js';

export {
  createSourceFile,
  isFunctionCall,
  isDefineComponentCall,
  isSignalCall,
  constSignalDeclarations,
  hotSignalEdits,
  extractComponentDefinitions,
  findComponentDeclarations,
  type ComponentDeclaration,
  findExportedFragments,
  extractFragmentDefinitions,
  type FragmentDeclaration,
  extractStaticValue,
  findSignalInitializers,
  isHtmlTemplate,
  hasHtmlTemplates,
  toCamelCase,
  pascalToKebab,
  replaceReferences,
  expressionReferencesIdentifier,
  parseArrowFunction,
  isFunctionExpressionText,
} from './ast-utils.js';

export { sourceCache } from './cache.js';

export { createLoaderResult, extendsComponentQuick } from './plugin-helper.js';

export { PLUGIN_NAME, BIND_FN, BROWSER_TARGETS, FN } from './constants.js';

export * from './html-parser/index.js';
