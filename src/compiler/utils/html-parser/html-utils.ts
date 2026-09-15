/**
 * HTML Parser — Utility functions for working with parsed HTML
 */

import type { Range } from '../../types.js';
import type { HtmlElement, BindingInfo, HtmlEdit, ParsedTemplate, EventBindingDescriptor } from './types.js';
import { SIGNAL_EXPR_REGEX } from './types.js';

export function walkElements(roots: HtmlElement[], callback: (element: HtmlElement, depth: number) => void): void {
  const walk = (elements: HtmlElement[], depth: number) => {
    for (const el of elements) {
      callback(el, depth);
      walk(el.children, depth + 1);
    }
  };
  walk(roots, 0);
}

export function findElements(roots: HtmlElement[], predicate: (el: HtmlElement) => boolean): HtmlElement[] {
  const results: HtmlElement[] = [];
  walkElements(roots, (el) => {
    if (predicate(el)) {
      results.push(el);
    }
  });
  return results;
}

export function findElementsWithAttribute(roots: HtmlElement[], attrName: string): HtmlElement[] {
  return findElements(roots, (el) => el.attributes.has(attrName));
}

export function findElementsWithWhenDirective(roots: HtmlElement[]): HtmlElement[] {
  return findElements(roots, (el) => el.whenDirective !== undefined);
}

export function getElementHtml(element: HtmlElement, html: string): string {
  return html.substring(element.tagStart, element.closeTagEnd);
}

export function getElementInnerHtml(element: HtmlElement, html: string): string {
  if (element.isSelfClosing || element.isVoid) {
    return '';
  }
  return html.substring(element.openTagEnd, element.closeTagStart);
}

export function getBindingsForElement(element: HtmlElement, bindings: BindingInfo[]): BindingInfo[] {
  const elementIds = new Set<HtmlElement>();

  const collectElements = (el: HtmlElement) => {
    elementIds.add(el);
    for (const child of el.children) {
      collectElements(child);
    }
  };
  collectElements(element);

  return bindings.filter((b) => elementIds.has(b.element));
}

/** Whether the element sits inside an `<svg>` subtree (including the `<svg>` element itself). */
export function isInsideSvg(element: HtmlElement | null): boolean {
  for (let el = element; el; el = el.parent) {
    if (el.tagName.toLowerCase() === 'svg') return true;
  }
  return false;
}

/**
 * Attributes that a dynamic binding writes as a DOM property on HTML elements. For the boolean
 * ones (`checked`, `disabled`, …) an attribute write would mean "present" whatever the value;
 * for `value` the attribute is only the default, not what the field shows. The static
 * template ships none of these attributes for a bound element (see stripPropertyBoundAttributes).
 * `class` goes through `className` because it is the cheaper write.
 */
const HTML_ATTRIBUTE_PROPERTIES: Record<string, string> = {
  class: 'className',
  style: 'style.cssText',
  value: 'value',
  checked: 'checked',
  selected: 'selected',
  disabled: 'disabled',
  open: 'open',
  hidden: 'hidden',
  readonly: 'readOnly',
  required: 'required',
  multiple: 'multiple',
  indeterminate: 'indeterminate',
  muted: 'muted',
};

/**
 * The DOM property a dynamic attribute is written through instead of `setAttribute`, or
 * undefined for a plain attribute. SVG elements keep `setAttribute` for everything (their
 * `className` is a read-only SVGAnimatedString, and the table is about HTML form semantics).
 */
export function attributeDomProperty(attrName: string, element: HtmlElement | null): string | undefined {
  if (isInsideSvg(element)) return undefined;
  return HTML_ATTRIBUTE_PROPERTIES[attrName.toLowerCase()];
}

export function isElementInside(element: HtmlElement, container: HtmlElement): boolean {
  let current = element.parent;
  while (current) {
    if (current === container) return true;
    current = current.parent;
  }
  return false;
}

export function applyHtmlEdits(html: string, edits: HtmlEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let result = html;
  for (const edit of sorted) {
    result = result.substring(0, edit.start) + edit.replacement + result.substring(edit.end);
  }
  return result;
}

export function createIdInjectionEdit(element: HtmlElement, id: string): HtmlEdit | null {
  if (element.attributes.has('id')) {
    return null;
  }
  return {
    start: element.tagNameEnd,
    end: element.tagNameEnd,
    replacement: ` id="${id}"`,
  };
}

export function createDataAttrEdit(element: HtmlElement, attrName: string, attrValue: string): HtmlEdit {
  return {
    start: element.tagNameEnd,
    end: element.tagNameEnd,
    replacement: ` ${attrName}="${attrValue}"`,
  };
}

export function createWhenDirectiveRemovalEdit(element: HtmlElement): HtmlEdit | null {
  if (!element.whenDirective || element.whenDirectiveStart === undefined || element.whenDirectiveEnd === undefined) {
    return null;
  }
  return {
    start: element.whenDirectiveStart,
    end: element.whenDirectiveEnd,
    replacement: '',
  };
}

export function createEventBindingRemovalEdit(binding: BindingInfo): HtmlEdit | null {
  if (binding.type !== 'event') {
    return null;
  }
  return {
    start: binding.expressionStart,
    end: binding.expressionEnd,
    replacement: '',
  };
}

export function createSignalReplacementEdits(
  html: string,
  signalValues: Map<string, string | number | boolean>,
  excludeRanges: Range[] = [],
): HtmlEdit[] {
  const edits: HtmlEdit[] = [];
  const signalExprRegex = SIGNAL_EXPR_REGEX();
  let match: RegExpExecArray | null;

  while ((match = signalExprRegex.exec(html)) !== null) {
    const exprStart = match.index;
    const exprEnd = exprStart + match[0].length;

    const insideExcluded = excludeRanges.some((r) => exprStart >= r.start && exprStart < r.end);
    if (insideExcluded) continue;

    const signalName = match[1];
    if (!signalName) continue;
    const value = signalValues.get(signalName);
    if (value !== undefined) {
      edits.push({
        start: exprStart,
        end: exprEnd,
        replacement: String(value),
      });
    }
  }

  return edits;
}

export function extractEventBindings(parsed: ParsedTemplate): EventBindingDescriptor[] {
  const result: EventBindingDescriptor[] = [];

  for (const binding of parsed.bindings) {
    if (binding.type === 'event' && binding.eventName && binding.handlerExpression) {
      result.push({
        element: binding.element,
        eventName: binding.eventName,
        modifiers: binding.eventModifiers || [],
        handlerExpression: binding.handlerExpression,
        expressionStart: binding.expressionStart,
        expressionEnd: binding.expressionEnd,
      });
    }
  }

  return result;
}

export function groupBindingsByElement(bindings: BindingInfo[]): Map<HtmlElement, BindingInfo[]> {
  const map = new Map<HtmlElement, BindingInfo[]>();
  for (const binding of bindings) {
    if (!map.has(binding.element)) {
      map.set(binding.element, []);
    }
    map.get(binding.element)!.push(binding);
  }
  return map;
}

export function isPositionInRanges(pos: number, ranges: Range[]): boolean {
  return ranges.some((r) => pos >= r.start && pos < r.end);
}

export function findElementsNeedingIds(parsed: ParsedTemplate): HtmlElement[] {
  const elementsSet = new Set<HtmlElement>();

  for (const binding of parsed.bindings) {
    if (binding.type === 'text' || binding.type === 'style' || binding.type === 'attr' || binding.type === 'event') {
      elementsSet.add(binding.element);
    }
  }

  return Array.from(elementsSet);
}

export function createIdGenerator(prefix: string, startFrom = 0): () => string {
  let counter = startFrom;
  return () => `${prefix}${counter++}`;
}

export function normalizeHtmlWhitespace(html: string): string {
  return html.replace(/\s+/g, ' ').replace(/\s+>/g, '>').replace(/>\s+</g, '><').trim();
}

/**
 * Escape a string so it can be safely embedded inside a JS template literal.
 * Prevents backticks from breaking the literal and `${` from being
 * interpreted as a template expression.
 *
 * Use this for raw HTML / plain-text content that should appear verbatim
 * inside a template literal.
 */
export function escapeTemplateLiteral(s: string): string {
  return s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/**
 * Like {@link escapeTemplateLiteral} but also escapes backslashes.
 * Use when the source string may contain raw backslash sequences
 * (e.g., repeat item templates that originate from raw HTML source).
 */
export function escapeRawTemplateLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

export function injectIdIntoFirstElement(html: string, id: string): string {
  const trimmed = html.trim();
  const firstTagMatch = trimmed.match(/^<(\w+)([^>]*)>/);
  if (!firstTagMatch) {
    return trimmed;
  }

  const tagName = firstTagMatch[1];
  if (!tagName) return trimmed;
  const existingAttrs = firstTagMatch[2] || '';
  if (/\sid\s*=\s*['"][^'"]*['"]/.test(existingAttrs)) {
    return trimmed;
  }
  const tagNameEnd = tagName.length + 1;

  return trimmed.substring(0, tagNameEnd) + ` id="${id}"` + trimmed.substring(tagNameEnd);
}

/** The `id` attribute of a template's first element, if it has one. */
export function firstElementId(html: string): string | undefined {
  const firstTagMatch = html.trim().match(/^<(\w+)([^>]*)>/);
  return firstTagMatch?.[2]?.match(/\sid\s*=\s*['"]([^'"]*)['"]/)?.[1];
}
