/**
 * HTML Parser — Public API
 *
 * Re-exports all types and functions from the split parser modules.
 * Import from this file (or the parent utils/index) for the public API.
 */

// Types
export type {
  ParserState,
  AttributeInfo,
  TextNode,
  HtmlElement,
  BindingInfo,
  ParseDiagnostic,
  ParsedTemplate,
  HtmlEdit,
  EventBindingDescriptor,
} from './types.js';

export { VOID_ELEMENTS, decodeHtmlEntities } from './types.js';

// Parser core
export { parseHtmlTemplate } from './parser-core.js';

// Binding detection
export {
  parseWhenElseExpression,
  parseRepeatExpression,
  findBindingsInText,
  findBindingsInAttributes,
} from './binding-detection.js';

// Utilities
export {
  walkElements,
  findElements,
  findElementsWithAttribute,
  findElementsWithWhenDirective,
  getElementHtml,
  getElementInnerHtml,
  getBindingsForElement,
  isElementInside,
  applyHtmlEdits,
  createIdInjectionEdit,
  createDataAttrEdit,
  createWhenDirectiveRemovalEdit,
  createEventBindingRemovalEdit,
  createSignalReplacementEdits,
  extractEventBindings,
  groupBindingsByElement,
  isPositionInRanges,
  findElementsNeedingIds,
  createIdGenerator,
  normalizeHtmlWhitespace,
  injectIdIntoFirstElement,
  escapeTemplateLiteral,
  escapeRawTemplateLiteral,
} from './html-utils.js';
