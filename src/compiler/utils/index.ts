/**
 * Compiler utilities index
 */

export { consoleColors, ansi } from './colors.js';
export { logger, Logger } from './logger.js';

export { safeReadFile, collectFilesRecursively, directoryExists, getContentType, createBuildContext } from './file-utils.js';

export { applyEdits, removeCode } from './source-editor.js';
export type { SourceEdit, CodeRemoval } from './source-editor.js';

export {
  createSourceFile,
  isFunctionCall,
  isRegisterComponentCall,
  isSignalCall,
  getSignalGetterName,
  extractRegisterComponentConfig,
  extractComponentDefinitions,
  extractPageSelector,
  findClassExtending,
  findComponentClass,
  findEnclosingClass,
  extractStaticValue,
  findSignalInitializers,
  isHtmlTemplate,
  isCssTemplate,
  extractTemplateContent,
  extendsComponent,
  hasHtmlTemplates,
  findSignalReferences,
  toKebabCase,
  toCamelCase,
  generateComponentHTML,
  FN,
  CLASS,
  COMPONENT_TYPE,
  PROP,
} from './ast-utils.js';

export { sourceCache } from './cache.js';

export { shouldSkipPath, hasSignalPatterns, createLoaderResult, extendsComponentQuick } from './plugin-helper.js';

export { PLUGIN_NAME, BIND_FN, generateSelectorHTML } from './constants.js';

export * from './html-parser.js';
