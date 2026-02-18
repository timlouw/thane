/**
 * Template processing for reactive binding compiler
 * 
 * Handles processing of HTML templates with conditionals, including
 * evaluation of conditional expressions, element HTML processing,
 * and sub-template nesting.
 */

import ts from 'typescript';
import vm from 'node:vm';
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
  injectIdIntoFirstElement,
  type HtmlElement,
  type ParsedTemplate,
} from '../../utils/html-parser/index.js';
import {
  collectConditionalBlocks,
  collectWhenElseBlocks,
  buildConditionalEdits,
  buildWhenElseEdits,
  buildSignalReplacementEdits,
  buildElementIdEdits,
  buildRangeOverlapChecker,
  applyTemplateEdits,
  type IdState,
  type TemplateEdit,
} from './template-utils.js';

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
  textBindingCommentIds?: Map<string, string>,
): { html: string; eventBindings: EventBinding[] } => {
  let html = getElementHtml(element, originalHtml);
  const eventBindings: EventBinding[] = [];
  if (element.whenDirective) {
    html = html.replace(element.whenDirective, '');
  }
  // Ensure the element has the conditional ID — reuse user ID when it matches
  if (element.attributes.has('id')) {
    const userIdAttr = element.attributes.get('id')!;
    if (userIdAttr.value !== conditionalId) {
      // User ID differs from conditional ID (shouldn't happen with reuse, but guard)
      html = html.replace(`id="${userIdAttr.value}"`, `id="${conditionalId}"`);
    }
    // else: user's ID is already the conditional ID — leave it as-is
  } else {
    const tagNameEnd = element.tagName.length + 1; // +1 for '<'
    html = html.substring(0, tagNameEnd) + ` id="${conditionalId}"` + html.substring(tagNameEnd);
  }
  // Replace text binding expressions with comment markers + initial values
  if (textBindingCommentIds && textBindingCommentIds.size > 0) {
    html = html.replace(/\$\{(\w+)\(\)\}/g, (_match, signalName) => {
      const commentId = textBindingCommentIds.get(signalName);
      if (commentId) {
        const value = signalInitializers.get(signalName);
        const valueStr = value !== undefined ? String(value) : ' ';
        return `<!--${commentId}-->${valueStr}<!---->`;
      }
      // Not a tracked text binding — replace with bare value (attr/style bindings)
      const value = signalInitializers.get(signalName);
      return value !== undefined ? String(value) : '';
    });
  } else {
    html = replaceExpressionsWithValues(html, signalInitializers);
  }
  // Find event bindings: @eventName.modifier=${handler}
  // Use a regex that handles nested braces via a non-greedy match up to the closing }
  const eventAttrRegex = /@([\w.]+)=\$\{((?:[^{}]|\{[^}]*\})*)\}/g;
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
    eventReplacements.push({
      original: fullMatch,
      replacement: '', // Remove @event attribute — events use direct addEventListener
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
      // Build the exact when() attribute value to search for as a literal string
      const whenAttrValue = `"\${when(${nestedCond.jsExpression})}"`;
      const whenAttrIdx = html.indexOf(whenAttrValue);
      if (whenAttrIdx !== -1) {
        // Find the enclosing element for this when() directive
        // Scan backwards from the when attr to find the opening '<'
        let openTagStart = whenAttrIdx - 1;
        while (openTagStart >= 0 && html[openTagStart] !== '<') openTagStart--;
        
        if (openTagStart >= 0) {
          // Extract the tag name
          let tagNameEndPos = openTagStart + 1;
          while (tagNameEndPos < html.length && /[\w-]/.test(html[tagNameEndPos]!)) tagNameEndPos++;
          const tagName = html.substring(openTagStart + 1, tagNameEndPos);
          
          // Find the closing tag for this element
          const closeTag = `</${tagName}>`;
          const openTagEndIdx = html.indexOf('>', whenAttrIdx);
          if (openTagEndIdx !== -1) {
            // Simple case: find the matching close tag (handles non-nested same-tag)
            let depth = 1;
            let searchPos = openTagEndIdx + 1;
            let closeTagStart = -1;
            while (searchPos < html.length && depth > 0) {
              const nextOpen = html.indexOf(`<${tagName}`, searchPos);
              const nextClose = html.indexOf(closeTag, searchPos);
              if (nextClose === -1) break;
              if (nextOpen !== -1 && nextOpen < nextClose) {
                depth++;
                searchPos = nextOpen + tagName.length + 1;
              } else {
                depth--;
                if (depth === 0) {
                  closeTagStart = nextClose;
                }
                searchPos = nextClose + closeTag.length;
              }
            }
            if (closeTagStart !== -1) {
              html = html.substring(0, openTagStart) + `<template id="${nestedCond.id}"></template>` + html.substring(closeTagStart + closeTag.length);
              continue;
            }
          }
        }
        // Fallback: just remove the when attribute value
        html = html.replace(whenAttrValue, '');
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

    // Find and inject ID into the first matching opening tag for this element's tagName
    const openTag = `<${el.tagName}`;
    let searchPos = 0;
    while (searchPos < result.length) {
      const tagPos = result.indexOf(openTag, searchPos);
      if (tagPos === -1) break;
      
      // Verify the character after the tag name is whitespace or '>' (not a longer tag name)
      const afterTag = result[tagPos + openTag.length];
      if (afterTag !== ' ' && afterTag !== '>' && afterTag !== '/' && afterTag !== '\n' && afterTag !== '\t') {
        searchPos = tagPos + 1;
        continue;
      }
      
      // Check if this tag already has an id attribute
      const tagEnd = result.indexOf('>', tagPos);
      if (tagEnd === -1) break;
      const tagContent = result.substring(tagPos, tagEnd + 1);
      if (tagContent.includes('id="')) {
        // Element already has an id — reuse it as the binding anchor
        break;
      }
      
      // Inject the ID after the tag name
      result = result.substring(0, tagPos + openTag.length) + ` id="${id}"` + result.substring(tagPos + openTag.length);
      break; // Only inject into the first matching unid'd tag
    }
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
  const repeatBlocks: RepeatBlock[] = [];
  const eventBindings: EventBinding[] = [];
  const elementIdMap = new Map<HtmlElement, string>();
  const state: IdState = { idCounter: startingId, eventIdCounter: { value: 0 }, elementIdMap };

  // ── Conditionals (with nested conditional support) ──
  const condResult = collectConditionalBlocks(parsed, templateContent, signalInitializers, state, {
    handleNestedConditionals: true,
  });
  const conditionals = condResult.conditionals;
  bindings.push(...condResult.bindings);
  eventBindings.push(...condResult.eventBindings);

  // ── WhenElse ──
  const whenElseBlocks = collectWhenElseBlocks(parsed, signalInitializers, state, (template, id) =>
    processSubTemplateWithNesting(template, signalInitializers, state.idCounter, id),
  );

  // ── Collect conditional element sets for filtering later bindings ──
  const allConditionalElements = findElementsWithWhenDirective(parsed.roots);
  const conditionalElementSet = new Set(allConditionalElements);
  const elementsInsideConditionals = new Set<HtmlElement>();
  for (const condEl of allConditionalElements) {
    walkElements([condEl], (el) => {
      if (el !== condEl) elementsInsideConditionals.add(el);
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
    const repeatId = `b${state.idCounter++}`;
    const itemTemplateProcessed = processItemTemplate(binding.itemTemplate, binding.itemVar, binding.indexVar, state.idCounter, signalInitializers);
    state.idCounter = itemTemplateProcessed.nextId;
    let processedEmptyTemplate: string | undefined;
    if (binding.emptyTemplate) {
      processedEmptyTemplate = binding.emptyTemplate.replace(/\s+/g, ' ').replace(/>\s+</g, '><').replace(/\s+>/g, '>').trim();
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

      // Expression text binding (e.g. ${count() + 1}) vs bare signal (e.g. ${count()})
      const isExpressionBinding = binding.jsExpression !== undefined && binding.signalNames && binding.signalNames.length > 0;

      if (isExpressionBinding) {
        expressionBindingSpans.set(binding.expressionStart, {
          spanId,
          exprEnd: binding.expressionEnd,
        });
      }

      bindings.push(isExpressionBinding ? {
        id: spanId,
        signalNames: binding.signalNames!,
        expression: binding.jsExpression!,
        type: 'text' as const,
        isInsideConditional: false,
      } : {
        id: spanId,
        signalName: binding.signalName,
        type: 'text' as const,
        isInsideConditional: false,
      });
      continue;
    }
    if (!elementIdMap.has(binding.element)) {
      elementIdMap.set(binding.element, `b${state.idCounter++}`);
    }
    const elementId = elementIdMap.get(binding.element)!;

    const isExpressionBinding = binding.jsExpression !== undefined && binding.signalNames && binding.signalNames.length > 0;
    if (isExpressionBinding) {
      inlineExpressionReplacements.set(binding.expressionStart, {
        exprEnd: binding.expressionEnd,
        replacement: '',
      });
      bindings.push({
        id: elementId,
        signalNames: binding.signalNames!,
        expression: binding.jsExpression!,
        type: binding.type as 'style' | 'attr',
        ...(binding.property ? { property: binding.property } : {}),
        isInsideConditional: false,
      });
    } else {
      bindings.push({
        id: elementId,
        signalName: binding.signalName,
        type: binding.type as 'style' | 'attr',
        property: binding.property!,
        isInsideConditional: false,
      });
    }
  }
  for (const binding of parsed.bindings) {
    if (binding.type !== 'event') continue;
    if (!binding.eventName || !binding.handlerExpression) continue;

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
    processedContent,
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
): {
  processedContent: string;
  bindings: BindingInfo[];
  conditionals: ConditionalBlock[];
  whenElseBlocks: WhenElseBlock[];
  nextId: number;
} => {
  const parsed = parseHtmlTemplate(templateContent);
  const bindings: BindingInfo[] = [];
  const elementIdMap = new Map<HtmlElement, string>();
  const state: IdState = { idCounter: startingId, eventIdCounter: { value: 0 }, elementIdMap };

  // ── Conditionals ──
  const condResult = collectConditionalBlocks(parsed, templateContent, signalInitializers, state);
  const conditionals = condResult.conditionals;
  bindings.push(...condResult.bindings);

  // ── WhenElse ──
  const whenElseBlocks = collectWhenElseBlocks(parsed, signalInitializers, state, (template, id) =>
    processSubTemplateWithNesting(template, signalInitializers, state.idCounter, id),
  );

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
  for (const binding of parsed.bindings) {
    if (elementsInsideConditionals.has(binding.element)) continue;
    if (conditionalElementSet.has(binding.element)) continue;
    if (binding.type === 'when' || binding.type === 'whenElse') continue;

    if (binding.type === 'text') {
      // Text bindings use comment markers — assign a dedicated ID
      const spanId = `b${state.idCounter++}`;
      textBindingSpans.set(binding.expressionStart, {
        spanId,
        exprEnd: binding.expressionEnd,
        signalName: binding.signalName,
      });

      const isExpressionBinding = binding.jsExpression !== undefined && binding.signalNames && binding.signalNames.length > 0;
      if (isExpressionBinding) {
        expressionBindingSpans.set(binding.expressionStart, {
          spanId,
          exprEnd: binding.expressionEnd,
        });
      }

      bindings.push(isExpressionBinding ? {
        id: spanId,
        signalNames: binding.signalNames!,
        expression: binding.jsExpression!,
        type: 'text' as const,
        isInsideConditional: true,
        conditionalId: parentId,
      } : {
        id: spanId,
        signalName: binding.signalName,
        type: 'text' as const,
        isInsideConditional: true,
        conditionalId: parentId,
      });
      continue;
    }

    if (!elementIdMap.has(binding.element)) {
      elementIdMap.set(binding.element, `b${state.idCounter++}`);
    }
    const elementId = elementIdMap.get(binding.element)!;
    const isExpressionBinding = binding.jsExpression !== undefined && binding.signalNames && binding.signalNames.length > 0;
    bindings.push(isExpressionBinding ? {
      id: elementId,
      signalNames: binding.signalNames!,
      expression: binding.jsExpression!,
      type: binding.type as 'text' | 'style' | 'attr',
      ...(binding.property ? { property: binding.property } : {}),
      isInsideConditional: true,
      conditionalId: parentId,
    } : {
      id: elementId,
      signalName: binding.signalName,
      type: binding.type as 'text' | 'style' | 'attr',
      ...(binding.property ? { property: binding.property } : {}),
      isInsideConditional: true,
      conditionalId: parentId,
    });
  }

  // ── Build edits and apply ──
  const allRanges = [
    ...conditionals.map((c) => ({ start: c.startIndex, end: c.endIndex })),
    ...whenElseBlocks.map((w) => ({ start: w.startIndex, end: w.endIndex })),
  ];
  const edits: TemplateEdit[] = [
    ...buildConditionalEdits(conditionals),
    ...buildWhenElseEdits(whenElseBlocks, false),
    ...buildSignalReplacementEdits(templateContent, signalInitializers, allRanges, textBindingSpans, expressionBindingSpans),
    ...buildElementIdEdits(elementIdMap, allRanges),
  ];

  return {
    processedContent: applyTemplateEdits(templateContent, edits),
    bindings,
    conditionals,
    whenElseBlocks,
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
  const allRanges = [
    ...conditionals.map((c) => ({ start: c.startIndex, end: c.endIndex })),
    ...whenElseBlocks.map((w) => ({ start: w.startIndex, end: w.endIndex })),
    ...repeatBlocks.map((r) => ({ start: r.startIndex, end: r.endIndex })),
  ];

  const edits: TemplateEdit[] = [
    ...buildConditionalEdits(conditionals),
    ...buildWhenElseEdits(whenElseBlocks, true, injectIdIntoFirstElement),
    ...repeatBlocks.map((rep) => ({ start: rep.startIndex, end: rep.endIndex, replacement: `<template id="${rep.id}"></template>` })),
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
      const eventBinding = eventBindings.find((eb) => eb.eventName === binding.eventName && eb.startIndex === binding.expressionStart);
      if (eventBinding) {
        edits.push({ start: binding.expressionStart, end: binding.expressionEnd, replacement: '' });
      }
    }
  }

  // Element ID injection (no event data attributes — events use direct addEventListener)
  const isInsideRange = buildRangeOverlapChecker(allRanges);
  for (const [element, id] of elementIdMap) {
    if (isInsideRange(element.tagStart)) continue;
    edits.push({ start: element.tagNameEnd, end: element.tagNameEnd, replacement: ` id="${id}"` });
  }

  return applyTemplateEdits(originalHtml, edits);
};
