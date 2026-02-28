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
  EventBinding,
  StaticTemplateInfo,
  RepeatOptimizationSkipReason,
  SimpleBinding,
} from './types.js';
import { isSimpleBinding } from './types.js';
import { REPEAT_OPTIMIZATION_SKIP_REASON } from '../../../contracts/index.js';
import { processSubTemplateWithNesting } from './template-processing.js';
import {
  parseHtmlTemplate,
  walkElements,
  findElementsWithWhenDirective,
  injectIdIntoFirstElement,
  type HtmlElement,
} from '../../utils/html-parser/index.js';
import { renameIdentifierInExpression, expressionReferencesIdentifier } from '../../utils/index.js';
import {
  collectConditionalBlocks,
  collectWhenElseBlocks,
  buildConditionalEdits,
  buildWhenElseEdits,
  buildElementIdEdits,
  applyTemplateEdits,
  type IdState,
  type TemplateEdit,
  type Range,
} from './template-utils.js';

/**
 * Get a human-readable explanation for why optimization was skipped
 */
export const getOptimizationSkipMessage = (reason: RepeatOptimizationSkipReason): string => {
  switch (reason) {
    case REPEAT_OPTIMIZATION_SKIP_REASON.NO_BINDINGS:
      return 'no item bindings found';
    case REPEAT_OPTIMIZATION_SKIP_REASON.SIGNAL_BINDINGS:
      return 'contains component signal bindings inside items - move to data model';
    case REPEAT_OPTIMIZATION_SKIP_REASON.NESTED_REPEAT:
      return 'contains nested repeat() - not yet supported for optimization';
    case REPEAT_OPTIMIZATION_SKIP_REASON.NESTED_CONDITIONAL:
      return 'contains when()/whenElse() inside items - not yet supported for optimization';
    case REPEAT_OPTIMIZATION_SKIP_REASON.MIXED_BINDINGS:
      return 'item bindings reference component signals - use pure item data instead';
    case REPEAT_OPTIMIZATION_SKIP_REASON.MULTI_ROOT:
      return 'template has multiple root elements - wrap in a single container element';
    case REPEAT_OPTIMIZATION_SKIP_REASON.PATH_NOT_FOUND:
      return 'element navigation path could not be computed';
    default: {
      const exhaustive: never = reason;
      throw new Error(`Unhandled repeat optimization reason: ${String(exhaustive)}`);
    }
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
  itemEvents?: ItemEventBinding[],
  signalBindings?: SimpleBinding[],
  directiveAnchorIds?: string[],
): StaticTemplateInfo => {
  // Parse the template to get element structure
  const parsed = parseHtmlTemplate(itemTemplate);

  if (parsed.roots.length !== 1) {
    // Multiple root elements - cannot use optimized path
    return {
      staticHtml: '',
      elementBindings: [],
      canUseOptimized: false,
      skipReason: REPEAT_OPTIMIZATION_SKIP_REASON.MULTI_ROOT,
    };
  }

  const rootEl = parsed.roots[0]!;

  // Build a map of element ID to bindings (only element-navigable bindings)
  // Comment-marker bindings (textBindingMode === 'commentMarker') are handled
  // separately via TreeWalker and are not included here.
  // Mixed signal+item bindings (outerSignalNames set) are handled via the
  // dedicated mixedSignalItemBindings path and excluded from regular element bindings.
  const bindingsByElement = new Map<string, ItemBinding[]>();
  const mixedItemBindings: ItemBinding[] = [];
  for (const binding of itemBindings) {
    if (binding.textBindingMode === 'commentMarker') continue; // handled via TreeWalker
    if (binding.outerSignalNames && binding.outerSignalNames.length > 0) {
      mixedItemBindings.push(binding); // handled via per-item signal subscription
      continue;
    }
    if (!bindingsByElement.has(binding.elementId)) {
      bindingsByElement.set(binding.elementId, []);
    }
    bindingsByElement.get(binding.elementId)!.push(binding);
  }

  // Compute path for each element with bindings
  const elementPaths = new Map<string, number[]>();

  const findElementPath = (el: HtmlElement, targetId: string, currentPath: number[]): number[] | null => {
    // Check if this element has the target ID
    const elId = el.attributes.get('id')?.value;
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
    const rootId = rootEl.attributes.get('id')?.value;
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
      return {
        staticHtml: '',
        elementBindings: [],
        canUseOptimized: false,
        skipReason: REPEAT_OPTIMIZATION_SKIP_REASON.PATH_NOT_FOUND,
      };
    }
  }

  // Generate static HTML by removing dynamic expressions
  let staticHtml = itemTemplate;

  // Strip ALL remaining ${...} template expressions from the static HTML.
  // By this point, component-level signal bindings have already been replaced
  // with <!--bN-->value comment markers, and event bindings have been
  // extracted. The only ${...} expressions left are item-variable bindings,
  // which are handled at runtime via the element binding paths — so they must
  // all be removed from the static template.
  staticHtml = staticHtml.replace(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, '');

  // Remove inline id attributes that were only added for bindings
  // These follow the pattern id="i0", id="i1", id="b0", id="b1", etc.
  staticHtml = staticHtml.replace(/\s*id="[ib]\d+"/g, '');

  // Aggressively strip whitespace BEFORE inserting comment marker placeholders.
  // - Collapse runs to single space
  // - Remove all inter-element whitespace (><)
  // - Strip trailing whitespace before > in opening tags (<a > → <a>)
  // Sole-content elements become empty (<td></td>) — textContent handles this at runtime.
  staticHtml = staticHtml.replace(/\s+/g, ' ').replace(/>\s+</g, '><').replace(/\s+>/g, '>').trim();

  // Insert comment marker placeholders AFTER stripping (so they survive intact).
  // Mixed-content text bindings need: <!--iN--> + text node + <!----> boundary
  // for commentNode.nextSibling.data to work at runtime.
  staticHtml = staticHtml.replace(/(<!--[ib]\d+-->)/g, '$1 <!---->');

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
      bindings: bindings.map((b) => ({
        type: b.type as 'text' | 'attr',
        property: b.property,
        expression: b.expression,
      })),
    });
  }

  // Compute event element paths (if any)
  let eventElementPaths: Map<string, number[]> | undefined;
  if (itemEvents && itemEvents.length > 0) {
    eventElementPaths = new Map();
    for (const evt of itemEvents) {
      if (eventElementPaths.has(evt.elementId)) continue; // Already computed
      const rootId = rootEl.attributes.get('id')?.value;
      if (rootId === evt.elementId) {
        eventElementPaths.set(evt.elementId, []);
      } else {
        const path = findElementPath(rootEl, evt.elementId, []);
        if (path) {
          eventElementPaths.set(evt.elementId, path);
        }
      }
    }
  }

  // Compute paths for signal binding elements (Step 13)
  let signalElementBindings: StaticTemplateInfo['signalElementBindings'];
  let signalCommentBindings: StaticTemplateInfo['signalCommentBindings'];
  if (signalBindings && signalBindings.length > 0) {
    signalElementBindings = [];
    signalCommentBindings = [];
    for (const sb of signalBindings) {
      if (sb.isInsideConditional) continue; // Handled in Step 14
      // Signal text bindings use comment-marker IDs (<!--bN-->) which cannot
      // be found by element path navigation. Route them to signalCommentBindings.
      if (sb.type === 'text') {
        signalCommentBindings.push({
          commentId: sb.id,
          signalName: sb.signalName,
        });
        continue;
      }
      const rootId = rootEl.attributes.get('id')?.value;
      let path: number[] | null = null;
      if (rootId === sb.id) {
        path = [];
      } else {
        path = findElementPath(rootEl, sb.id, []);
      }
      if (path) {
        signalElementBindings.push({
          path,
          signalName: sb.signalName,
          type: sb.type,
          property: sb.property,
        });
      }
    }
  }

  // Compute paths for directive anchors: conditional/repeat anchors (Step 14/15)
  let directiveAnchorPaths: Map<string, number[]> | undefined;
  if (directiveAnchorIds && directiveAnchorIds.length > 0) {
    directiveAnchorPaths = new Map();
    for (const anchorId of directiveAnchorIds) {
      const rootId = rootEl.attributes.get('id')?.value;
      if (rootId === anchorId) {
        directiveAnchorPaths.set(anchorId, []);
      } else {
        const path = findElementPath(rootEl, anchorId, []);
        if (path) {
          directiveAnchorPaths.set(anchorId, path);
        }
      }
    }
  }

  // Compute paths for mixed signal+item bindings (Step 13c)
  let mixedSignalItemBindings: StaticTemplateInfo['mixedSignalItemBindings'];
  if (mixedItemBindings.length > 0) {
    mixedSignalItemBindings = [];
    for (const mb of mixedItemBindings) {
      // Mixed bindings don't have IDs injected into the HTML (they were excluded
      // from elementIdMap). Use path-by-position: find the element that owns this
      // binding. For root-level attributes (e.g., class on <tr>), the root element
      // itself is the target — path [].
      // Since the element wasn't assigned an ID, we navigate by position using the
      // element index assigned during collectItemAttrBindings. For the common case
      // (attribute on root element), path is [].
      const rootId = rootEl.attributes.get('id')?.value;
      let path: number[] | null = null;
      if (rootId === mb.elementId) {
        path = [];
      } else {
        path = findElementPath(rootEl, mb.elementId, []);
      }
      // If no ID-based path found, try to find the element by checking if it's
      // the root (mixed attr bindings on root won't have an injected ID)
      if (path === null && !rootId) {
        // No ID on root — this mixed binding is likely targeting the root element.
        // Check if any other element has this ID; if not, assume root.
        let foundElsewhere = false;
        const searchNonRoot = (el: HtmlElement, p: number[]) => {
          for (let i = 0; i < el.children.length; i++) {
            const child = el.children[i]!;
            if (child.attributes.get('id')?.value === mb.elementId) {
              foundElsewhere = true;
              path = [...p, i];
              return;
            }
            searchNonRoot(child, [...p, i]);
          }
        };
        searchNonRoot(rootEl, []);
        if (!foundElsewhere) {
          // The binding targets the root element — path is []
          path = [];
        }
      }
      if (path !== null) {
        mixedSignalItemBindings.push({
          path,
          outerSignalNames: mb.outerSignalNames!,
          type: mb.type,
          property: mb.property,
          expression: mb.expression,
        });
      }
    }
  }

  return {
    staticHtml,
    elementBindings: elementBindingsArray,
    eventElementPaths,
    ...(signalElementBindings ? { signalElementBindings } : {}),
    ...(signalCommentBindings && signalCommentBindings.length > 0 ? { signalCommentBindings } : {}),
    ...(directiveAnchorPaths ? { directiveAnchorPaths } : {}),
    ...(mixedSignalItemBindings && mixedSignalItemBindings.length > 0 ? { mixedSignalItemBindings } : {}),
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
  // Skip over ${...} expressions to avoid confusion with > inside handlers
  while (i >= 0) {
    // Skip backwards over ${...} expressions
    if (templateContent[i] === '}') {
      let depth = 1;
      i--;
      while (i >= 0 && depth > 0) {
        if (templateContent[i] === '}') depth++;
        else if (templateContent[i] === '{') {
          depth--;
          if (depth === 0 && i > 0 && templateContent[i - 1] === '$') {
            i--; // skip the '$'
          }
        }
        i--;
      }
      continue;
    }
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
  // Must skip > inside ${...} expressions within attributes
  let parentOpenTagEnd = parentTagStart;
  {
    let inExpr = 0;
    while (parentOpenTagEnd < templateContent.length) {
      const ch = templateContent[parentOpenTagEnd];
      if (ch === '$' && templateContent[parentOpenTagEnd + 1] === '{') {
        inExpr++;
        parentOpenTagEnd += 2;
        continue;
      }
      if (ch === '{' && inExpr > 0) {
        inExpr++;
      }
      if (ch === '}' && inExpr > 0) {
        inExpr--;
      }
      if (ch === '>' && inExpr === 0) {
        parentOpenTagEnd++;
        break;
      }
      parentOpenTagEnd++;
    }
  }
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

// ============================================================================
// Item binding extraction helpers (used by processItemTemplateRecursively)
// ============================================================================

interface ItemTextMatch {
  start: number;
  end: number;
  expr: string;
  id: string;
  isSoleContent: boolean;
  parentTagStart: number;
  parentTagNameEnd: number;
}

interface ItemAttrMatch {
  start: number;
  end: number;
  attrName: string;
  expr: string;
  id: string;
}

/**
 * Classify parsed bindings into item events, component events, signal bindings,
 * and text-binding spans. Mutates the provided output arrays and maps.
 */
const classifyParsedBindings = (
  parsed: ReturnType<typeof parseHtmlTemplate>,
  itemVar: string,
  indexVar: string | undefined,
  allRanges: Range[],
  conditionalElementSet: Set<HtmlElement>,
  elementsInsideConditionals: Set<HtmlElement>,
  state: IdState,
  itemEvents: ItemEventBinding[],
  signalBindings: SimpleBinding[],
  eventBindings: EventBinding[],
  elementIdMap: Map<HtmlElement, string>,
  textBindingSpans: Map<number, { spanId: string; exprEnd: number; signalName: string }>,
): { itemEventIdCounter: number } => {
  let itemEventIdCounter = 0;

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
        const eventElementId = elementIdMap.get(binding.element)!;
        itemEvents.push({
          eventId,
          elementId: eventElementId,
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
      // Check if the full expression also references the item variable.
      // If so, this is a "mixed" binding (outer signal + item data) — skip
      // classifying as a signal binding; collectItemAttrBindings will handle it.
      const fullExpr = (binding as any).jsExpression || (binding as any).fullExpression || '';
      const isMixed = fullExpr &&
        (expressionReferencesIdentifier(fullExpr, itemVar) ||
         (indexVar ? expressionReferencesIdentifier(fullExpr, indexVar) : false));
      if (isMixed) continue;

      const spanId = `b${state.idCounter++}`;

      if (binding.type === 'text') {
        textBindingSpans.set(binding.expressionStart, {
          spanId,
          exprEnd: binding.expressionEnd,
          signalName: binding.signalName,
        });
      } else {
        if (!elementIdMap.has(binding.element)) {
          elementIdMap.set(binding.element, spanId);
        }
      }

      const bindingId =
        binding.type === 'text'
          ? textBindingSpans.get(binding.expressionStart)!.spanId
          : elementIdMap.get(binding.element)!;
      signalBindings.push({
        id: bindingId,
        signalName: binding.signalName,
        type: binding.type,
        ...(binding.property ? { property: binding.property } : {}),
        isInsideConditional: false,
      });
    }
  }

  return { itemEventIdCounter };
};

/**
 * Collect ${...} expressions that reference the item variable as text bindings.
 * Returns matches with context analysis for sole-content optimization.
 */
const collectItemTextBindings = (
  templateContent: string,
  itemVar: string,
  indexVar: string | undefined,
  allRanges: Range[],
  parsed: ReturnType<typeof parseHtmlTemplate>,
  state: IdState,
  itemBindings: ItemBinding[],
): ItemTextMatch[] => {
  const allExprRegex = /\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  const itemTextMatches: ItemTextMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = allExprRegex.exec(templateContent)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const insideRange = allRanges.some((r) => matchStart >= r.start && matchStart < r.end);
    if (insideRange) continue;
    const innerExpr = match[1]?.trim() ?? '';
    const refsItem = expressionReferencesIdentifier(innerExpr, itemVar);
    const refsIndex = indexVar ? expressionReferencesIdentifier(innerExpr, indexVar) : false;
    if (!refsItem && !refsIndex) continue;

    // Check if we're inside an attribute — use parser element positions instead of regex
    const isInAttr =
      parsed.bindings.some(
        (b) => b.type === 'event' && b.expressionStart <= matchStart && b.expressionEnd >= matchEnd,
      ) ||
      (() => {
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

      // Detect outer signal references in the expression (mixed binding)
      const signalCallRegex = /(?<!\.)(\w+)\(\)/g;
      const outerSignals: string[] = [];
      let sigMatch: RegExpExecArray | null;
      while ((sigMatch = signalCallRegex.exec(innerExpr)) !== null) {
        const name = sigMatch[1]!;
        if (name !== itemVar && name !== `${itemVar}$` && (!indexVar || name !== indexVar)) {
          if (!outerSignals.includes(name)) outerSignals.push(name);
        }
      }

      itemBindings.push({
        elementId: id,
        type: 'text',
        expression: expression,
        // sole-content → textContent on parent; mixed-content → comment marker
        textBindingMode: context.isSoleContent ? 'textContent' : 'commentMarker',
        ...(outerSignals.length > 0 ? { outerSignalNames: outerSignals } : {}),
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

  return itemTextMatches;
};

/**
 * Collect attribute bindings that reference item/index variables from the parsed HTML tree.
 */
const collectItemAttrBindings = (
  parsed: ReturnType<typeof parseHtmlTemplate>,
  itemVar: string,
  indexVar: string | undefined,
  allRanges: Range[],
  conditionalElementSet: Set<HtmlElement>,
  elementsInsideConditionals: Set<HtmlElement>,
  state: IdState,
  itemBindings: ItemBinding[],
): ItemAttrMatch[] => {
  const itemAttrMatches: ItemAttrMatch[] = [];

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

        // Detect outer signal references in the expression (mixed binding)
        const signalCallRegex = /(?<!\.)\b(\w+)\(\)/g;
        const outerSignals: string[] = [];
        let sigMatch: RegExpExecArray | null;
        while ((sigMatch = signalCallRegex.exec(innerExpr)) !== null) {
          const name = sigMatch[1]!;
          if (name !== itemVar && name !== `${itemVar}$` && (!indexVar || name !== indexVar)) {
            if (!outerSignals.includes(name)) outerSignals.push(name);
          }
        }

        itemBindings.push({
          elementId: id,
          type: 'attr',
          property: attrName,
          expression: innerExpr,
          ...(outerSignals.length > 0 ? { outerSignalNames: outerSignals } : {}),
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

  return itemAttrMatches;
};

// ============================================================================
// Main processing
// ============================================================================

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
  signalBindings: SimpleBinding[];
  eventBindings: EventBinding[];
  nestedConditionals: ConditionalBlock[];
  nestedWhenElse: WhenElseBlock[];
  nestedRepeats: RepeatBlock[];
  nextId: number;
} => {
  const parsed = parseHtmlTemplate(templateContent);

  const itemBindings: ItemBinding[] = [];
  const itemEvents: ItemEventBinding[] = [];
  const signalBindings: SimpleBinding[] = [];
  const eventBindings: EventBinding[] = [];
  const repeatBlocks: RepeatBlock[] = [];

  const elementIdMap = new Map<HtmlElement, string>();
  const state: IdState = { idCounter: startingId, eventIdCounter: { value: 0 }, elementIdMap };

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
        (m) => m[1] !== undefined && expressionReferencesIdentifier(m[1].trim(), itemVar),
      );
      if (matches.length > 0) {
        let offset = 0;
        for (const match of matches) {
          const innerExpr = match[1]!.trim();
          const matchStart = match.index! + offset;
          const matchEnd = matchStart + match[0].length;
          const itemBindingId = `i${state.idCounter++}`;
          const transformedExpr = renameIdentifierInExpression(innerExpr, itemVar, `${itemVar}$()`);
          // Use comment marker instead of span wrapper
          const replacement = `<!--${itemBindingId}-->\${${transformedExpr}}`;
          transformedHtml =
            transformedHtml.substring(0, matchStart) + replacement + transformedHtml.substring(matchEnd);
          condItemBindings.push({
            elementId: itemBindingId,
            expression: innerExpr,
            type: 'text',
            textBindingMode: 'commentMarker',
          });
          offset += replacement.length - match[0].length;
        }
      }
      return { html: transformedHtml, extraData: condItemBindings };
    },
  });
  const conditionals = condResult.conditionals;
  signalBindings.push(...condResult.bindings.filter(isSimpleBinding));
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
    const nestedProcessed = processItemTemplateRecursively(
      binding.itemTemplate,
      binding.itemVar,
      binding.indexVar,
      signalInitializers,
      state.idCounter,
    );
    state.idCounter = nestedProcessed.nextId;
    let processedEmptyTemplate: string | undefined;
    if (binding.emptyTemplate) {
      processedEmptyTemplate = binding.emptyTemplate
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .replace(/\s+>/g, '>')
        .trim();
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
  const textBindingSpans = new Map<number, { spanId: string; exprEnd: number; signalName: string }>();
  classifyParsedBindings(
    parsed,
    itemVar,
    indexVar,
    allRanges,
    conditionalElementSet,
    elementsInsideConditionals,
    state,
    itemEvents,
    signalBindings,
    eventBindings,
    elementIdMap,
    textBindingSpans,
  );
  // Find ${...} expressions that reference the item variable (text bindings)
  const itemTextMatches = collectItemTextBindings(
    templateContent,
    itemVar,
    indexVar,
    allRanges,
    parsed,
    state,
    itemBindings,
  );
  // Find attribute bindings that reference item/index variables using the parsed HTML tree
  const itemAttrMatches = collectItemAttrBindings(
    parsed,
    itemVar,
    indexVar,
    allRanges,
    conditionalElementSet,
    elementsInsideConditionals,
    state,
    itemBindings,
  );

  const edits: TemplateEdit[] = [
    ...buildConditionalEdits(conditionals),
    ...buildWhenElseEdits(whenElseBlocks, true, injectIdIntoFirstElement),
  ];
  for (const rep of repeatBlocks) {
    edits.push({ start: rep.startIndex, end: rep.endIndex, replacement: `<template id="${rep.id}"></template>` });
  }
  // Inject comment markers for signal text bindings (AST-driven, no regex)
  for (const [exprPos, { spanId, exprEnd }] of textBindingSpans) {
    // Use a comment marker <!--id--> followed by the live expression so the
    // fallback renderer can still evaluate the template literal while the
    // optimized path locates the adjacent text node via the comment.
    edits.push({
      start: exprPos,
      end: exprEnd,
      replacement: `<!--${spanId}-->\${${templateContent.substring(exprPos + 2, exprEnd - 1)}}`,
    });
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
      // For mixed content: inject a comment marker so the optimized path can
      // locate the adjacent text node without a wrapper element.
      edits.push({
        start,
        end,
        replacement: `<!--${id}-->\${${transformedExpr}}`,
      });
      // Mark the binding as comment-marker-based so codegen uses nextSibling.data
      const binding = itemBindings.find((b) => b.elementId === id && b.type === 'text');
      if (binding) {
        binding.textBindingMode = 'commentMarker';
      }
    }
  }

  // Add IDs to parent elements for sole-content text bindings
  // First, build a map of tagStart -> existing elementId from the element ID map
  const tagStartToExistingId = new Map<number, string>();
  for (const [element, existingId] of elementIdMap) {
    tagStartToExistingId.set(element.tagStart, existingId);
  }

  for (const [tagStart, id] of parentElementIds) {
    // Check if this element already has an ID assigned (e.g., from event processing)
    const existingId = tagStartToExistingId.get(tagStart);
    if (existingId) {
      // Reuse the existing ID — update the binding to reference it
      for (const binding of itemBindings) {
        if (binding.elementId === id) {
          binding.elementId = existingId;
        }
      }
      // No need to inject an ID — buildElementIdEdits will handle it
      continue;
    }

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
    }
    // If element already has a user-defined id, no attribute injection needed —
    // the optimized codegen uses path-based navigation (children[N] etc.),
    // and THANE406 linter rule bans user id attributes in templates anyway.
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
    const binding = itemBindings.find((b) => b.elementId === id);
    if (binding) {
      binding.elementId = elementId;
    }

    edits.push({
      start,
      end,
      replacement: `${attrName}="\${${transformedExpr}}"`,
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
  signalBindings: SimpleBinding[];
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
