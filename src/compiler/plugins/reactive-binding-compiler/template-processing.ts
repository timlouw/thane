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
  attributeDomProperty,
  escapeRawTemplateLiteral,
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
  buildBoundMarkEdits,
  anchorMark,
  stripPropertyBoundAttributes,
  applyTemplateEdits,
  toRepeatBlock,
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

const isInsideRepeatRange = (start: number, end: number, repeatBlocks: RepeatBlock[]): boolean => {
  return repeatBlocks.some((rep) => start >= rep.startIndex && end <= rep.endIndex);
};

interface ProcessedTemplate {
  processedContent: string;
  bindings: BindingInfo[];
  conditionals: ConditionalBlock[];
  whenElseBlocks: WhenElseBlock[];
  repeatBlocks: RepeatBlock[];
  eventBindings: EventBinding[];
  nextId: number;
}

/**
 * Show a template's parse diagnostics to the developer: an error as a warning, a warning as info.
 * Every template string is reported where it is parsed first: the component template, a whenElse()
 * branch and a row template. A when() element's content is part of its parent's markup, reported
 * with it.
 */
export const reportParseDiagnostics = (parsed: ParsedTemplate): void => {
  for (const diag of parsed.diagnostics) {
    const message = `Template parse ${diag.severity}: ${diag.message} (at position ${diag.position})`;
    if (diag.severity === 'error') logger.warn(NAME, message);
    else logger.info(NAME, message);
  }
};

/**
 * Process a template: the component template (`parentId` null) or the content of a directive,
 * a when() element or a whenElse() branch (`parentId` its id), whose bindings are owned by that
 * directive's initializer. `report` shows the template's parse diagnostics (see
 * reportParseDiagnostics); the component template's always are.
 */
const processTemplate = (
  templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  startingId: number,
  parentId: string | null,
  options: { detectNonSignalBindings?: boolean } | undefined,
  eventIdCounter: { value: number },
  report = false,
): ProcessedTemplate => {
  const parsed = parseHtmlTemplate(templateContent, options);
  if (parentId === null || report) reportParseDiagnostics(parsed);

  const bindings: BindingInfo[] = [];
  const repeatBlocks: RepeatBlock[] = [];
  const eventBindings: EventBinding[] = [];
  const elementIdMap = new Map<HtmlElement, string>();
  // Share the caller's event id counter so ids stay unique across nesting levels
  const state: IdState = { idCounter: startingId, eventIdCounter, elementIdMap };
  const scope =
    parentId === null ? { isInsideConditional: false } : { isInsideConditional: true, conditionalId: parentId };

  const processSubTemplate: SubTemplateProcessor = (template, id, report) =>
    processTemplate(template, signalInitializers, state.idCounter, id, options, state.eventIdCounter, report);

  // ── Conditionals — each when() element's content is processed as a sub-template ──
  //    Bindings inside a nested when() are owned by that conditional's initializer. Only the
  //    component template adds them to its list, which then strips their property-bound
  //    attributes from the pre-rendered content a second time.
  const condResult = collectConditionalBlocks(parsed, templateContent, signalInitializers, state, {
    processSubTemplate,
  });
  const conditionals = condResult.conditionals;
  if (parentId === null) bindings.push(...condResult.bindings);

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
  const branches = collectWhenElseBlocks(filteredForWhenElse, signalInitializers, state, processSubTemplate);
  const whenElseBlocks = branches.whenElseBlocks;
  conditionals.push(...branches.conditionals);

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
      signalInitializers,
      state.idCounter,
    );
    state.idCounter = itemTemplateProcessed.nextId;
    repeatBlocks.push(toRepeatBlock(binding, repeatId, itemTemplateProcessed, binding.itemsExpression, signalNames));
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
  /** Expression text bindings that need special handling (full ${expr} replacement) */
  const expressionBindingSpans = new Map<number, { spanId: string; exprEnd: number }>();
  /** Non-text expression bindings (${...} in attr/style) that must be neutralized in static template HTML */
  const inlineExpressionReplacements = new Map<number, { exprEnd: number; replacement: string }>();
  const pushEvent = (binding: ParsedBindingInfo, elementId: string): void => {
    eventBindings.push({
      id: `e${state.eventIdCounter.value++}`,
      eventName: binding.eventName!,
      modifiers: binding.eventModifiers || [],
      handlerExpression: binding.handlerExpression!,
      elementId,
      startIndex: binding.expressionStart,
      endIndex: binding.expressionEnd,
    });
  };
  const componentEvents: ParsedBindingInfo[] = [];
  for (const binding of parsed.bindings) {
    if (elementsInsideConditionals.has(binding.element)) continue;
    if (conditionalElementSet.has(binding.element)) continue;
    if (binding.type === 'when' || binding.type === 'whenElse' || binding.type === 'repeat') continue;
    // The component template binds its events after every other binding (id allocation order)
    if (binding.type === 'event' && parentId === null) {
      componentEvents.push(binding);
      continue;
    }

    if (binding.type === 'text') {
      // Text bindings use comment markers — assign a dedicated ID
      const spanId = `b${state.idCounter++}`;
      textBindingSpans.set(binding.expressionStart, {
        spanId,
        exprEnd: binding.expressionEnd,
        signalName: binding.signalName,
      });

      // Expression text binding (e.g. ${count() + 1} or ${product.title}) vs bare signal (e.g. ${count()})
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
              signalNames: binding.signalNames || [],
              expression: binding.jsExpression!,
              type: 'text' as const,
              ...scope,
            }
          : {
              id: spanId,
              signalName: binding.signalName,
              type: 'text' as const,
              ...scope,
            },
      );
      continue;
    }

    // A bound element is marked with a binding id of its own; a developer's id is left alone
    if (!elementIdMap.has(binding.element)) elementIdMap.set(binding.element, `b${state.idCounter++}`);
    const elementId = elementIdMap.get(binding.element)!;

    if (binding.type === 'event') {
      if (binding.eventName && binding.handlerExpression) pushEvent(binding, elementId);
      continue;
    }

    if (binding.type !== 'style' && binding.type !== 'attr') {
      continue;
    }
    const isExpressionBinding = binding.jsExpression !== undefined;
    // Check if the expression is a bare (unquoted) attribute value: attr=${...}
    // In that case the replacement must be quoted to prevent the browser's HTML parser
    // from swallowing the next attribute as this attribute's value.
    const isUnquotedAttrValue = binding.expressionStart > 0 && templateContent[binding.expressionStart - 1] === '=';
    if (isExpressionBinding) {
      inlineExpressionReplacements.set(binding.expressionStart, {
        exprEnd: binding.expressionEnd,
        replacement: isUnquotedAttrValue ? '""' : '',
      });
    } else {
      const initialValue = signalInitializers.get(binding.signalName);
      const raw = initialValue !== undefined ? escapeRawTemplateLiteral(String(initialValue)) : '';
      inlineExpressionReplacements.set(binding.expressionStart, {
        exprEnd: binding.expressionEnd,
        replacement: isUnquotedAttrValue ? `"${raw}"` : raw,
      });
    }
    bindings.push(
      isExpressionBinding
        ? {
            id: elementId,
            signalNames: binding.signalNames || [],
            expression: binding.jsExpression!,
            type: binding.type,
            ...(binding.property ? { property: binding.property } : {}),
            ...domPropertyFor(binding),
            ...scope,
          }
        : {
            id: elementId,
            signalName: binding.signalName,
            type: binding.type,
            ...(binding.property ? { property: binding.property } : {}),
            ...domPropertyFor(binding),
            ...scope,
          },
    );
  }
  for (const binding of componentEvents) {
    if (!binding.eventName || !binding.handlerExpression) continue;
    if (!elementIdMap.has(binding.element)) {
      elementIdMap.set(binding.element, `b${state.idCounter++}`);
    }
    pushEvent(binding, elementIdMap.get(binding.element)!);
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
    ...buildWhenElseEdits(rootWhenElseBlocks),
    // A list's rows go before its anchor comment
    ...repeatBlocks.map((rep) => ({ start: rep.startIndex, end: rep.endIndex, replacement: anchorMark(rep.id, '.') })),
    ...buildSignalReplacementEdits(
      signalInitializers,
      allRanges,
      textBindingSpans,
      expressionBindingSpans,
      inlineExpressionReplacements,
    ),
    ...buildBoundMarkEdits(elementIdMap, allRanges),
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
 * Process the main HTML template with all conditional directives
 */
export const processHtmlTemplateWithConditionals = (
  templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  startingId: number,
): ProcessedTemplate =>
  processTemplate(
    templateContent,
    signalInitializers,
    startingId,
    null,
    { detectNonSignalBindings: true },
    { value: 0 },
  );

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
  report?: boolean,
): ProcessedTemplate =>
  processTemplate(
    templateContent,
    signalInitializers,
    startingId,
    parentId,
    options,
    eventIdCounter ?? { value: 0 },
    report,
  );
