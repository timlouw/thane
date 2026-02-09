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
    const conditionalId = `b${state.idCounter++}`;
    state.elementIdMap.set(condEl, conditionalId);

    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);
    const condBindings = getBindingsForElement(condEl, parsed.bindings);
    const nestedBindings: BindingInfo[] = [];

    for (const binding of condBindings) {
      if (binding.type === 'when' || binding.type === 'event') continue;
      let elementId: string;
      if (binding.element === condEl) {
        elementId = conditionalId;
      } else {
        if (!state.elementIdMap.has(binding.element)) {
          state.elementIdMap.set(binding.element, `b${state.idCounter++}`);
        }
        elementId = state.elementIdMap.get(binding.element)!;
      }
      nestedBindings.push({
        id: elementId,
        signalName: binding.signalName,
        type: binding.type as 'text' | 'style' | 'attr',
        property: binding.property,
        isInsideConditional: true,
        conditionalId,
      });
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
        const nestedCondId = `b${state.idCounter++}`;
        state.elementIdMap.set(nestedCondEl, nestedCondId);
        const nestedInitialValue = safeEvaluateCondition(nestedJsExpression, nestedSignalNames, signalInitializers);
        const nestedCondBindings = getBindingsForElement(nestedCondEl, parsed.bindings);
        const nestedNestedBindings: BindingInfo[] = [];

        for (const binding of nestedCondBindings) {
          if (binding.type === 'when' || binding.type === 'event') continue;
          let nestedElementId: string;
          if (binding.element === nestedCondEl) {
            nestedElementId = nestedCondId;
          } else {
            if (!state.elementIdMap.has(binding.element)) {
              state.elementIdMap.set(binding.element, `b${state.idCounter++}`);
            }
            nestedElementId = state.elementIdMap.get(binding.element)!;
          }
          nestedNestedBindings.push({
            id: nestedElementId,
            signalName: binding.signalName,
            type: binding.type as 'text' | 'style' | 'attr',
            property: binding.property,
            isInsideConditional: true,
            conditionalId: nestedCondId,
          });
        }

        const nestedProcessedResult = processConditionalElementHtml(nestedCondEl, templateContent, signalInitializers, state.elementIdMap, nestedCondId, undefined, state.eventIdCounter);
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
    if (element.attributes.has('id')) continue;

    const attrsToAdd: string[] = [`id="${id}"`];
    // No more data-evt-* attributes — events use direct addEventListener

    edits.push({
      start: element.tagNameEnd,
      end: element.tagNameEnd,
      replacement: ' ' + attrsToAdd.join(' '),
    });
  }

  return edits;
};

/**
 * Build edits to replace ${signal()} expressions with their initial values.
 */
export const buildSignalReplacementEdits = (
  templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  allRanges: Range[],
  textBindingSpans?: Map<number, string>,
): TemplateEdit[] => {
  const isInsideRange = buildRangeOverlapChecker(allRanges);
  const edits: TemplateEdit[] = [];
  const exprRegex = /\$\{(\w+)\(\)\}/g;
  let match: RegExpExecArray | null;

  while ((match = exprRegex.exec(templateContent)) !== null) {
    const exprStart = match.index;
    const exprEnd = exprStart + match[0].length;
    if (isInsideRange(exprStart)) continue;

    const signalName = match[1];
    if (!signalName) continue;
    const value = signalInitializers.get(signalName);
    const valueStr = value !== undefined ? String(value) : '';
    const spanId = textBindingSpans?.get(exprStart);

    edits.push({
      start: exprStart,
      end: exprEnd,
      // Ensure text node child always exists for firstChild.nodeValue access.
      // Use a space as placeholder when value is empty — overwritten by initializeBindings.
      replacement: spanId ? `<span id="${spanId}">${valueStr || ' '}</span>` : (valueStr || ' '),
    });
  }

  return edits;
};
