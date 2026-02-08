/**
 * Repeat directive analysis for reactive binding compiler
 * 
 * Handles processing of repeat() item templates, text binding context analysis,
 * and static repeat template generation for optimized rendering.
 */

import type {
  ConditionalBlock,
  WhenElseBlock,
  RepeatBlock,
  ItemBinding,
  ItemEventBinding,
  BindingInfo,
  EventBinding,
  StaticTemplateInfo,
  RepeatOptimizationSkipReason,
} from './types.js';
import {
  safeEvaluateCondition,
  processConditionalElementHtml,
  processSubTemplateWithNesting,
} from './template-processing.js';
import {
  parseHtmlTemplate,
  walkElements,
  findElementsWithWhenDirective,
  getBindingsForElement,
  type HtmlElement,
} from '../../utils/html-parser.js';

/**
 * Get a human-readable explanation for why optimization was skipped
 */
export const getOptimizationSkipMessage = (reason: RepeatOptimizationSkipReason): string => {
  switch (reason) {
    case 'no-bindings':
      return 'no item bindings found';
    case 'signal-bindings':
      return 'contains component signal bindings (this._signalName()) inside items - move to data model';
    case 'nested-repeat':
      return 'contains nested repeat() - not yet supported for optimization';
    case 'nested-conditional':
      return 'contains when()/whenElse() inside items - not yet supported for optimization';
    case 'item-events':
      return 'contains @event handlers inside items - use event delegation on container instead';
    case 'mixed-bindings':
      return 'item bindings reference component signals (this._) - use pure item data instead';
    case 'multi-root':
      return 'template has multiple root elements - wrap in a single container element';
    case 'path-not-found':
      return 'element navigation path could not be computed';
  }
};

/**
 * Generate a static template and element paths for optimized repeat rendering
 * 
 * This transforms a dynamic template like:
 *   <tr data-id="${item.id}"><td><span>${item.label}</span></td></tr>
 * Into a static template:
 *   <tr><td><span></span></td></tr>
 * Plus navigation paths to each dynamic element.
 */
export const generateStaticRepeatTemplate = (
  itemTemplate: string,
  itemBindings: ItemBinding[],
  itemVar: string,
): StaticTemplateInfo => {
  // Parse the template to get element structure
  const parsed = parseHtmlTemplate(itemTemplate);
  
  if (parsed.roots.length !== 1) {
    // Multiple root elements - cannot use optimized path
    return { staticHtml: '', elementBindings: [], canUseOptimized: false, skipReason: 'multi-root' };
  }
  
  const rootEl = parsed.roots[0]!;
  
  // Build a map of element ID to bindings
  const bindingsByElement = new Map<string, ItemBinding[]>();
  for (const binding of itemBindings) {
    if (!bindingsByElement.has(binding.elementId)) {
      bindingsByElement.set(binding.elementId, []);
    }
    bindingsByElement.get(binding.elementId)!.push(binding);
  }
  
  // Compute path for each element with bindings
  const elementPaths = new Map<string, number[]>();
  
  const findElementPath = (el: HtmlElement, targetId: string, currentPath: number[]): number[] | null => {
    // Check if this element has the target ID
    const elId = el.attributes.get('id')?.value || el.attributes.get('data-bind-id')?.value;
    if (elId === targetId) {
      return currentPath;
    }
    
    // Search children
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i]!;
      const childPath = findElementPath(child, targetId, [...currentPath, i]);
      if (childPath) return childPath;
    }
    
    return null;
  };
  
  // Find path for each element with bindings
  for (const elementId of bindingsByElement.keys()) {
    // Check if root element matches
    const rootId = rootEl.attributes.get('id')?.value || rootEl.attributes.get('data-bind-id')?.value;
    if (rootId === elementId) {
      elementPaths.set(elementId, []);
    } else {
      const path = findElementPath(rootEl, elementId, []);
      if (path) {
        elementPaths.set(elementId, path);
      }
    }
  }
  
  // Check if all bindings have paths
  for (const elementId of bindingsByElement.keys()) {
    if (!elementPaths.has(elementId)) {
      return { staticHtml: '', elementBindings: [], canUseOptimized: false, skipReason: 'path-not-found' };
    }
  }
  
  // Generate static HTML by removing dynamic expressions
  let staticHtml = itemTemplate;
  
  // Remove template literal expressions ${...} that contain item variable
  // Replace text content bindings with empty spans or just empty text
  const itemPattern = new RegExp(`\\$\\{[^}]*\\b${itemVar}[^}]*\\}`, 'g');
  staticHtml = staticHtml.replace(itemPattern, '');
  
  // Remove data-bind-id attributes (we use paths instead)
  staticHtml = staticHtml.replace(/\s*data-bind-id="[^"]*"/g, '');
  
  // Remove inline id attributes that were only added for bindings
  // These follow the pattern id="i0", id="i1", etc.
  staticHtml = staticHtml.replace(/\s*id="i\d+"/g, '');
  
  // Clean up whitespace
  staticHtml = staticHtml.replace(/\s+/g, ' ').trim();
  
  // Build element bindings array (sorted by path for consistent indexing)
  const elementBindingsArray: StaticTemplateInfo['elementBindings'] = [];
  const sortedIds = [...bindingsByElement.keys()].sort((a, b) => {
    const pathA = elementPaths.get(a) || [];
    const pathB = elementPaths.get(b) || [];
    // Sort by path length, then by path values
    if (pathA.length !== pathB.length) return pathA.length - pathB.length;
    for (let i = 0; i < pathA.length; i++) {
      if (pathA[i] !== pathB[i]) return pathA[i]! - pathB[i]!;
    }
    return 0;
  });
  
  for (const elementId of sortedIds) {
    const bindings = bindingsByElement.get(elementId)!;
    const path = elementPaths.get(elementId)!;
    
    elementBindingsArray.push({
      id: elementId,
      path,
      bindings: bindings.map(b => ({
        type: b.type as 'text' | 'attr',
        property: b.property,
        expression: b.expression,
      })),
    });
  }
  
  return {
    staticHtml,
    elementBindings: elementBindingsArray,
    canUseOptimized: true,
  };
};

/**
 * Analyze if a text binding at a given position is the sole content of its parent element.
 * This determines whether we can use textContent (no wrapper needed) or need a comment marker.
 * 
 * @param templateContent The full template HTML
 * @param bindingStart Start position of the ${...} expression
 * @param bindingEnd End position of the ${...} expression  
 * @returns Object with analysis results
 */
export const analyzeTextBindingContext = (
  templateContent: string,
  bindingStart: number,
  bindingEnd: number,
): { 
  isSoleContent: boolean; 
  parentTagStart: number;
  parentTagNameEnd: number;
  parentCloseTagStart: number;
} => {
  // Find the opening tag before this binding
  let parentTagStart = -1;
  let parentTagNameEnd = -1;
  let tagDepth = 0;
  let i = bindingStart - 1;
  
  // Scan backwards to find the parent element's opening tag
  while (i >= 0) {
    if (templateContent[i] === '>') {
      // Check if this is an opening tag end (not a closing tag)
      let j = i - 1;
      while (j >= 0 && templateContent[j] !== '<') {
        j--;
      }
      if (j >= 0) {
        const tagContent = templateContent.substring(j, i + 1);
        if (tagContent.startsWith('</')) {
          // Closing tag - go deeper
          tagDepth++;
        } else if (!tagContent.endsWith('/>')) {
          // Opening tag (not self-closing)
          if (tagDepth === 0) {
            parentTagStart = j;
            // Find end of tag name
            let k = j + 1;
            while (k < i && /[\w-]/.test(templateContent[k]!)) {
              k++;
            }
            parentTagNameEnd = k;
            break;
          } else {
            tagDepth--;
          }
        }
      }
    }
    i--;
  }
  
  if (parentTagStart === -1) {
    return { isSoleContent: false, parentTagStart: -1, parentTagNameEnd: -1, parentCloseTagStart: -1 };
  }
  
  // Find the closing tag after this binding
  let parentCloseTagStart = -1;
  tagDepth = 0;
  i = bindingEnd;
  
  while (i < templateContent.length) {
    if (templateContent[i] === '<') {
      const remaining = templateContent.substring(i);
      const closeMatch = remaining.match(/^<\/[\w-]+>/);
      const openMatch = remaining.match(/^<[\w-][^>]*>/);
      
      if (closeMatch) {
        if (tagDepth === 0) {
          parentCloseTagStart = i;
          break;
        } else {
          tagDepth--;
          i += closeMatch[0].length;
          continue;
        }
      } else if (openMatch && !openMatch[0].endsWith('/>')) {
        // Opening tag (not self-closing) - go deeper
        tagDepth++;
        i += openMatch[0].length;
        continue;
      }
    }
    i++;
  }
  
  if (parentCloseTagStart === -1) {
    return { isSoleContent: false, parentTagStart, parentTagNameEnd, parentCloseTagStart: -1 };
  }
  
  // Now check if the binding is the sole content
  // Get content between parent open tag end and binding start
  const parentOpenTagEnd = templateContent.indexOf('>', parentTagStart) + 1;
  const contentBefore = templateContent.substring(parentOpenTagEnd, bindingStart);
  const contentAfter = templateContent.substring(bindingEnd, parentCloseTagStart);
  
  // Check if there's only whitespace before and after
  const onlyWhitespaceBefore = /^\s*$/.test(contentBefore);
  const onlyWhitespaceAfter = /^\s*$/.test(contentAfter);
  
  // Also check that there are no other elements or bindings
  const hasOtherElementsBefore = /<[^>]+>/.test(contentBefore);
  const hasOtherElementsAfter = /<[^>]+>/.test(contentAfter);
  const hasOtherBindingsBefore = /\$\{[^}]+\}/.test(contentBefore);
  const hasOtherBindingsAfter = /\$\{[^}]+\}/.test(contentAfter);
  
  const isSoleContent = 
    onlyWhitespaceBefore && 
    onlyWhitespaceAfter && 
    !hasOtherElementsBefore && 
    !hasOtherElementsAfter &&
    !hasOtherBindingsBefore &&
    !hasOtherBindingsAfter;
  
  return { isSoleContent, parentTagStart, parentTagNameEnd, parentCloseTagStart };
};

/**
 * Process an item template recursively, handling nested conditionals and repeats
 */
export const processItemTemplateRecursively = (
  templateContent: string,
  itemVar: string,
  indexVar: string | undefined,
  signalInitializers: Map<string, string | number | boolean>,
  startingId: number,
): {
  processedContent: string;
  itemBindings: ItemBinding[];
  itemEvents: ItemEventBinding[];
  signalBindings: BindingInfo[];
  eventBindings: EventBinding[];
  nestedConditionals: ConditionalBlock[];
  nestedWhenElse: WhenElseBlock[];
  nestedRepeats: RepeatBlock[];
  nextId: number;
} => {
  const parsed = parseHtmlTemplate(templateContent);

  const itemBindings: ItemBinding[] = [];
  const itemEvents: ItemEventBinding[] = [];
  const signalBindings: BindingInfo[] = [];
  const eventBindings: EventBinding[] = [];
  const conditionals: ConditionalBlock[] = [];
  const whenElseBlocks: WhenElseBlock[] = [];
  const repeatBlocks: RepeatBlock[] = [];

  let idCounter = startingId;
  const eventIdCounter = { value: 0 };
  let itemEventIdCounter = 0;

  const elementIdMap = new Map<HtmlElement, string>();
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
    const itemPattern = new RegExp(`\\$\\{\\s*${itemVar}\\s*\\}`, 'g');
    const condItemBindings: ItemBinding[] = [];
    let transformedCondHtml = processedCondResult.html;
    const itemMatches = [...processedCondResult.html.matchAll(itemPattern)];
    if (itemMatches.length > 0) {
      let offset = 0;
      for (const match of itemMatches) {
        const matchStart = match.index! + offset;
        const matchEnd = matchStart + match[0].length;
        const itemBindingId = `i${idCounter++}`;
        const replacement = `<span id="${itemBindingId}">\${${itemVar}$()}</span>`;
        transformedCondHtml = transformedCondHtml.substring(0, matchStart) + replacement + transformedCondHtml.substring(matchEnd);
        condItemBindings.push({
          elementId: itemBindingId,
          expression: itemVar,
          type: 'text',
        });
        offset += replacement.length - match[0].length;
      }
    }

    conditionals.push({
      id: conditionalId,
      signalName: signalNames[0] ?? '',
      signalNames,
      jsExpression,
      initialValue,
      templateContent: transformedCondHtml,
      startIndex: condEl.tagStart,
      endIndex: condEl.closeTagEnd,
      nestedBindings,
      nestedItemBindings: condItemBindings,
      nestedConditionals: [],
      nestedEventBindings: processedCondResult.eventBindings,
    });

    signalBindings.push(...nestedBindings);
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
  for (const binding of parsed.bindings) {
    if (binding.type !== 'repeat') continue;
    if (!binding.itemsExpression || !binding.itemVar || !binding.itemTemplate) continue;

    const nestedSignalNames = binding.signalNames || [binding.signalName];
    const nestedRepeatId = `b${idCounter++}`;
    const nestedProcessed = processItemTemplateRecursively(binding.itemTemplate, binding.itemVar, binding.indexVar, signalInitializers, idCounter);
    idCounter = nestedProcessed.nextId;
    let processedEmptyTemplate: string | undefined;
    if (binding.emptyTemplate) {
      processedEmptyTemplate = binding.emptyTemplate.replace(/\s+/g, ' ').trim();
    }

    repeatBlocks.push({
      id: nestedRepeatId,
      signalName: nestedSignalNames[0] || '',
      signalNames: nestedSignalNames,
      itemsExpression: binding.itemsExpression,
      itemVar: binding.itemVar,
      indexVar: binding.indexVar,
      itemTemplate: nestedProcessed.processedContent,
      emptyTemplate: processedEmptyTemplate,
      trackByFn: binding.trackByFn,
      startIndex: binding.expressionStart,
      endIndex: binding.expressionEnd,
      itemBindings: nestedProcessed.itemBindings,
      itemEvents: nestedProcessed.itemEvents,
      signalBindings: nestedProcessed.signalBindings,
      eventBindings: nestedProcessed.eventBindings,
      nestedConditionals: nestedProcessed.nestedConditionals,
      nestedWhenElse: nestedProcessed.nestedWhenElse,
      nestedRepeats: nestedProcessed.nestedRepeats,
    });
  }
  const conditionalRanges = conditionals.map((c) => ({ start: c.startIndex, end: c.endIndex }));
  const whenElseRanges = whenElseBlocks.map((w) => ({ start: w.startIndex, end: w.endIndex }));
  const repeatRanges = repeatBlocks.map((r) => ({ start: r.startIndex, end: r.endIndex }));
  const allRanges = [...conditionalRanges, ...whenElseRanges, ...repeatRanges];
  const textBindingSpans = new Map<number, string>();
  for (const binding of parsed.bindings) {
    if (elementsInsideConditionals.has(binding.element)) continue;
    if (conditionalElementSet.has(binding.element)) continue;
    if (binding.type === 'when' || binding.type === 'whenElse' || binding.type === 'repeat') continue;
    const insideRange = allRanges.some((r) => binding.expressionStart >= r.start && binding.expressionStart < r.end);
    if (insideRange) continue;
    if (binding.type === 'event' && binding.eventName && binding.handlerExpression) {
      const refsItem = new RegExp(`\\b${itemVar}\\b`).test(binding.handlerExpression);
      const refsIndex = indexVar ? new RegExp(`\\b${indexVar}\\b`).test(binding.handlerExpression) : false;

      if (refsItem || refsIndex) {
        const eventId = `ie${itemEventIdCounter++}`;
        if (!elementIdMap.has(binding.element)) {
          elementIdMap.set(binding.element, `b${idCounter++}`);
        }
        itemEvents.push({
          eventId,
          eventName: binding.eventName,
          modifiers: binding.eventModifiers || [],
          handlerExpression: binding.handlerExpression,
        });
      } else {
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
      continue;
    }
    if (binding.type === 'text' || binding.type === 'style' || binding.type === 'attr') {
      const spanId = `b${idCounter++}`;

      if (binding.type === 'text') {
        textBindingSpans.set(binding.expressionStart, spanId);
      } else {
        if (!elementIdMap.has(binding.element)) {
          elementIdMap.set(binding.element, spanId);
        }
      }

      signalBindings.push({
        id: binding.type === 'text' ? spanId : elementIdMap.get(binding.element)!,
        signalName: binding.signalName,
        type: binding.type as 'text' | 'style' | 'attr',
        property: binding.property,
        isInsideConditional: false,
        conditionalId: undefined,
      });
    }
  }
  const itemExprRegex = new RegExp(`\\$\\{([^}]*\\b${itemVar}\\b[^}]*)\\}`, 'g');
  const itemTextMatches: Array<{ 
    start: number; 
    end: number; 
    expr: string; 
    id: string;
    isSoleContent: boolean;
    parentTagStart: number;
    parentTagNameEnd: number;
  }> = [];
  let match: RegExpExecArray | null;

  while ((match = itemExprRegex.exec(templateContent)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const insideRange = allRanges.some((r) => matchStart >= r.start && matchStart < r.end);
    if (insideRange) continue;
    const beforeText = templateContent.substring(Math.max(0, matchStart - 200), matchStart);
    const inAttr = /=["'][^"']*$/.test(beforeText);

    if (!inAttr) {
      const expression = match[1]?.trim() ?? '';
      
      // Analyze if this binding is the sole content of its parent element
      const context = analyzeTextBindingContext(templateContent, matchStart, matchEnd);
      
      const id = `i${idCounter++}`;
      
      itemBindings.push({
        elementId: id,
        type: 'text',
        expression: expression,
        textBindingMode: context.isSoleContent ? 'textContent' : 'commentMarker',
      });

      itemTextMatches.push({ 
        start: matchStart, 
        end: matchEnd, 
        expr: expression, 
        id,
        isSoleContent: context.isSoleContent,
        parentTagStart: context.parentTagStart,
        parentTagNameEnd: context.parentTagNameEnd,
      });
    }
  }
  const indexPattern = indexVar ? `|${indexVar}` : '';
  const attrItemRegex = new RegExp(`(?:^|[>\\s])([\\w-]+)=["']\\$\\{([^}]*\\b(?:${itemVar}${indexPattern})\\b[^}]*)\\}["']`, 'g');
  const itemAttrMatches: Array<{ start: number; end: number; attrName: string; expr: string; id: string }> = [];

  while ((match = attrItemRegex.exec(templateContent)) !== null) {
    const leadingChar = match[0].match(/^[>\s]/);
    const leadingOffset = leadingChar ? 1 : 0;
    const matchStart = match.index + leadingOffset;
    const matchEnd = match.index + match[0].length;
    const insideRange = allRanges.some((r) => matchStart >= r.start && matchStart < r.end);
    if (insideRange) continue;

    const id = `i${idCounter++}`;
    const attrName = match[1];
    const expression = match[2]?.trim() ?? '';
    if (!attrName) continue;

    itemBindings.push({
      elementId: id,
      type: 'attr',
      property: attrName,
      expression: expression,
    });

    itemAttrMatches.push({ start: matchStart, end: matchEnd, attrName, expr: expression, id });
  }
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  for (const cond of conditionals) {
    const replacement = cond.initialValue ? cond.templateContent : `<template id="${cond.id}"></template>`;
    edits.push({ start: cond.startIndex, end: cond.endIndex, replacement });
  }
  for (const we of whenElseBlocks) {
    const thenReplacement = we.initialValue ? injectIdIntoFirstElement(we.thenTemplate, we.thenId) : `<template id="${we.thenId}"></template>`;
    const elseReplacement = we.initialValue ? `<template id="${we.elseId}"></template>` : injectIdIntoFirstElement(we.elseTemplate, we.elseId);
    edits.push({ start: we.startIndex, end: we.endIndex, replacement: thenReplacement + elseReplacement });
  }
  for (const rep of repeatBlocks) {
    edits.push({ start: rep.startIndex, end: rep.endIndex, replacement: `<template id="${rep.id}"></template>` });
  }
  for (const [exprPos, spanId] of textBindingSpans) {
    const exprMatch = /\$\{this\.(\w+)\(\)\}/.exec(templateContent.substring(exprPos));
    if (exprMatch && exprMatch.index === 0 && exprMatch[1]) {
      const signalName = exprMatch[1];
      const value = signalInitializers.get(signalName);
      const valueStr = value !== undefined ? String(value) : '';
      edits.push({
        start: exprPos,
        end: exprPos + exprMatch[0].length,
        replacement: `<span id="${spanId}">${valueStr}</span>`,
      });
    }
  }
  
  // Track which parent elements need IDs for sole-content text bindings
  const parentElementIds = new Map<number, string>(); // tagStart -> id
  
  for (const textMatch of itemTextMatches) {
    const { start, end, expr, id, isSoleContent, parentTagStart, parentTagNameEnd: _parentTagNameEnd } = textMatch;
    const transformedExpr = expr.replace(new RegExp(`\\b${itemVar}\\b`, 'g'), `${itemVar}$()`);
    
    if (isSoleContent && parentTagStart >= 0) {
      // For sole content: just output the expression (no wrapper)
      // The parent element will get the ID
      edits.push({
        start,
        end,
        replacement: `\${${transformedExpr}}`,
      });
      
      // Track that we need to add ID to parent element
      if (!parentElementIds.has(parentTagStart)) {
        parentElementIds.set(parentTagStart, id);
      }
    } else {
      // For mixed content: use comment marker approach
      // Insert <!--id--> before the expression, the runtime will find the next text node
      edits.push({
        start,
        end,
        replacement: `<!--${id}-->\${${transformedExpr}}`,
      });
    }
  }
  
  // Add IDs to parent elements for sole-content text bindings
  for (const [tagStart, id] of parentElementIds) {
    // Find the end of the tag name to inject the ID attribute
    let tagNameEnd = tagStart + 1;
    while (tagNameEnd < templateContent.length && /[\w-]/.test(templateContent[tagNameEnd]!)) {
      tagNameEnd++;
    }
    
    // Check if element already has an id attribute
    const openTagEnd = templateContent.indexOf('>', tagStart);
    const tagContent = templateContent.substring(tagStart, openTagEnd + 1);
    const hasExistingId = /\sid=["']/.test(tagContent);
    
    if (!hasExistingId) {
      edits.push({
        start: tagNameEnd,
        end: tagNameEnd,
        replacement: ` id="${id}"`,
      });
    } else {
      // Element already has ID - use data-bind-id instead
      edits.push({
        start: tagNameEnd,
        end: tagNameEnd,
        replacement: ` data-bind-id="${id}"`,
      });
    }
  }
  const elementIdByTagStart = new Map<number, string>();
  
  for (const itemAttr of itemAttrMatches) {
    let tagStart = itemAttr.start;
    while (tagStart > 0 && templateContent[tagStart] !== '<') {
      tagStart--;
    }
    if (!elementIdByTagStart.has(tagStart)) {
      elementIdByTagStart.set(tagStart, itemAttr.id);
    }
  }
  const injectedElementIds = new Set<number>();
  
  for (const { start, end, attrName, expr, id } of itemAttrMatches) {
    let tagStart = start;
    while (tagStart > 0 && templateContent[tagStart] !== '<') {
      tagStart--;
    }
    const elementId = elementIdByTagStart.get(tagStart) || id;
    let transformedExpr = expr.replace(new RegExp(`\\b${itemVar}\\b`, 'g'), `${itemVar}$()`);
    if (indexVar) {
      transformedExpr = transformedExpr.replace(new RegExp(`\\b${indexVar}\\b`, 'g'), indexVar);
    }
    const needsDataBindId = !injectedElementIds.has(tagStart);
    if (needsDataBindId) {
      injectedElementIds.add(tagStart);
    }
    const binding = itemBindings.find(b => b.elementId === id);
    if (binding) {
      binding.elementId = elementId;
    }
    
    edits.push({
      start,
      end,
      replacement: needsDataBindId 
        ? `data-bind-id="${elementId}" ${attrName}="\${${transformedExpr}}"`
        : `${attrName}="\${${transformedExpr}}"`,
    });
  }
  for (const [element, id] of elementIdMap) {
    const insideRange = allRanges.some((r) => element.tagStart >= r.start && element.tagStart < r.end);
    if (insideRange) continue;
    if (element.attributes.has('id')) continue;
    const evtAttrs: string[] = [];
    for (const evt of eventBindings) {
      if (evt.elementId === id) {
        const attrValue = evt.modifiers.length > 0 ? `${evt.id}:${evt.modifiers.join(':')}` : evt.id;
        evtAttrs.push(`data-evt-${evt.eventName}="${attrValue}"`);
      }
    }
    for (const evt of itemEvents) {
      const attrValue = evt.modifiers.length > 0 ? `${evt.eventId}:${evt.modifiers.join(':')}` : evt.eventId;
      evtAttrs.push(`data-evt-${evt.eventName}="${attrValue}"`);
    }

    const attrsToAdd = [`id="${id}"`, ...evtAttrs].join(' ');
    edits.push({ start: element.tagNameEnd, end: element.tagNameEnd, replacement: ' ' + attrsToAdd });
  }
  for (const binding of parsed.bindings) {
    if (binding.type === 'event') {
      const alreadyEdited = edits.some((e) => e.start <= binding.expressionStart && e.end >= binding.expressionEnd);
      if (!alreadyEdited) {
        edits.push({ start: binding.expressionStart, end: binding.expressionEnd, replacement: '' });
      }
    }
  }
  edits.sort((a, b) => b.start - a.start);

  let result = templateContent;
  for (const edit of edits) {
    result = result.substring(0, edit.start) + edit.replacement + result.substring(edit.end);
  }
  result = result.replace(/\s+/g, ' ').trim();

  return {
    processedContent: result,
    itemBindings,
    itemEvents,
    signalBindings,
    eventBindings,
    nestedConditionals: conditionals,
    nestedWhenElse: whenElseBlocks,
    nestedRepeats: repeatBlocks,
    nextId: idCounter,
  };
};

// Need to import injectIdIntoFirstElement
import { injectIdIntoFirstElement } from '../../utils/html-parser.js';

/**
 * Process an item template (wrapper around processItemTemplateRecursively)
 */
export const processItemTemplate = (
  templateContent: string,
  itemVar: string,
  indexVar: string | undefined,
  startingId: number,
  signalInitializers: Map<string, string | number | boolean> = new Map(),
): {
  processedContent: string;
  bindings: ItemBinding[];
  events: ItemEventBinding[];
  signalBindings: BindingInfo[];
  eventBindings: EventBinding[];
  nestedConditionals: ConditionalBlock[];
  nestedWhenElse: WhenElseBlock[];
  nestedRepeats: RepeatBlock[];
  nextId: number;
} => {
  const result = processItemTemplateRecursively(templateContent, itemVar, indexVar, signalInitializers, startingId);
  return {
    processedContent: result.processedContent,
    bindings: result.itemBindings,
    events: result.itemEvents,
    signalBindings: result.signalBindings,
    eventBindings: result.eventBindings,
    nestedConditionals: result.nestedConditionals,
    nestedWhenElse: result.nestedWhenElse,
    nestedRepeats: result.nestedRepeats,
    nextId: result.nextId,
  };
};
