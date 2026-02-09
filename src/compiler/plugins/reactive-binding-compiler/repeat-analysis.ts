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
  processSubTemplateWithNesting,
} from './template-processing.js';
import {
  parseHtmlTemplate,
  walkElements,
  findElementsWithWhenDirective,
  injectIdIntoFirstElement,
  type HtmlElement,
} from '../../utils/html-parser/index.js';
import {
  renameIdentifierInExpression,
  expressionReferencesIdentifier,
} from '../../utils/index.js';
import {
  collectConditionalBlocks,
  collectWhenElseBlocks,
  buildConditionalEdits,
  buildWhenElseEdits,
  buildElementIdEdits,
  applyTemplateEdits,
  type IdState,
  type TemplateEdit,
} from './template-utils.js';

/**
 * Get a human-readable explanation for why optimization was skipped
 */
export const getOptimizationSkipMessage = (reason: RepeatOptimizationSkipReason): string => {
  switch (reason) {
    case 'no-bindings':
      return 'no item bindings found';
    case 'signal-bindings':
      return 'contains component signal bindings inside items - move to data model';
    case 'nested-repeat':
      return 'contains nested repeat() - not yet supported for optimization';
    case 'nested-conditional':
      return 'contains when()/whenElse() inside items - not yet supported for optimization';
    case 'item-events':
      return 'contains @event handlers inside items - use event delegation on container instead';
    case 'mixed-bindings':
      return 'item bindings reference component signals - use pure item data instead';
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
  _itemVar: string,
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
  
  // Strip ALL remaining ${...} template expressions from the static HTML.
  // By this point, component-level signal bindings have already been replaced
  // with <span id="...">value</span> elements, and event bindings have been
  // extracted. The only ${...} expressions left are item-variable bindings,
  // which are handled at runtime via the element binding paths — so they must
  // all be removed from the static template.
  staticHtml = staticHtml.replace(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, '');
  
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
  const repeatBlocks: RepeatBlock[] = [];

  const elementIdMap = new Map<HtmlElement, string>();
  const state: IdState = { idCounter: startingId, eventIdCounter: { value: 0 }, elementIdMap };
  let itemEventIdCounter = 0;

  const conditionalElements = findElementsWithWhenDirective(parsed.roots);
  const conditionalElementSet = new Set(conditionalElements);
  const elementsInsideConditionals = new Set<HtmlElement>();
  for (const condEl of conditionalElements) {
    walkElements([condEl], (el) => {
      if (el !== condEl) elementsInsideConditionals.add(el);
    });
  }

  // ── Conditionals (with item binding transformation) ──
  const condResult = collectConditionalBlocks(parsed, templateContent, signalInitializers, state, {
    onConditionalHtml: (html) => {
      // Find ${...} expressions that reference the item variable using AST check
      const exprPattern = /\$\{((?:[^{}]|\{[^}]*\})*)\}/g;
      const condItemBindings: ItemBinding[] = [];
      let transformedHtml = html;
      const matches = [...html.matchAll(exprPattern)].filter(
        m => m[1] !== undefined && expressionReferencesIdentifier(m[1].trim(), itemVar)
      );
      if (matches.length > 0) {
        let offset = 0;
        for (const match of matches) {
          const innerExpr = match[1]!.trim();
          const matchStart = match.index! + offset;
          const matchEnd = matchStart + match[0].length;
          const itemBindingId = `i${state.idCounter++}`;
          const transformedExpr = renameIdentifierInExpression(innerExpr, itemVar, `${itemVar}$()`);
          const replacement = `<span id="${itemBindingId}">\${${transformedExpr}}</span>`;
          transformedHtml = transformedHtml.substring(0, matchStart) + replacement + transformedHtml.substring(matchEnd);
          condItemBindings.push({ elementId: itemBindingId, expression: innerExpr, type: 'text' });
          offset += replacement.length - match[0].length;
        }
      }
      return { html: transformedHtml, extraData: condItemBindings };
    },
  });
  const conditionals = condResult.conditionals;
  signalBindings.push(...condResult.bindings);
  eventBindings.push(...condResult.eventBindings);

  // ── WhenElse ──
  const whenElseBlocks = collectWhenElseBlocks(parsed, signalInitializers, state, (template, id) =>
    processSubTemplateWithNesting(template, signalInitializers, state.idCounter, id),
  );

  // ── Nested repeats ──
  for (const binding of parsed.bindings) {
    if (binding.type !== 'repeat') continue;
    if (!binding.itemsExpression || !binding.itemVar || !binding.itemTemplate) continue;

    const nestedSignalNames = binding.signalNames || [binding.signalName];
    const nestedRepeatId = `b${state.idCounter++}`;
    const nestedProcessed = processItemTemplateRecursively(binding.itemTemplate, binding.itemVar, binding.indexVar, signalInitializers, state.idCounter);
    state.idCounter = nestedProcessed.nextId;
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
      const refsItem = expressionReferencesIdentifier(binding.handlerExpression, itemVar);
      const refsIndex = indexVar ? expressionReferencesIdentifier(binding.handlerExpression, indexVar) : false;

      if (refsItem || refsIndex) {
        const eventId = `ie${itemEventIdCounter++}`;
        if (!elementIdMap.has(binding.element)) {
          elementIdMap.set(binding.element, `b${state.idCounter++}`);
        }
        itemEvents.push({
          eventId,
          eventName: binding.eventName,
          modifiers: binding.eventModifiers || [],
          handlerExpression: binding.handlerExpression,
        });
      } else {
        const eventId = `e${state.eventIdCounter.value++}`;
        if (!elementIdMap.has(binding.element)) {
          elementIdMap.set(binding.element, `b${state.idCounter++}`);
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
      const spanId = `b${state.idCounter++}`;

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
  // Find ${...} expressions that reference the item variable (text bindings)
  // Use a regex to find all ${...} in the template, then AST to check if they reference itemVar
  const allExprRegex = /\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
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

  while ((match = allExprRegex.exec(templateContent)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const insideRange = allRanges.some((r) => matchStart >= r.start && matchStart < r.end);
    if (insideRange) continue;
    const innerExpr = match[1]?.trim() ?? '';
    if (!expressionReferencesIdentifier(innerExpr, itemVar)) continue;

    // Check if we're inside an attribute — use parser element positions instead of regex
    const isInAttr = parsed.bindings.some(
      (b) => b.type === 'event' && b.expressionStart <= matchStart && b.expressionEnd >= matchEnd
    ) || (() => {
      // Check if this position falls inside any element's attribute value
      let inAttr = false;
      walkElements(parsed.roots, (el) => {
        for (const [, attr] of el.attributes) {
          if (matchStart >= attr.valueStart && matchEnd <= attr.end) {
            inAttr = true;
          }
        }
      });
      return inAttr;
    })();

    if (!isInAttr) {
      const expression = innerExpr;
      
      // Analyze if this binding is the sole content of its parent element
      const context = analyzeTextBindingContext(templateContent, matchStart, matchEnd);
      
      const id = `i${state.idCounter++}`;
      
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
  // Find attribute bindings that reference item/index variables using the parsed HTML tree
  const itemAttrMatches: Array<{ start: number; end: number; attrName: string; expr: string; id: string }> = [];

  walkElements(parsed.roots, (el) => {
    if (elementsInsideConditionals.has(el) || conditionalElementSet.has(el)) return;
    const insideRange = allRanges.some((r) => el.tagStart >= r.start && el.tagStart < r.end);
    if (insideRange) return;

    for (const [attrName, attr] of el.attributes) {
      if (attrName.startsWith('@')) continue; // Skip event attrs
      // Check for ${expr} in attribute values that reference item/index vars
      const attrExprRegex = /\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrExprRegex.exec(attr.value)) !== null) {
        const innerExpr = attrMatch[1]?.trim() ?? '';
        const refsItem = expressionReferencesIdentifier(innerExpr, itemVar);
        const refsIndex = indexVar ? expressionReferencesIdentifier(innerExpr, indexVar) : false;
        if (!refsItem && !refsIndex) continue;

        const id = `i${state.idCounter++}`;

        itemBindings.push({
          elementId: id,
          type: 'attr',
          property: attrName,
          expression: innerExpr,
        });

        itemAttrMatches.push({
          start: attr.start,
          end: attr.end,
          attrName,
          expr: innerExpr,
          id,
        });
      }
    }
  });

  const edits: TemplateEdit[] = [
    ...buildConditionalEdits(conditionals),
    ...buildWhenElseEdits(whenElseBlocks, true, injectIdIntoFirstElement),
  ];
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
    const transformedExpr = renameIdentifierInExpression(expr, itemVar, `${itemVar}$()`);
    
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
    let transformedExpr = renameIdentifierInExpression(expr, itemVar, `${itemVar}$()`);
    if (indexVar) {
      transformedExpr = renameIdentifierInExpression(transformedExpr, indexVar, indexVar);
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
  edits.push(...buildElementIdEdits(elementIdMap, allRanges, { eventBindings, itemEvents }));
  for (const binding of parsed.bindings) {
    if (binding.type === 'event') {
      const alreadyEdited = edits.some((e) => e.start <= binding.expressionStart && e.end >= binding.expressionEnd);
      if (!alreadyEdited) {
        edits.push({ start: binding.expressionStart, end: binding.expressionEnd, replacement: '' });
      }
    }
  }
  return {
    processedContent: applyTemplateEdits(templateContent, edits),
    itemBindings,
    itemEvents,
    signalBindings,
    eventBindings,
    nestedConditionals: conditionals,
    nestedWhenElse: whenElseBlocks,
    nestedRepeats: repeatBlocks,
    nextId: state.idCounter,
  };
};

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
