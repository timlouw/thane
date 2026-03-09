/**
 * Compiler utilities index
 */

export { consoleColors, ansi, supportsColor } from './colors.js';
export { logger, Logger } from './logger.js';

export { safeReadFile, collectFilesRecursively, getContentType, createBuildContext } from './file-utils.js';

export { applyEdits, removeCode } from './source-editor.js';
export type { SourceEdit, CodeRemoval } from './source-editor.js';

export {
  createSourceFile,
  isFunctionCall,
  isDefineComponentCall,
  isSignalCall,
  getBareSignalGetterName,
  extractComponentDefinitions,
  extractPageSelector,
  findClassExtending,
  findEnclosingClass,
  extractStaticValue,
  findSignalInitializers,
  isHtmlTemplate,
  isCssTemplate,
  extractTemplateContent,
  hasHtmlTemplates,
  toKebabCase,
  toCamelCase,
  pascalToKebab,
  generateComponentHTML,
  renameIdentifierInExpression,
  expressionReferencesIdentifier,
  findComponentSignalCalls,
  parseArrowFunction,
  isThisMethodReference,
} from './ast-utils.js';

export { sourceCache } from './cache.js';

export { shouldSkipPath, hasSignalPatterns, createLoaderResult, extendsComponentQuick } from './plugin-helper.js';

export { PLUGIN_NAME, BIND_FN, BROWSER_TARGETS, FN, PROP } from './constants.js';

export * from './html-parser/index.js';
