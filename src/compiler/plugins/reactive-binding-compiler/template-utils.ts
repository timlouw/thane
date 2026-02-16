/**
 * Shared template processing utilities
 * 
 * Extracted from template-processing.ts and repeat-analysis.ts to
 * eliminate ~300 lines of near-identical conditional/whenElse/edit logic.
 */

import type {
  ConditionalBlock,
  WhenElseBlock,
  BindingInfo,
  EventBinding,
} from './types.js';
import {
  findElementsWithWhenDirective,
  walkElements,
  getBindingsForElement,
  type HtmlElement,
  type ParsedTemplate,
} from '../../utils/html-parser/index.js';
import { safeEvaluateCondition, processConditionalElementHtml } from './template-processing.js';

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

// ============================================================================
// collectConditionalBlocks
// ============================================================================

/**
 * Shared conditional processing: find all when() directives in parsed HTML,
 * build ConditionalBlock entries, and collect nested bindings/events.
 * 
 * Supports an optional `onConditionalHtml` callback for item-template contexts
 * that need to transform the conditional HTML (e.g., wrapping item expressions).
 * 
 * Returns the collected conditionals and associated binding/event arrays.
 */
export const collectConditionalBlocks = (
  parsed: ParsedTemplate,
  templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  state: IdState,
  opts?: {
    /** If true, look for nested conditionals inside top-level conditionals (main template only) */
    handleNestedConditionals?: boolean;
    /** Transform conditional HTML after processing (item templates use this for item binding wrapping) */
    onConditionalHtml?: (html: string, condEl: HtmlElement) => { html: string; extraData?: any };
  },
): {
  conditionals: ConditionalBlock[];
  bindings: BindingInfo[];
  eventBindings: EventBinding[];
} => {
  const conditionals: ConditionalBlock[] = [];
  const bindings: BindingInfo[] = [];
  const eventBindings: EventBinding[] = [];

  const allConditionalElements = findElementsWithWhenDirective(parsed.roots);
  const conditionalElementSet = new Set(allConditionalElements);
  const elementsInsideConditionals = new Set<HtmlElement>();
  for (const condEl of allConditionalElements) {
    walkElements([condEl], (el) => {
      if (el !== condEl) elementsInsideConditionals.add(el);
    });
  }

  // Determine which conditionals are top-level (not nested inside another conditional)
  const topLevelConditionals = opts?.handleNestedConditionals
    ? allConditionalElements.filter((el) => !elementsInsideConditionals.has(el))
    : allConditionalElements;

  // Build nested conditionals map if needed
  const nestedConditionalsMap = new Map<HtmlElement, HtmlElement[]>();
  if (opts?.handleNestedConditionals) {
    for (const condEl of topLevelConditionals) {
      const nested: HtmlElement[] = [];
      walkElements([condEl], (el) => {
        if (el !== condEl && conditionalElementSet.has(el)) nested.push(el);
      });
      nestedConditionalsMap.set(condEl, nested);
    }
  }

  for (const condEl of topLevelConditionals) {
    const whenBinding = parsed.bindings.find((b) => b.element === condEl && b.type === 'when');
    if (!whenBinding || !whenBinding.jsExpression) continue;

    const signalNames = whenBinding.signalNames || [whenBinding.signalName];
    const jsExpression = whenBinding.jsExpression;
    // Reuse user-defined ID if the element already has one, otherwise generate a compiler ID
    const existingId = condEl.attributes.get('id');
    const conditionalId = existingId ? existingId.value : `b${state.idCounter++}`;
    state.elementIdMap.set(condEl, conditionalId);

    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);
    const condBindings = getBindingsForElement(condEl, parsed.bindings);
    const nestedBindings: BindingInfo[] = [];

    // Track text binding comment-marker IDs: signalName → commentId
    const textBindingCommentIds = new Map<string, string>();
    for (const binding of condBindings) {
      if (binding.type === 'when' || binding.type === 'event') continue;
      let elementId: string;
      if (binding.type === 'text') {
        // Text bindings always get a dedicated comment marker ID
        elementId = `b${state.idCounter++}`;
        textBindingCommentIds.set(binding.signalName, elementId);
      } else if (binding.element === condEl) {
        elementId = conditionalId;
      } else {
        if (!state.elementIdMap.has(binding.element)) {
          state.elementIdMap.set(binding.element, `b${state.idCounter++}`);
        }
        elementId = state.elementIdMap.get(binding.element)!;
      }
      const isExpr = binding.type === 'text' && binding.jsExpression !== undefined && binding.signalNames && binding.signalNames.length > 0;
      if (isExpr) {
        nestedBindings.push({
          id: elementId,
          signalNames: binding.signalNames!,
          expression: binding.jsExpression!,
          type: 'text',
          isInsideConditional: true,
          conditionalId,
        });
      } else {
        nestedBindings.push({
          id: elementId,
          signalName: binding.signalName,
          type: binding.type as 'text' | 'style' | 'attr',
          ...(binding.property ? { property: binding.property } : {}),
          isInsideConditional: true,
          conditionalId,
        });
      }
    }

    // Handle nested conditionals (main template only)
    let nestedConditionals: ConditionalBlock[] = [];
    if (opts?.handleNestedConditionals) {
      const nestedCondElements = nestedConditionalsMap.get(condEl) || [];
      for (const nestedCondEl of nestedCondElements) {
        const nestedWhenBinding = parsed.bindings.find((b) => b.element === nestedCondEl && b.type === 'when');
        if (!nestedWhenBinding || !nestedWhenBinding.jsExpression) continue;

        const nestedSignalNames = nestedWhenBinding.signalNames || [nestedWhenBinding.signalName];
        const nestedJsExpression = nestedWhenBinding.jsExpression;
        // Reuse user-defined ID if the element already has one, otherwise generate a compiler ID
        const nestedExistingId = nestedCondEl.attributes.get('id');
        const nestedCondId = nestedExistingId ? nestedExistingId.value : `b${state.idCounter++}`;
        state.elementIdMap.set(nestedCondEl, nestedCondId);
        const nestedInitialValue = safeEvaluateCondition(nestedJsExpression, nestedSignalNames, signalInitializers);
        const nestedCondBindings = getBindingsForElement(nestedCondEl, parsed.bindings);
        const nestedNestedBindings: BindingInfo[] = [];

        const nestedTextBindingCommentIds = new Map<string, string>();
        for (const binding of nestedCondBindings) {
          if (binding.type === 'when' || binding.type === 'event') continue;
          let nestedElementId: string;
          if (binding.type === 'text') {
            nestedElementId = `b${state.idCounter++}`;
            nestedTextBindingCommentIds.set(binding.signalName, nestedElementId);
          } else if (binding.element === nestedCondEl) {
            nestedElementId = nestedCondId;
          } else {
            if (!state.elementIdMap.has(binding.element)) {
              state.elementIdMap.set(binding.element, `b${state.idCounter++}`);
            }
            nestedElementId = state.elementIdMap.get(binding.element)!;
          }
          const isExpr = binding.type === 'text' && binding.jsExpression !== undefined && binding.signalNames && binding.signalNames.length > 0;
          if (isExpr) {
            nestedNestedBindings.push({
              id: nestedElementId,
              signalNames: binding.signalNames!,
              expression: binding.jsExpression!,
              type: 'text',
              isInsideConditional: true,
              conditionalId: nestedCondId,
            });
          } else {
            nestedNestedBindings.push({
              id: nestedElementId,
              signalName: binding.signalName,
              type: binding.type as 'text' | 'style' | 'attr',
              ...(binding.property ? { property: binding.property } : {}),
              isInsideConditional: true,
              conditionalId: nestedCondId,
            });
          }
        }

        const nestedProcessedResult = processConditionalElementHtml(nestedCondEl, templateContent, signalInitializers, state.elementIdMap, nestedCondId, undefined, state.eventIdCounter, nestedTextBindingCommentIds);
        const primarySignal = nestedSignalNames[0];
        if (!primarySignal) continue;

        nestedConditionals.push({
          id: nestedCondId,
          signalName: primarySignal,
          signalNames: nestedSignalNames,
          jsExpression: nestedJsExpression,
          initialValue: nestedInitialValue,
          templateContent: nestedProcessedResult.html,
          startIndex: nestedCondEl.tagStart,
          endIndex: nestedCondEl.closeTagEnd,
          nestedBindings: nestedNestedBindings,
          nestedItemBindings: [],
          nestedConditionals: [],
          nestedEventBindings: nestedProcessedResult.eventBindings,
        });
      }
    }

    const processedCondResult = processConditionalElementHtml(
      condEl, templateContent, signalInitializers, state.elementIdMap, conditionalId,
      opts?.handleNestedConditionals ? nestedConditionals : undefined,
      state.eventIdCounter,
      textBindingCommentIds,
    );

    let finalHtml = processedCondResult.html;
    let extraCondData: any;
    if (opts?.onConditionalHtml) {
      const transformed = opts.onConditionalHtml(finalHtml, condEl);
      finalHtml = transformed.html;
      extraCondData = transformed.extraData;
    }

    conditionals.push({
      id: conditionalId,
      signalName: signalNames[0] ?? '',
      signalNames,
      jsExpression,
      initialValue,
      templateContent: finalHtml,
      startIndex: condEl.tagStart,
      endIndex: condEl.closeTagEnd,
      nestedBindings,
      nestedItemBindings: extraCondData ?? [],
      nestedConditionals,
      nestedEventBindings: processedCondResult.eventBindings,
    });

    bindings.push(...nestedBindings);
    eventBindings.push(...processedCondResult.eventBindings);
  }

  return { conditionals, bindings, eventBindings };
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
  processSubTemplate: (template: string, parentId: string) => {
    processedContent: string;
    bindings: BindingInfo[];
    conditionals: ConditionalBlock[];
    whenElseBlocks: WhenElseBlock[];
    nextId: number;
  },
): WhenElseBlock[] => {
  const whenElseBlocks: WhenElseBlock[] = [];

  for (const binding of parsed.bindings) {
    if (binding.type !== 'whenElse') continue;
    if (!binding.jsExpression || !binding.thenTemplate || !binding.elseTemplate) continue;

    const signalNames = binding.signalNames || [binding.signalName];
    const jsExpression = binding.jsExpression;
    const thenId = `b${state.idCounter++}`;
    const elseId = `b${state.idCounter++}`;
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
      nestedConditionals: [...thenProcessed.conditionals, ...elseProcessed.conditionals],
      nestedWhenElse: [...thenProcessed.whenElseBlocks, ...elseProcessed.whenElseBlocks],
    });
  }

  return whenElseBlocks;
};

// ============================================================================
// buildRangeOverlapChecker
// ============================================================================

export interface Range { start: number; end: number }

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
export const applyTemplateEdits = (
  source: string,
  edits: TemplateEdit[],
): string => {
  edits.sort((a, b) => b.start - a.start);
  let result = source;
  for (const edit of edits) {
    result = result.substring(0, edit.start) + edit.replacement + result.substring(edit.end);
  }
  return result.replace(/\s+/g, ' ').trim();
};

/**
 * Build standard edits from conditionals: replace with rendered content or hidden template.
 */
export const buildConditionalEdits = (conditionals: ConditionalBlock[]): TemplateEdit[] => {
  return conditionals.map((cond) => ({
    start: cond.startIndex,
    end: cond.endIndex,
    replacement: cond.initialValue ? cond.templateContent : `<template id="${cond.id}"></template>`,
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
    const thenReplacement = we.initialValue 
      ? (injectIds && injectIdFn ? injectIdFn(we.thenTemplate, we.thenId) : we.thenTemplate)
      : `<template id="${we.thenId}"></template>`;
    const elseReplacement = we.initialValue 
      ? `<template id="${we.elseId}"></template>` 
      : (injectIds && injectIdFn ? injectIdFn(we.elseTemplate, we.elseId) : we.elseTemplate);
    return {
      start: we.startIndex,
      end: we.endIndex,
      replacement: thenReplacement + elseReplacement,
    };
  });
};

/**
 * Build edits to inject element IDs into non-conditional elements that have bindings.
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
