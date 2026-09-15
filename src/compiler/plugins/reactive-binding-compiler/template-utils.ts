/**
 * Shared template processing utilities
 *
 * Extracted from template-processing.ts and repeat-analysis.ts to
 * eliminate ~300 lines of near-identical conditional/whenElse/edit logic.
 */

import type { Range } from '../../types.js';
import type { ConditionalBlock, WhenElseBlock, RepeatBlock, BindingInfo, EventBinding } from './types.js';
import {
  findElementsWithWhenDirective,
  walkElements,
  getElementHtml,
  injectIdIntoFirstElement,
  firstElementId,
  type HtmlElement,
  type ParsedTemplate,
} from '../../utils/html-parser/index.js';
import { safeEvaluateCondition } from './template-processing.js';

// ============================================================================
// Shared types
// ============================================================================

export interface IdState {
  /** Monotonically increasing ID counter for binding element IDs (b0, b1, …) */
  idCounter: number;
  /** Counter for event binding IDs (e0, e1, …) */
  eventIdCounter: { value: number };
  /** Map from HtmlElement → assigned binding ID */
  elementIdMap: Map<HtmlElement, string>;
}

export interface TemplateEdit {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Result of processing a directive sub-template — a whenElse branch or the
 * content of a when() element.
 */
export interface SubTemplateResult {
  processedContent: string;
  bindings: BindingInfo[];
  conditionals: ConditionalBlock[];
  whenElseBlocks: WhenElseBlock[];
  repeatBlocks: RepeatBlock[];
  eventBindings?: EventBinding[];
  nextId: number;
}

/**
 * Processes a directive sub-template. `parentId` is the id the sub-template's
 * root element must carry so the runtime can locate it.
 */
export type SubTemplateProcessor = (template: string, parentId: string) => SubTemplateResult;

// ============================================================================
// Directive nesting helpers
// ============================================================================

/**
 * True when [start, end) sits strictly inside one of the given ranges.
 *
 * A directive expression nested inside another directive's range is owned by
 * that directive's recursive sub-template processing. Collecting it at the
 * outer level as well would emit overlapping template edits that corrupt the
 * HTML adjacent to the outer directive.
 */
export const isNestedInsideAny = (start: number, end: number, ranges: Range[]): boolean => {
  for (const r of ranges) {
    if (start > r.start && end < r.end) return true;
  }
  return false;
};

/** Source ranges of every repeat()/whenElse() expression and when() element in a parsed template. */
export const collectDirectiveRanges = (
  parsed: ParsedTemplate,
): { repeat: Range[]; whenElse: Range[]; conditional: Range[] } => {
  const repeat: Range[] = [];
  const whenElse: Range[] = [];
  for (const binding of parsed.bindings) {
    if (binding.type === 'repeat') {
      repeat.push({ start: binding.expressionStart, end: binding.expressionEnd });
    } else if (binding.type === 'whenElse') {
      whenElse.push({ start: binding.expressionStart, end: binding.expressionEnd });
    }
  }
  const conditional = findElementsWithWhenDirective(parsed.roots).map((el) => ({
    start: el.tagStart,
    end: el.closeTagEnd,
  }));
  return { repeat, whenElse, conditional };
};

/** The element's HTML with its `${when(...)}` directive removed, ready to be processed as a plain sub-template. */
const getElementHtmlWithoutWhenDirective = (element: HtmlElement, html: string): string => {
  if (element.whenDirectiveStart === undefined || element.whenDirectiveEnd === undefined) {
    return getElementHtml(element, html);
  }
  return (
    html.slice(element.tagStart, element.whenDirectiveStart) + html.slice(element.whenDirectiveEnd, element.closeTagEnd)
  );
};

// ============================================================================
// collectConditionalBlocks
// ============================================================================

/**
 * Shared conditional processing: find all when() directives in parsed HTML and
 * build ConditionalBlock entries.
 *
 * Each when() element's content is processed as a full sub-template, exactly like a
 * whenElse branch, so it supports nested when/whenElse/repeat directives, per-element
 * event bindings and child component mounts. Nested when() elements are collected by the
 * recursive processing of their parent, so only top-level ones are handled here.
 */
export const collectConditionalBlocks = (
  parsed: ParsedTemplate,
  templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  state: IdState,
  opts: {
    /** Process each when() element's content as a full sub-template (see above) */
    processSubTemplate: SubTemplateProcessor;
    /** Rewrite the when() condition before it is stored (row templates route item reads through a signal). */
    rewriteExpression?: (expr: string) => { expression: string; extraSignals: string[] };
  },
): {
  conditionals: ConditionalBlock[];
  bindings: BindingInfo[];
} => {
  const conditionals: ConditionalBlock[] = [];
  const bindings: BindingInfo[] = [];

  const allConditionalElements = findElementsWithWhenDirective(parsed.roots);
  const elementsInsideConditionals = new Set<HtmlElement>();
  for (const condEl of allConditionalElements) {
    walkElements([condEl], (el) => {
      if (el !== condEl) elementsInsideConditionals.add(el);
    });
  }
  const targetElements = allConditionalElements.filter((el) => !elementsInsideConditionals.has(el));

  for (const condEl of targetElements) {
    const whenBinding = parsed.bindings.find((b) => b.element === condEl && b.type === 'when');
    if (!whenBinding || !whenBinding.jsExpression) continue;

    const rewritten = opts.rewriteExpression?.(whenBinding.jsExpression);
    const jsExpression = rewritten ? rewritten.expression : whenBinding.jsExpression;
    const signalNames = [
      ...new Set([...(whenBinding.signalNames || [whenBinding.signalName]), ...(rewritten?.extraSignals ?? [])]),
    ].filter((s) => s !== '');
    // Reuse user-defined ID if the element already has one, otherwise generate a compiler ID
    const existingId = condEl.attributes.get('id');
    const conditionalId = existingId ? existingId.value : `b${state.idCounter++}`;
    state.elementIdMap.set(condEl, conditionalId);
    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);
    const base = {
      id: conditionalId,
      signalName: signalNames[0] ?? '',
      signalNames,
      jsExpression,
      initialValue,
      startIndex: condEl.tagStart,
      endIndex: condEl.closeTagEnd,
    };

    const processed = opts.processSubTemplate(
      getElementHtmlWithoutWhenDirective(condEl, templateContent),
      conditionalId,
    );
    state.idCounter = processed.nextId;
    conditionals.push({
      ...base,
      templateContent: injectIdIntoFirstElement(processed.processedContent, conditionalId),
      nestedBindings: processed.bindings,
      nestedConditionals: processed.conditionals,
      nestedWhenElse: processed.whenElseBlocks,
      nestedRepeats: processed.repeatBlocks,
      nestedEventBindings: processed.eventBindings ?? [],
    });
    bindings.push(...processed.bindings);
  }

  return { conditionals, bindings };
};

// ============================================================================
// collectWhenElseBlocks
// ============================================================================

/**
 * Shared whenElse processing: find all whenElse() directives in parsed HTML,
 * process sub-templates, and build WhenElseBlock entries.
 */
export const collectWhenElseBlocks = (
  parsed: ParsedTemplate,
  signalInitializers: Map<string, string | number | boolean>,
  state: IdState,
  processSubTemplate: SubTemplateProcessor,
  rewriteExpression?: (expr: string) => { expression: string; extraSignals: string[] },
): WhenElseBlock[] => {
  const whenElseBlocks: WhenElseBlock[] = [];

  for (const binding of parsed.bindings) {
    if (binding.type !== 'whenElse') continue;
    if (!binding.jsExpression || !binding.thenTemplate || !binding.elseTemplate) continue;

    const rewritten = rewriteExpression?.(binding.jsExpression);
    const jsExpression = rewritten ? rewritten.expression : binding.jsExpression;
    const signalNames = [
      ...new Set([...(binding.signalNames || [binding.signalName]), ...(rewritten?.extraSignals ?? [])]),
    ].filter((s) => s !== '');
    // A branch root's own id is the branch id: nothing is injected and the id survives
    const thenId = firstElementId(binding.thenTemplate) ?? `b${state.idCounter++}`;
    const elseId = firstElementId(binding.elseTemplate) ?? `b${state.idCounter++}`;
    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);

    const thenProcessed = processSubTemplate(binding.thenTemplate, thenId);
    state.idCounter = thenProcessed.nextId;
    const elseProcessed = processSubTemplate(binding.elseTemplate, elseId);
    state.idCounter = elseProcessed.nextId;

    whenElseBlocks.push({
      thenId,
      elseId,
      signalName: signalNames[0] || '',
      signalNames,
      jsExpression,
      initialValue,
      thenTemplate: thenProcessed.processedContent,
      elseTemplate: elseProcessed.processedContent,
      startIndex: binding.expressionStart,
      endIndex: binding.expressionEnd,
      thenBindings: thenProcessed.bindings,
      elseBindings: elseProcessed.bindings,
      thenRepeats: thenProcessed.repeatBlocks,
      elseRepeats: elseProcessed.repeatBlocks,
      thenEventBindings: thenProcessed.eventBindings ?? [],
      elseEventBindings: elseProcessed.eventBindings ?? [],
      thenConditionals: thenProcessed.conditionals,
      elseConditionals: elseProcessed.conditionals,
      thenWhenElse: thenProcessed.whenElseBlocks,
      elseWhenElse: elseProcessed.whenElseBlocks,
    });
  }

  return whenElseBlocks;
};

// ============================================================================
// buildRangeOverlapChecker
// ============================================================================

// Re-export Range from shared compiler types for backward compatibility
export type { Range } from '../../types.js';

/**
 * Build a fast predicate for checking whether a position falls inside any of
 * the given structural ranges (conditionals, whenElse, repeats).
 */
export const buildRangeOverlapChecker = (ranges: Range[]): ((start: number, end?: number) => boolean) => {
  return (start: number, _end?: number) => {
    for (const r of ranges) {
      if (start >= r.start && start < r.end) return true;
    }
    return false;
  };
};

// ============================================================================
// applyTemplateEdits
// ============================================================================

/**
 * Build the standard edit list for conditional/whenElse/repeat replacements
 * and apply them to the source template. Edits are applied in reverse order
 * to preserve positions.
 */
export const applyTemplateEdits = (source: string, edits: TemplateEdit[]): string => {
  edits.sort((a, b) => b.start - a.start);
  let result = source;
  for (const edit of edits) {
    result = result.substring(0, edit.start) + edit.replacement + result.substring(edit.end);
  }
  return result
    .replace(/\s+/g, ' ')
    .replace(/>\s+<(?![!-])/g, '><')
    .replace(/(<!--[ib]\d+-->)(<!---->)/g, '$1 $2')
    .replace(/\s+>/g, '>')
    .trim();
};

/**
 * Build standard edits from conditionals: replace with rendered content or hidden template.
 * A condition that could not be resolved at compile time (initialValue undefined)
 * is deferred: the runtime evaluates it at mount and shows the content if needed.
 */
export const buildConditionalEdits = (conditionals: ConditionalBlock[]): TemplateEdit[] => {
  return conditionals.map((cond) => ({
    start: cond.startIndex,
    end: cond.endIndex,
    replacement: cond.initialValue === true ? cond.templateContent : `<template id="${cond.id}"></template>`,
  }));
};

/**
 * Build standard edits from whenElse blocks.
 * @param injectIds If true, injects IDs into the first element of then/else templates (used by generateProcessedHtml and sub-template)
 */
export const buildWhenElseEdits = (
  whenElseBlocks: WhenElseBlock[],
  injectIds: boolean,
  injectIdFn?: (html: string, id: string) => string,
): TemplateEdit[] => {
  return whenElseBlocks.map((we) => {
    // initialValue === true  → pre-render then, defer else
    // initialValue === false → pre-render else, defer then
    // initialValue === undefined (not statically resolvable) → defer both; runtime evaluates at mount
    const thenReplacement =
      we.initialValue === true
        ? injectIds && injectIdFn
          ? injectIdFn(we.thenTemplate, we.thenId)
          : we.thenTemplate
        : `<template id="${we.thenId}"></template>`;
    const elseReplacement =
      we.initialValue === false
        ? injectIds && injectIdFn
          ? injectIdFn(we.elseTemplate, we.elseId)
          : we.elseTemplate
        : `<template id="${we.elseId}"></template>`;
    return {
      start: we.startIndex,
      end: we.endIndex,
      replacement: thenReplacement + elseReplacement,
    };
  });
};

/**
 * Remove attributes that a binding writes as a DOM property (checked, disabled, value, …) from
 * the static markup of their element. The property is set when the element is bound; an
 * attribute left in the template would mean "present" for a boolean, or a stale default for
 * `value`. `class` stays: an empty class attribute is harmless and lets the first write be
 * skipped when the value is empty.
 */
export const stripPropertyBoundAttributes = (
  html: string,
  bindings: Array<{ id?: string; elementId?: string; property?: string | undefined; domProperty?: string | undefined }>,
): string => {
  let out = html;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const b of bindings) {
    if (!b.domProperty || b.domProperty === 'className' || !b.property) continue;
    const id = b.id ?? b.elementId;
    if (!id) continue;
    const attr = `\\s${esc(b.property)}(?:="[^"]*"|='[^']*'|(?=[\\s/>]))`;
    out = out.replace(new RegExp(`(<[^>]*\\bid="${esc(id)}"[^>]*?)${attr}`), '$1');
    out = out.replace(new RegExp(`(<[^>]*?)${attr}([^>]*\\bid="${esc(id)}")`), '$1$2');
  }
  return out;
};

/**
 * Build edits to inject element IDs into non-conditional elements that have bindings.
 * Elements whose user-supplied id was reused as the binding id are left untouched.
 */
export const buildElementIdEdits = (
  elementIdMap: Map<HtmlElement, string>,
  allRanges: Range[],
  _opts?: {
    eventBindings?: EventBinding[];
    itemEvents?: Array<{ eventId: string; eventName: string; modifiers: string[] }>;
  },
): TemplateEdit[] => {
  const isInsideRange = buildRangeOverlapChecker(allRanges);
  const edits: TemplateEdit[] = [];

  for (const [element, id] of elementIdMap) {
    if (isInsideRange(element.tagStart)) continue;
    if (element.attributes.get('id')?.value === id) continue;

    edits.push({
      start: element.tagNameEnd,
      end: element.tagNameEnd,
      replacement: ` id="${id}"`,
    });
  }

  return edits;
};

/**
 * Build edits to replace ${signal()} expressions with their initial values.
 * Also handles expression text bindings like ${count() + 1}.
 */
export const buildSignalReplacementEdits = (
  _templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  allRanges: Range[],
  textBindingSpans?: Map<number, { spanId: string; exprEnd: number; signalName: string }>,
  expressionBindingSpans?: Map<number, { spanId: string; exprEnd: number }>,
  inlineExpressionReplacements?: Map<number, { exprEnd: number; replacement: string }>,
): TemplateEdit[] => {
  const isInsideRange = buildRangeOverlapChecker(allRanges);
  const edits: TemplateEdit[] = [];

  // Track positions already handled by expression bindings
  const expressionPositions = new Set<number>();

  if (inlineExpressionReplacements) {
    for (const [exprStart, { exprEnd, replacement }] of inlineExpressionReplacements) {
      if (isInsideRange(exprStart)) continue;
      expressionPositions.add(exprStart);
      edits.push({
        start: exprStart,
        end: exprEnd,
        replacement,
      });
    }
  }

  // ── Expression text bindings (e.g. ${count() + 1}) ──
  // Use comment marker: <!--bN--> with a space placeholder for the text node
  // An empty comment <!----> follows to prevent merging with subsequent static text
  if (expressionBindingSpans) {
    for (const [exprStart, { spanId, exprEnd }] of expressionBindingSpans) {
      if (isInsideRange(exprStart)) continue;
      expressionPositions.add(exprStart);

      edits.push({
        start: exprStart,
        end: exprEnd,
        // Comment marker + space placeholder + boundary comment
        replacement: `<!--${spanId}--> <!---->`,
      });
    }
  }

  // ── Bare signal replacements (e.g. ${count()}) — AST-driven, no regex ──
  if (textBindingSpans) {
    for (const [exprStart, { spanId, exprEnd, signalName }] of textBindingSpans) {
      if (isInsideRange(exprStart)) continue;
      if (expressionPositions.has(exprStart)) continue;

      const value = signalInitializers.get(signalName);
      const valueStr = value !== undefined ? String(value) : '';

      edits.push({
        start: exprStart,
        end: exprEnd,
        // Comment marker + initial value + boundary comment to prevent text merging
        replacement: `<!--${spanId}-->${valueStr || ' '}<!---->`,
      });
    }
  }

  return edits;
};
