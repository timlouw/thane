/**
 * HTML Parser — Type definitions
 */

import type { ParserBindingKind, ParserStateKind } from '../../../contracts/index.js';

export type ParserState = ParserStateKind;

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
  /** The `${…}`s alone in the tag other than `when()` (an element ref), as written, with their spans */
  tagValues?: { text: string; start: number; end: number }[] | undefined;
}

/**
 * A void or self-closing element (no closing tag, no when directive)
 */
interface VoidElement extends HtmlElementBase {
  isSelfClosing: true;
  isVoid: boolean;
  whenDirective?: string;
  whenDirectiveStart?: number;
  whenDirectiveEnd?: number;
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
  type: ParserBindingKind;
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

export const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// Regex factories — fresh instances to avoid stale lastIndex bugs with /g.
// Match BARE signal calls: signalName() — NOT this.signalName()
/** `${when(` in content: a conditional with its templates (in a tag, `${when(cond)}` shows the element) */
export const WHEN_CONTENT_REGEX = () => /\$\{when\(/g;
export const REPEAT_REGEX = () => /\$\{repeat\(/g;
export const SIGNAL_EXPR_REGEX = () => /\$\{(\w+)\(\)\}/g;
