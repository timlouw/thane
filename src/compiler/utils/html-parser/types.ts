/**
 * HTML Parser — Type definitions
 */

export type ParserState =
  | 'TEXT'
  | 'TAG_OPEN'
  | 'TAG_NAME'
  | 'TAG_SPACE'
  | 'ATTR_NAME'
  | 'ATTR_EQ'
  | 'ATTR_VALUE_Q'
  | 'ATTR_VALUE_UQ'
  | 'TAG_CLOSE'
  | 'SELF_CLOSE'
  | 'COMMENT';

export interface AttributeInfo {
  name: string;
  value: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
}

export interface TextNode {
  content: string;
  start: number;
  end: number;
}

/**
 * Base element with shared properties for all element types
 */
interface HtmlElementBase {
  tagName: string;
  tagStart: number;
  tagNameEnd: number;
  openTagEnd: number;
  closeTagStart: number;
  closeTagEnd: number;
  attributes: Map<string, AttributeInfo>;
  children: HtmlElement[];
  parent: HtmlElement | null;
  textContent: TextNode[];
}

/**
 * A void or self-closing element (no closing tag, no when directive)
 */
interface VoidElement extends HtmlElementBase {
  isSelfClosing: true;
  isVoid: boolean;
  whenDirective?: undefined;
  whenDirectiveStart?: undefined;
  whenDirectiveEnd?: undefined;
}

/**
 * A standard element with closing tag and optional when directive
 */
interface StandardElement extends HtmlElementBase {
  isSelfClosing: false;
  isVoid: false;
  whenDirective?: string;
  whenDirectiveStart?: number;
  whenDirectiveEnd?: number;
}

/**
 * A void element (br, img, etc.) that is not self-closing via />
 */
interface ImplicitVoidElement extends HtmlElementBase {
  isSelfClosing: false;
  isVoid: true;
  whenDirective?: string;
  whenDirectiveStart?: number;
  whenDirectiveEnd?: number;
}

export type HtmlElement = VoidElement | StandardElement | ImplicitVoidElement;

export interface BindingInfo {
  element: HtmlElement;
  type: 'text' | 'style' | 'attr' | 'when' | 'whenElse' | 'repeat' | 'event';
  signalName: string;
  signalNames?: string[] | undefined;
  property?: string | undefined;
  expressionStart: number;
  expressionEnd: number;
  fullExpression: string;
  jsExpression?: string | undefined;
  thenTemplate?: string | undefined;
  elseTemplate?: string | undefined;
  itemsExpression?: string | undefined;
  itemVar?: string | undefined;
  indexVar?: string | undefined;
  itemTemplate?: string | undefined;
  emptyTemplate?: string | undefined;
  trackByFn?: string | undefined;
  eventName?: string | undefined;
  eventModifiers?: string[] | undefined;
  handlerExpression?: string | undefined;
}

export interface ParseDiagnostic {
  message: string;
  position: number;
  severity: 'error' | 'warning';
}

export interface ParsedTemplate {
  roots: HtmlElement[];
  bindings: BindingInfo[];
  html: string;
  diagnostics: ParseDiagnostic[];
}

export interface HtmlEdit {
  start: number;
  end: number;
  replacement: string;
}

export interface EventBindingDescriptor {
  element: HtmlElement;
  eventName: string;
  modifiers: string[];
  handlerExpression: string;
  expressionStart: number;
  expressionEnd: number;
}

export const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * HTML entity map for decoding common entities
 */
export const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': '\u00A0',
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&trade;': '\u2122',
  '&mdash;': '\u2014',
  '&ndash;': '\u2013',
  '&laquo;': '\u00AB',
  '&raquo;': '\u00BB',
  '&bull;': '\u2022',
  '&hellip;': '\u2026',
  '&larr;': '\u2190',
  '&rarr;': '\u2192',
  '&uarr;': '\u2191',
  '&darr;': '\u2193',
};

/**
 * Decode HTML entities in a string
 */
export function decodeHtmlEntities(text: string): string {
  // Named entities
  let result = text.replace(/&[a-zA-Z]+;/g, (entity) => {
    return HTML_ENTITIES[entity] ?? entity;
  });
  // Numeric entities (decimal)
  result = result.replace(/&#(\d+);/g, (_, code) => {
    const num = parseInt(code, 10);
    return isNaN(num) ? _ : String.fromCodePoint(num);
  });
  // Numeric entities (hex)
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
    const num = parseInt(code, 16);
    return isNaN(num) ? _ : String.fromCodePoint(num);
  });
  return result;
}

// Pre-compiled regex factories — return fresh instances to avoid stale lastIndex bugs with /g
export const WHEN_ELSE_REGEX = () => /\$\{whenElse\(/g;
export const REPEAT_REGEX = () => /\$\{repeat\(/g;
export const SIGNAL_EXPR_REGEX = () => /\$\{this\.(\w+)\(\)\}/g;
export const SIGNAL_CALL_REGEX = () => /this\.(\w+)\(\)/g;
export const STYLE_EXPR_REGEX = () => /([\w-]+)\s*:\s*(\$\{this\.(\w+)\(\)\})/g;
export const ATTR_EXPR_REGEX = () => /\$\{this\.(\w+)\(\)\}/g;
