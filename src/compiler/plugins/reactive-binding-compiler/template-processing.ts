/**
 * Template processing for reactive binding compiler
 * 
 * Handles processing of HTML templates with conditionals, including
 * evaluation of conditional expressions, element HTML processing,
 * and sub-template nesting.
 */

import ts from 'typescript';
import vm from 'vm';
import type {
  ConditionalBlock,
  WhenElseBlock,
  RepeatBlock,
  BindingInfo,
  EventBinding,
} from './types.js';
import { processItemTemplate } from './repeat-analysis.js';
import { logger, PLUGIN_NAME } from '../../utils/index.js';
import {
  parseHtmlTemplate,
  walkElements,
  findElementsWithWhenDirective,
  getElementHtml,
  getBindingsForElement,
  injectIdIntoFirstElement,
  type HtmlElement,
  type ParsedTemplate,
} from '../../utils/html-parser.js';

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
const _evalSandbox = vm.createContext(Object.freeze({
  // Only expose safe, side-effect-free globals
  Boolean, Number, String, Array, Object,
  Math, JSON, parseInt, parseFloat, isNaN, isFinite,
  undefined, NaN, Infinity,
  true: true, false: false, null: null,
}));

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
 * @returns The boolean result, defaulting to false on any failure
 */
export const safeEvaluateCondition = (
  jsExpression: string,
  signalNames: string[],
  signalInitializers: Map<string, string | number | boolean>,
): boolean => {
  let evalExpr = jsExpression;
  for (const sigName of signalNames) {
    const initialVal = signalInitializers.get(sigName);
    evalExpr = evalExpr.replaceAll(`${sigName}()`, JSON.stringify(initialVal ?? false));
  }

  try {
    // Transpile to plain JS in case the expression uses TS-specific syntax
    const transpiled = ts.transpile(`(${evalExpr})`, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    });
    return Boolean(vm.runInContext(transpiled, _evalSandbox, { timeout: 50 }));
  } catch {
    return false;
  }
};

/**
 * Replace ${signalName()} expressions with their initial values
 */
export const replaceExpressionsWithValues = (html: string, signalInitializers: Map<string, string | number | boolean>): string => {
  return html.replace(/\$\{(\w+)\(\)\}/g, (_match, signalName) => {
    const value = signalInitializers.get(signalName);
    return value !== undefined ? String(value) : '';
  });
};

/**
 * Process a conditional element's HTML, injecting IDs and handling nested conditionals
 */
export const processConditionalElementHtml = (
  element: HtmlElement,
  originalHtml: string,
  signalInitializers: Map<string, string | number | boolean>,
  elementIdMap: Map<HtmlElement, string>,
  conditionalId: string,
  nestedConditionalBlocks?: ConditionalBlock[],
  eventIdCounter: { value: number } = { value: 0 },
): { html: string; eventBindings: EventBinding[] } => {
  let html = getElementHtml(element, originalHtml);
  const eventBindings: EventBinding[] = [];
  if (element.whenDirective) {
    html = html.replace(element.whenDirective, '');
  }
  const tagNameEnd = element.tagName.length + 1; // +1 for '<'
  html = html.substring(0, tagNameEnd) + ` id="${conditionalId}"` + html.substring(tagNameEnd);
  html = replaceExpressionsWithValues(html, signalInitializers);
  const eventAttrRegex = /@([\w.]+)=\$\{([^}]+)\}/g;
  let eventMatch: RegExpExecArray | null;
  const eventReplacements: Array<{ original: string; replacement: string; eventBinding: EventBinding }> = [];

  while ((eventMatch = eventAttrRegex.exec(html)) !== null) {
    const fullMatch = eventMatch[0];
    const eventSpec = eventMatch[1]; // e.g., "click" or "click.stop.prevent"
    const handlerExpression = eventMatch[2]?.trim() ?? '';
    if (!eventSpec) continue;
    const parts = eventSpec.split('.');
    const eventName = parts[0] ?? '';
    const modifiers = parts.slice(1);

    const eventId = `e${eventIdCounter.value++}`;
    const attrValue = modifiers.length > 0 ? `${eventId}:${modifiers.join(':')}` : eventId;
    eventReplacements.push({
      original: fullMatch,
      replacement: `data-evt-${eventName}="${attrValue}"`,
      eventBinding: {
        id: eventId,
        eventName,
        modifiers,
        handlerExpression,
        elementId: conditionalId, // Events on the conditional element itself
        startIndex: 0, // Not used in conditional context
        endIndex: 0,
      },
    });
  }
  for (const { original, replacement, eventBinding } of eventReplacements) {
    html = html.replace(original, replacement);
    eventBindings.push(eventBinding);
  }
  html = addIdsToNestedElements(html, element, elementIdMap, originalHtml);
  if (nestedConditionalBlocks && nestedConditionalBlocks.length > 0) {
    for (const nestedCond of nestedConditionalBlocks) {
      const jsExprEscaped = nestedCond.jsExpression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const whenAttrPattern = new RegExp(`"\\$\\{when\\(${jsExprEscaped}\\)\\}"`, 'g');
      const elementWithWhenPattern = new RegExp(`<(\\w+)([^>]*)"\\$\\{when\\(${jsExprEscaped}\\)\\}"([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'g');

      const match = elementWithWhenPattern.exec(html);
      if (match) {
        html = html.replace(match[0], `<template id="${nestedCond.id}"></template>`);
      } else {
        html = html.replace(whenAttrPattern, '');
      }
    }
  }
  html = html.replace(/\s+/g, ' ').replace(/\s+>/g, '>').replace(/\s>/g, '>');

  return { html, eventBindings };
};

/**
 * Add IDs to nested elements within a conditional block
 */
export const addIdsToNestedElements = (processedHtml: string, rootElement: HtmlElement, elementIdMap: Map<HtmlElement, string>, _originalHtml: string): string => {
  let result = processedHtml;
  walkElements([rootElement], (el) => {
    if (el === rootElement) return; // Root already has ID

    const id = elementIdMap.get(el);
    if (!id) return; // No ID needed for this element
    const existingAttrs: string[] = [];
    for (const [name, attr] of el.attributes) {
      const processedValue = replaceExpressionsWithValues(attr.value, new Map());
      existingAttrs.push(`${name}="${processedValue}"`);
    }
    const tagPattern = new RegExp(`<${el.tagName}(\\s+[^>]*)?(?<!id="[^"]*")>`, 'g');
    result = result.replace(tagPattern, (match) => {
      if (match.includes(`id="`)) return match; // Already has an ID
      return match.replace(`<${el.tagName}`, `<${el.tagName} id="${id}"`);
    });
  });

  return result;
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
  const parsed = parseHtmlTemplate(templateContent);

  // Surface any parse diagnostics to the developer
  for (const diag of parsed.diagnostics) {
    const logFn = diag.severity === 'error' ? logger.warn : logger.info;
    logFn(NAME, `Template parse ${diag.severity}: ${diag.message} (at position ${diag.position})`);
  }

  const bindings: BindingInfo[] = [];
  const conditionals: ConditionalBlock[] = [];
  const whenElseBlocks: WhenElseBlock[] = [];
  const repeatBlocks: RepeatBlock[] = [];
  const eventBindings: EventBinding[] = [];
  let idCounter = startingId;
  const eventIdCounter = { value: 0 };
  const elementIdMap = new Map<HtmlElement, string>();
  const allConditionalElements = findElementsWithWhenDirective(parsed.roots);
  const conditionalElementSet = new Set(allConditionalElements);
  const elementsInsideConditionals = new Set<HtmlElement>();
  for (const condEl of allConditionalElements) {
    walkElements([condEl], (el) => {
      if (el !== condEl) {
        elementsInsideConditionals.add(el);
      }
    });
  }
  const topLevelConditionalElements = allConditionalElements.filter((el) => !elementsInsideConditionals.has(el));
  const nestedConditionalsMap = new Map<HtmlElement, HtmlElement[]>();
  for (const condEl of topLevelConditionalElements) {
    const nested: HtmlElement[] = [];
    walkElements([condEl], (el) => {
      if (el !== condEl && conditionalElementSet.has(el)) {
        nested.push(el);
      }
    });
    nestedConditionalsMap.set(condEl, nested);
  }
  for (const condEl of topLevelConditionalElements) {
    const whenBinding = parsed.bindings.find((b) => b.element === condEl && b.type === 'when');
    if (!whenBinding || !whenBinding.jsExpression) continue;

    const signalNames = whenBinding.signalNames || [whenBinding.signalName];
    const jsExpression = whenBinding.jsExpression;

    const conditionalId = `b${idCounter++}`;
    elementIdMap.set(condEl, conditionalId);
    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);
    const condBindings = getBindingsForElement(condEl, parsed.bindings);
    const nestedBindings: BindingInfo[] = [];

    for (const binding of condBindings) {
      if (binding.type === 'when') continue;
      if (binding.type === 'event') continue;
      let elementId: string;
      if (binding.element === condEl) {
        elementId = conditionalId;
      } else {
        if (!elementIdMap.has(binding.element)) {
          elementIdMap.set(binding.element, `b${idCounter++}`);
        }
        elementId = elementIdMap.get(binding.element)!;
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
    const nestedCondElements = nestedConditionalsMap.get(condEl) || [];
    const nestedConditionals: ConditionalBlock[] = [];

    for (const nestedCondEl of nestedCondElements) {
      const nestedWhenBinding = parsed.bindings.find((b) => b.element === nestedCondEl && b.type === 'when');
      if (!nestedWhenBinding || !nestedWhenBinding.jsExpression) continue;

      const nestedSignalNames = nestedWhenBinding.signalNames || [nestedWhenBinding.signalName];
      const nestedJsExpression = nestedWhenBinding.jsExpression;
      const nestedCondId = `b${idCounter++}`;
      elementIdMap.set(nestedCondEl, nestedCondId);
      const nestedInitialValue = safeEvaluateCondition(nestedJsExpression, nestedSignalNames, signalInitializers);
      const nestedCondBindings = getBindingsForElement(nestedCondEl, parsed.bindings);
      const nestedNestedBindings: BindingInfo[] = [];

      for (const binding of nestedCondBindings) {
        if (binding.type === 'when') continue;
        if (binding.type === 'event') continue;

        let nestedElementId: string;
        if (binding.element === nestedCondEl) {
          nestedElementId = nestedCondId;
        } else {
          if (!elementIdMap.has(binding.element)) {
            elementIdMap.set(binding.element, `b${idCounter++}`);
          }
          nestedElementId = elementIdMap.get(binding.element)!;
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

      const nestedProcessedResult = processConditionalElementHtml(nestedCondEl, templateContent, signalInitializers, elementIdMap, nestedCondId, undefined, eventIdCounter);

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
    const processedCondResult = processConditionalElementHtml(condEl, templateContent, signalInitializers, elementIdMap, conditionalId, nestedConditionals, eventIdCounter);

    conditionals.push({
      id: conditionalId,
      signalName: signalNames[0] ?? '', // Primary signal for backwards compatibility
      signalNames,
      jsExpression,
      initialValue,
      templateContent: processedCondResult.html,
      startIndex: condEl.tagStart,
      endIndex: condEl.closeTagEnd,
      nestedBindings,
      nestedItemBindings: [],
      nestedConditionals,
      nestedEventBindings: processedCondResult.eventBindings,
    });

    bindings.push(...nestedBindings);
    eventBindings.push(...processedCondResult.eventBindings);
  }
  for (const binding of parsed.bindings) {
    if (binding.type !== 'whenElse') continue;
    if (!binding.jsExpression || !binding.thenTemplate || !binding.elseTemplate) continue;

    const signalNames = binding.signalNames || [binding.signalName];
    const jsExpression = binding.jsExpression;
    const thenId = `b${idCounter++}`;
    const elseId = `b${idCounter++}`;
    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);
    const thenProcessed = processSubTemplateWithNesting(binding.thenTemplate, signalInitializers, idCounter, thenId);
    idCounter = thenProcessed.nextId;
    const elseProcessed = processSubTemplateWithNesting(binding.elseTemplate, signalInitializers, idCounter, elseId);
    idCounter = elseProcessed.nextId;

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
  const allRepeatRanges: Array<{ start: number; end: number }> = [];
  for (const binding of parsed.bindings) {
    if (binding.type === 'repeat') {
      allRepeatRanges.push({ start: binding.expressionStart, end: binding.expressionEnd });
    }
  }
  const isInsideOtherRepeat = (start: number, end: number): boolean => {
    for (const range of allRepeatRanges) {
      if (start > range.start && end < range.end) {
        return true;
      }
    }
    return false;
  };
  for (const binding of parsed.bindings) {
    if (binding.type !== 'repeat') continue;
    if (!binding.itemsExpression || !binding.itemVar || !binding.itemTemplate) continue;
    if (isInsideOtherRepeat(binding.expressionStart, binding.expressionEnd)) continue;

    const signalNames = binding.signalNames || [binding.signalName];
    const repeatId = `b${idCounter++}`;
    const itemTemplateProcessed = processItemTemplate(binding.itemTemplate, binding.itemVar, binding.indexVar, idCounter, signalInitializers);
    idCounter = itemTemplateProcessed.nextId;
    let processedEmptyTemplate: string | undefined;
    if (binding.emptyTemplate) {
      processedEmptyTemplate = binding.emptyTemplate.replace(/\s+/g, ' ').trim();
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
    });
  }
  const textBindingSpans = new Map<number, string>(); // Map expression position to span ID

  for (const binding of parsed.bindings) {
    if (elementsInsideConditionals.has(binding.element)) continue;
    if (conditionalElementSet.has(binding.element)) continue;
    if (binding.type === 'when') continue;
    if (binding.type === 'whenElse') continue;
    if (binding.type === 'repeat') continue;
    if (binding.type === 'event') continue;
    if (binding.type === 'text') {
      const spanId = `b${idCounter++}`;
      textBindingSpans.set(binding.expressionStart, spanId);

      bindings.push({
        id: spanId,
        signalName: binding.signalName,
        type: 'text',
        property: binding.property,
        isInsideConditional: false,
        conditionalId: undefined,
      });
      continue;
    }
    if (!elementIdMap.has(binding.element)) {
      elementIdMap.set(binding.element, `b${idCounter++}`);
    }
    const elementId = elementIdMap.get(binding.element)!;

    bindings.push({
      id: elementId,
      signalName: binding.signalName,
      type: binding.type as 'style' | 'attr',
      property: binding.property,
      isInsideConditional: false,
      conditionalId: undefined,
    });
  }
  for (const binding of parsed.bindings) {
    if (binding.type !== 'event') continue;
    if (!binding.eventName || !binding.handlerExpression) continue;

    const eventId = `e${eventIdCounter.value++}`;
    if (!elementIdMap.has(binding.element)) {
      elementIdMap.set(binding.element, `b${idCounter++}`);
    }
    const elementId = elementIdMap.get(binding.element)!;

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
  );

  return {
    processedContent,
    bindings,
    conditionals,
    whenElseBlocks,
    repeatBlocks,
    eventBindings,
    nextId: idCounter,
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
): {
  processedContent: string;
  bindings: BindingInfo[];
  conditionals: ConditionalBlock[];
  whenElseBlocks: WhenElseBlock[];
  nextId: number;
} => {
  const parsed = parseHtmlTemplate(templateContent);
  const bindings: BindingInfo[] = [];
  const conditionals: ConditionalBlock[] = [];
  const whenElseBlocks: WhenElseBlock[] = [];
  let idCounter = startingId;
  const elementIdMap = new Map<HtmlElement, string>();
  const eventIdCounter = { value: 0 };
  const conditionalElements = findElementsWithWhenDirective(parsed.roots);
  const conditionalElementSet = new Set(conditionalElements);
  const elementsInsideConditionals = new Set<HtmlElement>();
  for (const condEl of conditionalElements) {
    walkElements([condEl], (el) => {
      if (el !== condEl) {
        elementsInsideConditionals.add(el);
      }
    });
  }
  for (const condEl of conditionalElements) {
    const whenBinding = parsed.bindings.find((b) => b.element === condEl && b.type === 'when');
    if (!whenBinding || !whenBinding.jsExpression) continue;

    const signalNames = whenBinding.signalNames || [whenBinding.signalName];
    const jsExpression = whenBinding.jsExpression;

    const conditionalId = `b${idCounter++}`;
    elementIdMap.set(condEl, conditionalId);
    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);
    const condBindings = getBindingsForElement(condEl, parsed.bindings);
    const nestedBindings: BindingInfo[] = [];

    for (const binding of condBindings) {
      if (binding.type === 'when') continue;
      if (binding.type === 'event') continue;

      let elementId: string;
      if (binding.element === condEl) {
        elementId = conditionalId;
      } else {
        if (!elementIdMap.has(binding.element)) {
          elementIdMap.set(binding.element, `b${idCounter++}`);
        }
        elementId = elementIdMap.get(binding.element)!;
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

    const processedCondResult = processConditionalElementHtml(condEl, templateContent, signalInitializers, elementIdMap, conditionalId, undefined, eventIdCounter);

    conditionals.push({
      id: conditionalId,
      signalName: signalNames[0] ?? '',
      signalNames,
      jsExpression,
      initialValue,
      templateContent: processedCondResult.html,
      startIndex: condEl.tagStart,
      endIndex: condEl.closeTagEnd,
      nestedBindings,
      nestedItemBindings: [],
      nestedConditionals: [],
      nestedEventBindings: processedCondResult.eventBindings,
    });

    bindings.push(...nestedBindings);
  }
  for (const binding of parsed.bindings) {
    if (binding.type !== 'whenElse') continue;
    if (!binding.jsExpression || !binding.thenTemplate || !binding.elseTemplate) continue;

    const signalNames = binding.signalNames || [binding.signalName];
    const jsExpression = binding.jsExpression;

    const thenId = `b${idCounter++}`;
    const elseId = `b${idCounter++}`;
    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);
    const thenProcessed = processSubTemplateWithNesting(binding.thenTemplate, signalInitializers, idCounter, thenId);
    idCounter = thenProcessed.nextId;
    const elseProcessed = processSubTemplateWithNesting(binding.elseTemplate, signalInitializers, idCounter, elseId);
    idCounter = elseProcessed.nextId;

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
  for (const binding of parsed.bindings) {
    if (elementsInsideConditionals.has(binding.element)) continue;
    if (conditionalElementSet.has(binding.element)) continue;
    if (binding.type === 'when' || binding.type === 'whenElse') continue;

    if (!elementIdMap.has(binding.element)) {
      elementIdMap.set(binding.element, `b${idCounter++}`);
    }
    const elementId = elementIdMap.get(binding.element)!;

    bindings.push({
      id: elementId,
      signalName: binding.signalName,
      type: binding.type as 'text' | 'style' | 'attr',
      property: binding.property,
      isInsideConditional: true,
      conditionalId: parentId,
    });
  }
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  for (const cond of conditionals) {
    const replacement = cond.initialValue ? cond.templateContent : `<template id="${cond.id}"></template>`;
    edits.push({ start: cond.startIndex, end: cond.endIndex, replacement });
  }
  for (const we of whenElseBlocks) {
    const thenReplacement = we.initialValue ? we.thenTemplate : `<template id="${we.thenId}"></template>`;
    const elseReplacement = we.initialValue ? `<template id="${we.elseId}"></template>` : we.elseTemplate;
    edits.push({ start: we.startIndex, end: we.endIndex, replacement: thenReplacement + elseReplacement });
  }
  const conditionalRanges = conditionals.map((c) => ({ start: c.startIndex, end: c.endIndex }));
  const whenElseRanges = whenElseBlocks.map((w) => ({ start: w.startIndex, end: w.endIndex }));
  const allRanges = [...conditionalRanges, ...whenElseRanges];

  const exprRegex = /\$\{(\w+)\(\)\}/g;
  let match: RegExpExecArray | null;
  while ((match = exprRegex.exec(templateContent)) !== null) {
    const exprStart = match.index;
    const exprEnd = exprStart + match[0].length;
    const insideRange = allRanges.some((r) => exprStart >= r.start && exprStart < r.end);
    if (insideRange) continue;

    const signalName = match[1];
    if (!signalName) continue;
    const value = signalInitializers.get(signalName);
    const replacement = value !== undefined ? String(value) : '';
    edits.push({ start: exprStart, end: exprEnd, replacement });
  }
  for (const [element, id] of elementIdMap) {
    const insideRange = allRanges.some((r) => element.tagStart >= r.start && element.tagStart < r.end);
    if (insideRange) continue;
    if (element.attributes.has('id')) continue;
    edits.push({ start: element.tagNameEnd, end: element.tagNameEnd, replacement: ` id="${id}"` });
  }
  edits.sort((a, b) => b.start - a.start);
  let result = templateContent;
  for (const edit of edits) {
    result = result.substring(0, edit.start) + edit.replacement + result.substring(edit.end);
  }

  result = result.replace(/\s+/g, ' ').trim();

  return {
    processedContent: result,
    bindings,
    conditionals,
    whenElseBlocks,
    nextId: idCounter,
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
  textBindingSpans: Map<number, string> = new Map(),
): string => {
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const elementEventMap = new Map<HtmlElement, EventBinding[]>();
  for (const evt of eventBindings) {
    for (const [element, id] of elementIdMap) {
      if (id === evt.elementId) {
        if (!elementEventMap.has(element)) {
          elementEventMap.set(element, []);
        }
        elementEventMap.get(element)!.push(evt);
        break;
      }
    }
  }
  for (const cond of conditionals) {
    const replacement = cond.initialValue ? cond.templateContent : `<template id="${cond.id}"></template>`;
    edits.push({
      start: cond.startIndex,
      end: cond.endIndex,
      replacement,
    });
  }
  for (const we of whenElseBlocks) {
    const thenReplacement = we.initialValue ? injectIdIntoFirstElement(we.thenTemplate, we.thenId) : `<template id="${we.thenId}"></template>`;
    const elseReplacement = we.initialValue ? `<template id="${we.elseId}"></template>` : injectIdIntoFirstElement(we.elseTemplate, we.elseId);
    edits.push({
      start: we.startIndex,
      end: we.endIndex,
      replacement: thenReplacement + elseReplacement,
    });
  }
  for (const rep of repeatBlocks) {
    const replacement = `<template id="${rep.id}"></template>`;
    edits.push({
      start: rep.startIndex,
      end: rep.endIndex,
      replacement,
    });
  }
  const conditionalRanges = conditionals.map((c) => ({ start: c.startIndex, end: c.endIndex }));
  const whenElseRanges = whenElseBlocks.map((w) => ({ start: w.startIndex, end: w.endIndex }));
  const repeatRanges = repeatBlocks.map((r) => ({ start: r.startIndex, end: r.endIndex }));
  const allRanges = [...conditionalRanges, ...whenElseRanges, ...repeatRanges];

  const exprRegex = /\$\{(\w+)\(\)\}/g;
  let match: RegExpExecArray | null;

  while ((match = exprRegex.exec(originalHtml)) !== null) {
    const exprStart = match.index;
    const exprEnd = exprStart + match[0].length;
    const insideRange = allRanges.some((r) => exprStart >= r.start && exprStart < r.end);
    if (insideRange) continue;

    const signalName = match[1];
    if (!signalName) continue;
    const value = signalInitializers.get(signalName);
    const valueStr = value !== undefined ? String(value) : '';
    const spanId = textBindingSpans.get(exprStart);
    let replacement: string;
    if (spanId) {
      replacement = `<span id="${spanId}">${valueStr}</span>`;
    } else {
      replacement = valueStr;
    }

    edits.push({ start: exprStart, end: exprEnd, replacement });
  }
  const elementDataAttrs = new Map<HtmlElement, string[]>();

  for (const binding of parsed.bindings) {
    if (binding.type === 'event' && binding.eventName) {
      const eventBinding = eventBindings.find((eb) => eb.eventName === binding.eventName && eb.startIndex === binding.expressionStart);
      if (eventBinding) {
        edits.push({
          start: binding.expressionStart,
          end: binding.expressionEnd,
          replacement: '',
        });
        const attrValue = eventBinding.modifiers.length > 0 ? `${eventBinding.id}:${eventBinding.modifiers.join(':')}` : eventBinding.id;
        if (!elementDataAttrs.has(binding.element)) {
          elementDataAttrs.set(binding.element, []);
        }
        elementDataAttrs.get(binding.element)!.push(`data-evt-${binding.eventName}="${attrValue}"`);
      }
    }
  }
  for (const [element, id] of elementIdMap) {
    const insideRange = allRanges.some((r) => element.tagStart >= r.start && element.tagStart < r.end);
    if (insideRange) continue;
    const attrsToAdd: string[] = [];
    if (!element.attributes.has('id')) {
      attrsToAdd.push(`id="${id}"`);
    }
    const dataAttrs = elementDataAttrs.get(element);
    if (dataAttrs) {
      attrsToAdd.push(...dataAttrs);
    }

    if (attrsToAdd.length > 0) {
      edits.push({
        start: element.tagNameEnd,
        end: element.tagNameEnd,
        replacement: ' ' + attrsToAdd.join(' '),
      });
    }
  }
  edits.sort((a, b) => b.start - a.start);

  let result = originalHtml;
  for (const edit of edits) {
    result = result.substring(0, edit.start) + edit.replacement + result.substring(edit.end);
  }
  result = result.replace(/\s+/g, ' ').trim();

  return result;
};
