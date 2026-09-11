/**
 * Template processing for reactive binding compiler
 *
 * Handles processing of HTML templates with conditionals, including
 * evaluation of conditional expressions, element HTML processing,
 * and sub-template nesting.
 */

import ts from 'typescript';
import vm from 'node:vm';
import type { ConditionalBlock, WhenElseBlock, RepeatBlock, BindingInfo, EventBinding } from './types.js';
import { processItemTemplate } from './repeat-analysis.js';
import { logger, PLUGIN_NAME } from '../../utils/index.js';
import {
  parseHtmlTemplate,
  walkElements,
  findElementsWithWhenDirective,
  injectIdIntoFirstElement,
  attributeDomProperty,
  type HtmlElement,
  type ParsedTemplate,
  type BindingInfo as ParsedBindingInfo,
} from '../../utils/html-parser/index.js';
import {
  collectConditionalBlocks,
  collectWhenElseBlocks,
  collectDirectiveRanges,
  isNestedInsideAny,
  buildConditionalEdits,
  buildWhenElseEdits,
  buildSignalReplacementEdits,
  buildElementIdEdits,
  stripPropertyBoundAttributes,
  buildRangeOverlapChecker,
  applyTemplateEdits,
  type IdState,
  type SubTemplateProcessor,
  type TemplateEdit,
} from './template-utils.js';

/** `domProperty` for an attribute binding when a cheaper DOM property write applies (see attributeDomProperty). */
const domPropertyFor = (binding: ParsedBindingInfo): { domProperty?: string | undefined } => {
  const domProperty =
    binding.type === 'attr' && binding.property ? attributeDomProperty(binding.property, binding.element) : undefined;
  return domProperty ? { domProperty } : {};
};

const NAME = PLUGIN_NAME.REACTIVE;

// ============================================================================
// Safe Expression Evaluator (replaces eval())
// ============================================================================

/**
 * Constrained sandbox context for evaluating conditional expressions at compile time.
 * Uses ts.transpile() to handle TypeScript expressions, then vm.runInContext()
 * in a locked-down sandbox. This supports the full range of JS operators and
 * expressions without exposing eval() or the Node.js runtime.
 */
const _evalSandbox = vm.createContext(
  Object.freeze({
    // Only expose safe, side-effect-free globals
    Boolean,
    Number,
    String,
    Array,
    Object,
    Math,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
    true: true,
    false: false,
    null: null,
  }),
);

/**
 * Safely evaluate a conditional expression at compile time.
 *
 * Replaces all `signalName()` references with their initial values,
 * transpiles the expression from TypeScript to JavaScript, then evaluates
 * it in a constrained VM sandbox with no access to Node.js APIs.
 *
 * @param jsExpression - The raw JS expression, e.g. "!_loading()" or "_a() && _b()"
 * @param signalNames - All signal names referenced in the expression
 * @param signalInitializers - Map of signal name → initial value
 * @returns The boolean result, or undefined when the condition cannot be resolved safely at compile time
 */
export const safeEvaluateCondition = (
  jsExpression: string,
  signalNames: string[],
  signalInitializers: Map<string, string | number | boolean>,
): boolean | undefined => {
  let evalExpr = jsExpression;
  for (const sigName of signalNames) {
    if (!signalInitializers.has(sigName)) {
      return undefined;
    }
    const initialVal = signalInitializers.get(sigName);
    evalExpr = evalExpr.replaceAll(`${sigName}()`, JSON.stringify(initialVal));
  }

  try {
    // Transpile to plain JS in case the expression uses TS-specific syntax
    const transpiled = ts.transpile(`(${evalExpr})`, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    });
    return Boolean(vm.runInContext(transpiled, _evalSandbox, { timeout: 50 }));
  } catch {
    return undefined;
  }
};

/**
 * Replace ${signalName()} expressions with their initial values.
 * When the expression is a bare (unquoted) attribute value (preceded by `=`),
 * the replacement is wrapped in quotes to prevent the browser's HTML parser
 * from swallowing the next attribute as this attribute's value.
 */
export const replaceExpressionsWithValues = (
  html: string,
  signalInitializers: Map<string, string | number | boolean>,
): string => {
  return html.replace(/\$\{(\w+)\(\)\}/g, (_match, signalName, offset) => {
    const value = signalInitializers.get(signalName);
    const raw = value !== undefined ? String(value) : '';
    const isUnquotedAttrValue = offset > 0 && html[offset - 1] === '=';
    return isUnquotedAttrValue ? `"${raw}"` : raw;
  });
};

const isInsideRepeatRange = (start: number, end: number, repeatBlocks: RepeatBlock[]): boolean => {
  return repeatBlocks.some((rep) => start >= rep.startIndex && end <= rep.endIndex);
};

/**
 * Process the main HTML template with all conditional directives
 */
export const processHtmlTemplateWithConditionals = (
  templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  startingId: number,
): {
  processedContent: string;
  bindings: BindingInfo[];
  conditionals: ConditionalBlock[];
  whenElseBlocks: WhenElseBlock[];
  repeatBlocks: RepeatBlock[];
  eventBindings: EventBinding[];
  nextId: number;
  hasConditionals: boolean;
} => {
  const parsed = parseHtmlTemplate(templateContent, { detectNonSignalBindings: true });

  // Surface any parse diagnostics to the developer
  for (const diag of parsed.diagnostics) {
    if (diag.severity === 'error') {
      logger.warn(NAME, `Template parse ${diag.severity}: ${diag.message} (at position ${diag.position})`);
    } else {
      logger.info(NAME, `Template parse ${diag.severity}: ${diag.message} (at position ${diag.position})`);
    }
  }

  const bindings: BindingInfo[] = [];
  const repeatBlocks: RepeatBlock[] = [];
  const eventBindings: EventBinding[] = [];
  const elementIdMap = new Map<HtmlElement, string>();
  const state: IdState = { idCounter: startingId, eventIdCounter: { value: 0 }, elementIdMap };

  const processSubTemplate: SubTemplateProcessor = (template, parentId) =>
    processSubTemplateWithNesting(
      template,
      signalInitializers,
      state.idCounter,
      parentId,
      { detectNonSignalBindings: true },
      state.eventIdCounter,
    );

  // ── Conditionals — each when() element's content is processed as a sub-template ──
  const condResult = collectConditionalBlocks(parsed, templateContent, signalInitializers, state, {
    processSubTemplate,
  });
  const conditionals = condResult.conditionals;
  bindings.push(...condResult.bindings);

  // ── Directive ownership: a whenElse/repeat expression nested inside a repeat, another
  //    whenElse, or a when() element belongs to that directive's recursive processing ──
  const ranges = collectDirectiveRanges(parsed);
  const isOwnedByNestedProcessing = (start: number, end: number): boolean =>
    isNestedInsideAny(start, end, ranges.repeat) ||
    isNestedInsideAny(start, end, ranges.whenElse) ||
    isNestedInsideAny(start, end, ranges.conditional);

  // ── WhenElse ──
  const filteredForWhenElse = {
    ...parsed,
    bindings: parsed.bindings.filter(
      (b) => b.type !== 'whenElse' || !isOwnedByNestedProcessing(b.expressionStart, b.expressionEnd),
    ),
  };
  const whenElseBlocks = collectWhenElseBlocks(filteredForWhenElse, signalInitializers, state, processSubTemplate);

  // ── Collect conditional element sets for filtering later bindings ──
  const allConditionalElements = findElementsWithWhenDirective(parsed.roots);
  const conditionalElementSet = new Set(allConditionalElements);
  const elementsInsideConditionals = new Set<HtmlElement>();
  for (const condEl of allConditionalElements) {
    walkElements([condEl], (el) => {
      if (el !== condEl) elementsInsideConditionals.add(el);
    });
  }

  // ── Repeats ──
  for (const binding of parsed.bindings) {
    if (binding.type !== 'repeat') continue;
    if (!binding.itemsExpression || !binding.itemVar || !binding.itemTemplate) continue;
    if (isOwnedByNestedProcessing(binding.expressionStart, binding.expressionEnd)) continue;

    const signalNames = binding.signalNames || [binding.signalName];
    const repeatId = `b${state.idCounter++}`;
    const itemTemplateProcessed = processItemTemplate(
      binding.itemTemplate,
      binding.itemVar,
      binding.indexVar,
      state.idCounter,
      signalInitializers,
    );
    state.idCounter = itemTemplateProcessed.nextId;
    let processedEmptyTemplate: string | undefined;
    if (binding.emptyTemplate) {
      processedEmptyTemplate = binding.emptyTemplate
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .replace(/\s+>/g, '>')
        .trim();
    }

    repeatBlocks.push({
      id: repeatId,
      signalName: signalNames[0] || '',
      signalNames,
      itemsExpression: binding.itemsExpression,
      itemVar: binding.itemVar,
      indexVar: binding.indexVar,
      itemTemplate: itemTemplateProcessed.processedContent,
      emptyTemplate: processedEmptyTemplate,
      trackByFn: binding.trackByFn,
      startIndex: binding.expressionStart,
      endIndex: binding.expressionEnd,
      itemBindings: itemTemplateProcessed.bindings,
      itemEvents: itemTemplateProcessed.events,
      signalBindings: itemTemplateProcessed.signalBindings,
      eventBindings: itemTemplateProcessed.eventBindings,
      nestedConditionals: itemTemplateProcessed.nestedConditionals,
      nestedWhenElse: itemTemplateProcessed.nestedWhenElse,
      nestedRepeats: itemTemplateProcessed.nestedRepeats,
      rowSignalVars: itemTemplateProcessed.rowSignalVars,
    });
  }
  const textBindingSpans = new Map<number, { spanId: string; exprEnd: number; signalName: string }>(); // Map expression position to binding info
  /** Expression text bindings that need special handling (full ${expr} replacement) */
  const expressionBindingSpans = new Map<number, { spanId: string; exprEnd: number }>();
  /** Non-text expression bindings (${...} in attr/style) that must be neutralized in static template HTML */
  const inlineExpressionReplacements = new Map<number, { exprEnd: number; replacement: string }>();

  for (const binding of parsed.bindings) {
    if (elementsInsideConditionals.has(binding.element)) continue;
    if (conditionalElementSet.has(binding.element)) continue;
    if (binding.type === 'when') continue;
    if (binding.type === 'whenElse') continue;
    if (binding.type === 'repeat') continue;
    if (binding.type === 'event') continue;
    if (binding.type === 'text') {
      const spanId = `b${state.idCounter++}`;
      textBindingSpans.set(binding.expressionStart, {
        spanId,
        exprEnd: binding.expressionEnd,
        signalName: binding.signalName,
      });

      // Expression text binding (e.g. ${count() + 1} or ${product.title}) vs bare signal (e.g. ${count()})
      const isExprBinding = binding.jsExpression !== undefined;

      if (isExprBinding) {
        expressionBindingSpans.set(binding.expressionStart, {
          spanId,
          exprEnd: binding.expressionEnd,
        });
      }

      bindings.push(
        isExprBinding
          ? {
              id: spanId,
              signalNames: binding.signalNames || [],
              expression: binding.jsExpression!,
              type: 'text' as const,
              isInsideConditional: false,
            }
          : {
              id: spanId,
              signalName: binding.signalName,
              type: 'text' as const,
              isInsideConditional: false,
            },
      );
      continue;
    }
    // An element's own id is its binding id, so nothing is injected and the id survives
    if (!elementIdMap.has(binding.element)) {
      elementIdMap.set(binding.element, binding.element.attributes.get('id')?.value || `b${state.idCounter++}`);
    }
    const elementId = elementIdMap.get(binding.element)!;

    const isExprBinding = binding.jsExpression !== undefined;
    // Check if the expression is a bare (unquoted) attribute value: attr=${...}
    // In that case the replacement must be quoted to prevent the browser's HTML parser
    // from swallowing the next attribute as this attribute's value.
    const isUnquotedAttrValue = binding.expressionStart > 0 && templateContent[binding.expressionStart - 1] === '=';
    if (isExprBinding) {
      inlineExpressionReplacements.set(binding.expressionStart, {
        exprEnd: binding.expressionEnd,
        replacement: isUnquotedAttrValue ? '""' : '',
      });
      bindings.push({
        id: elementId,
        signalNames: binding.signalNames || [],
        expression: binding.jsExpression!,
        type: binding.type as 'style' | 'attr',
        ...(binding.property ? { property: binding.property } : {}),
        ...domPropertyFor(binding),
        isInsideConditional: false,
      });
    } else {
      const initialValue = signalInitializers.get(binding.signalName);
      const raw = initialValue !== undefined ? String(initialValue) : '';
      inlineExpressionReplacements.set(binding.expressionStart, {
        exprEnd: binding.expressionEnd,
        replacement: isUnquotedAttrValue ? `"${raw}"` : raw,
      });
      bindings.push({
        id: elementId,
        signalName: binding.signalName,
        type: binding.type as 'style' | 'attr',
        property: binding.property!,
        ...domPropertyFor(binding),
        isInsideConditional: false,
      });
    }
  }
  for (const binding of parsed.bindings) {
    if (binding.type !== 'event') continue;
    if (!binding.eventName || !binding.handlerExpression) continue;
    // Events inside a when() element are bound by that conditional's own initializer
    if (elementsInsideConditionals.has(binding.element) || conditionalElementSet.has(binding.element)) continue;

    const eventId = `e${state.eventIdCounter.value++}`;
    // Use existing HTML id attribute if available, otherwise generate one
    let elementId: string;
    const existingIdAttr = binding.element.attributes.get('id');
    if (existingIdAttr) {
      elementId = existingIdAttr.value;
    } else {
      if (!elementIdMap.has(binding.element)) {
        elementIdMap.set(binding.element, `b${state.idCounter++}`);
      }
      elementId = elementIdMap.get(binding.element)!;
    }

    eventBindings.push({
      id: eventId,
      eventName: binding.eventName,
      modifiers: binding.eventModifiers || [],
      handlerExpression: binding.handlerExpression,
      elementId,
      startIndex: binding.expressionStart,
      endIndex: binding.expressionEnd,
    });
  }
  const processedContent = generateProcessedHtml(
    templateContent,
    parsed,
    signalInitializers,
    elementIdMap,
    conditionals,
    whenElseBlocks,
    repeatBlocks,
    eventBindings,
    textBindingSpans,
    expressionBindingSpans,
    inlineExpressionReplacements,
  );

  return {
    processedContent: stripPropertyBoundAttributes(processedContent, bindings),
    bindings,
    conditionals,
    whenElseBlocks,
    repeatBlocks,
    eventBindings,
    nextId: state.idCounter,
    hasConditionals: conditionals.length > 0 || whenElseBlocks.length > 0 || repeatBlocks.length > 0,
  };
};

/**
 * Process a sub-template within a whenElse block, handling nested conditionals
 */
export const processSubTemplateWithNesting = (
  templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  startingId: number,
  parentId: string,
  options?: { detectNonSignalBindings?: boolean },
  eventIdCounter?: { value: number },
): {
  processedContent: string;
  bindings: BindingInfo[];
  conditionals: ConditionalBlock[];
  whenElseBlocks: WhenElseBlock[];
  repeatBlocks: RepeatBlock[];
  eventBindings: EventBinding[];
  nextId: number;
} => {
  const parsed = parseHtmlTemplate(templateContent, options);
  const bindings: BindingInfo[] = [];
  const repeatBlocks: RepeatBlock[] = [];
  const eventBindings: EventBinding[] = [];
  const elementIdMap = new Map<HtmlElement, string>();
  // Share the caller's event id counter so ids stay unique across nesting levels
  const state: IdState = { idCounter: startingId, eventIdCounter: eventIdCounter ?? { value: 0 }, elementIdMap };
  const firstRootElement = parsed.roots[0] ?? null;

  const processSubTemplate: SubTemplateProcessor = (template, id) =>
    processSubTemplateWithNesting(template, signalInitializers, state.idCounter, id, options, state.eventIdCounter);

  // ── Conditionals — each when() element's content is processed as a sub-template ──
  //    Bindings inside a nested when() are owned by that conditional's initializer and are
  //    deliberately not merged into this sub-template's own binding list.
  const condResult = collectConditionalBlocks(parsed, templateContent, signalInitializers, state, {
    processSubTemplate,
  });
  const conditionals = condResult.conditionals;

  // ── Directive ownership (see processHtmlTemplateWithConditionals) ──
  const ranges = collectDirectiveRanges(parsed);
  const isOwnedByNestedProcessing = (start: number, end: number): boolean =>
    isNestedInsideAny(start, end, ranges.repeat) ||
    isNestedInsideAny(start, end, ranges.whenElse) ||
    isNestedInsideAny(start, end, ranges.conditional);

  // ── WhenElse ──
  const filteredForWhenElse = {
    ...parsed,
    bindings: parsed.bindings.filter(
      (b) => b.type !== 'whenElse' || !isOwnedByNestedProcessing(b.expressionStart, b.expressionEnd),
    ),
  };
  const whenElseBlocks = collectWhenElseBlocks(filteredForWhenElse, signalInitializers, state, processSubTemplate);

  // ── Repeats ──
  for (const binding of parsed.bindings) {
    if (binding.type !== 'repeat') continue;
    if (!binding.itemsExpression || !binding.itemVar || !binding.itemTemplate) continue;
    if (isOwnedByNestedProcessing(binding.expressionStart, binding.expressionEnd)) continue;

    const signalNames = binding.signalNames || [binding.signalName];
    const repeatId = `b${state.idCounter++}`;
    const itemTemplateProcessed = processItemTemplate(
      binding.itemTemplate,
      binding.itemVar,
      binding.indexVar,
      state.idCounter,
      signalInitializers,
    );
    state.idCounter = itemTemplateProcessed.nextId;

    let processedEmptyTemplate: string | undefined;
    if (binding.emptyTemplate) {
      processedEmptyTemplate = binding.emptyTemplate
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .replace(/\s+>/g, '>')
        .trim();
    }

    repeatBlocks.push({
      id: repeatId,
      signalName: signalNames[0] || '',
      signalNames,
      itemsExpression: binding.itemsExpression,
      itemVar: binding.itemVar,
      indexVar: binding.indexVar,
      itemTemplate: itemTemplateProcessed.processedContent,
      emptyTemplate: processedEmptyTemplate,
      trackByFn: binding.trackByFn,
      startIndex: binding.expressionStart,
      endIndex: binding.expressionEnd,
      itemBindings: itemTemplateProcessed.bindings,
      itemEvents: itemTemplateProcessed.events,
      signalBindings: itemTemplateProcessed.signalBindings,
      eventBindings: itemTemplateProcessed.eventBindings,
      nestedConditionals: itemTemplateProcessed.nestedConditionals,
      nestedWhenElse: itemTemplateProcessed.nestedWhenElse,
      nestedRepeats: itemTemplateProcessed.nestedRepeats,
      rowSignalVars: itemTemplateProcessed.rowSignalVars,
    });
  }

  // ── Remaining bindings (non-conditional, non-whenElse) ──
  const conditionalElements = findElementsWithWhenDirective(parsed.roots);
  const conditionalElementSet = new Set(conditionalElements);
  const elementsInsideConditionals = new Set<HtmlElement>();
  for (const condEl of conditionalElements) {
    walkElements([condEl], (el) => {
      if (el !== condEl) elementsInsideConditionals.add(el);
    });
  }
  const textBindingSpans = new Map<number, { spanId: string; exprEnd: number; signalName: string }>();
  const expressionBindingSpans = new Map<number, { spanId: string; exprEnd: number }>();
  const inlineExpressionReplacements = new Map<number, { exprEnd: number; replacement: string }>();
  for (const binding of parsed.bindings) {
    if (elementsInsideConditionals.has(binding.element)) continue;
    if (conditionalElementSet.has(binding.element)) continue;
    if (binding.type === 'when' || binding.type === 'whenElse' || binding.type === 'repeat') continue;

    if (binding.type === 'text') {
      // Text bindings use comment markers — assign a dedicated ID
      const spanId = `b${state.idCounter++}`;
      textBindingSpans.set(binding.expressionStart, {
        spanId,
        exprEnd: binding.expressionEnd,
        signalName: binding.signalName,
      });

      const isExpressionBinding = binding.jsExpression !== undefined;
      if (isExpressionBinding) {
        expressionBindingSpans.set(binding.expressionStart, {
          spanId,
          exprEnd: binding.expressionEnd,
        });
      }

      bindings.push(
        isExpressionBinding
          ? {
              id: spanId,
              signalNames: binding.signalNames!,
              expression: binding.jsExpression!,
              type: 'text' as const,
              isInsideConditional: true,
              conditionalId: parentId,
            }
          : {
              id: spanId,
              signalName: binding.signalName,
              type: 'text' as const,
              isInsideConditional: true,
              conditionalId: parentId,
            },
      );
      continue;
    }

    if (!elementIdMap.has(binding.element)) {
      const isFirstRootBindingElement = firstRootElement !== null && binding.element === firstRootElement;
      elementIdMap.set(
        binding.element,
        isFirstRootBindingElement ? parentId : binding.element.attributes.get('id')?.value || `b${state.idCounter++}`,
      );
    }
    const elementId = elementIdMap.get(binding.element)!;

    if (binding.type === 'event') {
      if (binding.eventName && binding.handlerExpression) {
        const eventId = `e${state.eventIdCounter.value++}`;
        eventBindings.push({
          id: eventId,
          eventName: binding.eventName,
          modifiers: binding.eventModifiers || [],
          handlerExpression: binding.handlerExpression,
          elementId,
          startIndex: binding.expressionStart,
          endIndex: binding.expressionEnd,
        });
      }
      continue;
    }

    if (binding.type !== 'style' && binding.type !== 'attr') {
      continue;
    }
    const isExpressionBinding = binding.jsExpression !== undefined;
    const isUnquotedAttrValue = binding.expressionStart > 0 && templateContent[binding.expressionStart - 1] === '=';
    if (isExpressionBinding) {
      inlineExpressionReplacements.set(binding.expressionStart, {
        exprEnd: binding.expressionEnd,
        replacement: isUnquotedAttrValue ? '""' : '',
      });
    } else {
      const initialValue = signalInitializers.get(binding.signalName);
      const raw = initialValue !== undefined ? String(initialValue) : '';
      inlineExpressionReplacements.set(binding.expressionStart, {
        exprEnd: binding.expressionEnd,
        replacement: isUnquotedAttrValue ? `"${raw}"` : raw,
      });
    }
    bindings.push(
      isExpressionBinding
        ? {
            id: elementId,
            signalNames: binding.signalNames!,
            expression: binding.jsExpression!,
            type: binding.type,
            ...(binding.property ? { property: binding.property } : {}),
            ...domPropertyFor(binding),
            isInsideConditional: true,
            conditionalId: parentId,
          }
        : {
            id: elementId,
            signalName: binding.signalName,
            type: binding.type,
            ...(binding.property ? { property: binding.property } : {}),
            ...domPropertyFor(binding),
            isInsideConditional: true,
            conditionalId: parentId,
          },
    );
  }

  const rootConditionals = conditionals.filter((c) => !isInsideRepeatRange(c.startIndex, c.endIndex, repeatBlocks));
  const rootWhenElseBlocks = whenElseBlocks.filter((w) => !isInsideRepeatRange(w.startIndex, w.endIndex, repeatBlocks));

  // ── Build edits and apply ──
  const allRanges = [
    ...rootConditionals.map((c) => ({ start: c.startIndex, end: c.endIndex })),
    ...rootWhenElseBlocks.map((w) => ({ start: w.startIndex, end: w.endIndex })),
    ...repeatBlocks.map((r) => ({ start: r.startIndex, end: r.endIndex })),
  ];
  const edits: TemplateEdit[] = [
    ...buildConditionalEdits(rootConditionals),
    // injectIds=true so statically pre-rendered nested whenElse branches carry their
    // branch id — without it the runtime IF_EXPR lookup misses the inlined branch
    // and the branch can never be toggled (matches main-template behavior).
    ...buildWhenElseEdits(rootWhenElseBlocks, true, injectIdIntoFirstElement),
    ...repeatBlocks.map((rep) => ({
      start: rep.startIndex,
      end: rep.endIndex,
      replacement: `<template id="${rep.id}"></template>`,
    })),
    ...buildSignalReplacementEdits(
      templateContent,
      signalInitializers,
      allRanges,
      textBindingSpans,
      expressionBindingSpans,
      inlineExpressionReplacements,
    ),
    ...buildElementIdEdits(elementIdMap, allRanges),
  ];

  // Strip @event attributes from processed HTML (they'll be bound via addEventListener at runtime)
  for (const evt of eventBindings) {
    edits.push({ start: evt.startIndex, end: evt.endIndex, replacement: '' });
  }

  return {
    processedContent: stripPropertyBoundAttributes(applyTemplateEdits(templateContent, edits), bindings),
    bindings,
    conditionals,
    whenElseBlocks,
    repeatBlocks,
    eventBindings,
    nextId: state.idCounter,
  };
};

/**
 * Generate the processed HTML by applying all edits (binding replacements, conditional rendering, etc.)
 */
export const generateProcessedHtml = (
  originalHtml: string,
  parsed: ParsedTemplate,
  signalInitializers: Map<string, string | number | boolean>,
  elementIdMap: Map<HtmlElement, string>,
  conditionals: ConditionalBlock[],
  whenElseBlocks: WhenElseBlock[] = [],
  repeatBlocks: RepeatBlock[] = [],
  eventBindings: EventBinding[] = [],
  textBindingSpans: Map<number, { spanId: string; exprEnd: number; signalName: string }> = new Map(),
  expressionBindingSpans: Map<number, { spanId: string; exprEnd: number }> = new Map(),
  inlineExpressionReplacements: Map<number, { exprEnd: number; replacement: string }> = new Map(),
): string => {
  const rootConditionals = conditionals.filter((c) => !isInsideRepeatRange(c.startIndex, c.endIndex, repeatBlocks));
  const rootWhenElseBlocks = whenElseBlocks.filter((w) => !isInsideRepeatRange(w.startIndex, w.endIndex, repeatBlocks));

  const allRanges = [
    ...rootConditionals.map((c) => ({ start: c.startIndex, end: c.endIndex })),
    ...rootWhenElseBlocks.map((w) => ({ start: w.startIndex, end: w.endIndex })),
    ...repeatBlocks.map((r) => ({ start: r.startIndex, end: r.endIndex })),
  ];

  const edits: TemplateEdit[] = [
    ...buildConditionalEdits(rootConditionals),
    ...buildWhenElseEdits(rootWhenElseBlocks, true, injectIdIntoFirstElement),
    ...repeatBlocks.map((rep) => ({
      start: rep.startIndex,
      end: rep.endIndex,
      replacement: `<template id="${rep.id}"></template>`,
    })),
    ...buildSignalReplacementEdits(
      originalHtml,
      signalInitializers,
      allRanges,
      textBindingSpans,
      expressionBindingSpans,
      inlineExpressionReplacements,
    ),
  ];

  // Event binding edits — remove @event attributes (no more data-evt- attributes)
  for (const binding of parsed.bindings) {
    if (binding.type === 'event' && binding.eventName) {
      const eventBinding = eventBindings.find(
        (eb) => eb.eventName === binding.eventName && eb.startIndex === binding.expressionStart,
      );
      if (eventBinding) {
        edits.push({ start: binding.expressionStart, end: binding.expressionEnd, replacement: '' });
      }
    }
  }

  // Element ID injection (no event data attributes — events use direct addEventListener).
  // Elements whose user-supplied id was reused as the binding id are left untouched.
  const isInsideRange = buildRangeOverlapChecker(allRanges);
  for (const [element, id] of elementIdMap) {
    if (isInsideRange(element.tagStart)) continue;
    if (element.attributes.get('id')?.value === id) continue;
    edits.push({ start: element.tagNameEnd, end: element.tagNameEnd, replacement: ` id="${id}"` });
  }

  return applyTemplateEdits(originalHtml, edits);
};
