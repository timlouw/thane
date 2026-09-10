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
  SimpleBinding,
} from './types.js';
import { isSimpleBinding } from './types.js';
import { ErrorCode } from '../../errors.js';
import { processSubTemplateWithNesting } from './template-processing.js';
import {
  parseHtmlTemplate,
  walkElements,
  findElementsWithWhenDirective,
  injectIdIntoFirstElement,
  attributeDomProperty,
  findTemplateExpressions,
  stripTemplateExpressions,
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
  stripPropertyBoundAttributes,
  type IdState,
  type TemplateEdit,
  type Range,
} from './template-utils.js';

/**
 * Inside a row, nested directives (when/whenElse/repeat) cannot close over the row factory's
 * `item` and index parameters: their conditions and templates are compiled as sub-templates
 * whose bindings are driven by signals. So the row factory declares one signal per referenced
 * variable, `<itemVar>$` and `<indexVar>$`, and every reference inside a nested directive is
 * rewritten to read it (`row.name` → `row$().name`). The row's update writes the signals, and
 * the existing signal machinery re-evaluates conditions, branch bindings and nested lists.
 *
 * An expression that calls the item variable (`row()`, the Signal<Signal<T>[]> pattern) is left
 * alone: there the item is itself the signal to subscribe to.
 */
const createRowRefRewriter = (itemVar: string, indexVar: string | undefined) => {
  const used = new Set<string>();
  const itemAccessor = itemVar + '$';
  const indexAccessor = indexVar ? indexVar + '$' : undefined;
  const callsItemVar = new RegExp('\\b' + itemVar.replace(/[$]/g, '\\$&') + '\\s*\\(');
  const expression = (expr: string): { expression: string; extraSignals: string[] } => {
    let out = expr;
    const extraSignals: string[] = [];
    if (expressionReferencesIdentifier(expr, itemVar) && !callsItemVar.test(expr)) {
      out = renameIdentifierInExpression(out, itemVar, itemAccessor + '()');
      used.add(itemAccessor);
      extraSignals.push(itemAccessor);
    }
    if (indexVar && indexAccessor && expressionReferencesIdentifier(out, indexVar)) {
      out = renameIdentifierInExpression(out, indexVar, indexAccessor + '()');
      used.add(indexAccessor);
      extraSignals.push(indexAccessor);
    }
    return { expression: out, extraSignals };
  };
  const html = (source: string): string => {
    let out = '';
    let last = 0;
    for (const span of findTemplateExpressions(source)) {
      out += source.slice(last, span.start) + '${' + expression(span.expression).expression + '}';
      last = span.end;
    }
    return out + source.slice(last);
  };
  return { expression, html, used };
};

/**
 * The id used to locate a bound element inside a row template. A developer-supplied id is
 * reused as-is (so it survives in the row and nothing else has to be injected); otherwise a
 * generated one is assigned. Either way the element is registered in elementIdMap, which is
 * what gets the id attribute injected and lets generateStaticRepeatTemplate compute its path.
 */
const ensureRowElementId = (el: HtmlElement, state: IdState, prefix: 'b' | 'i'): string => {
  let id = state.elementIdMap.get(el);
  if (!id) {
    id = el.attributes.get('id')?.value || `${prefix}${state.idCounter++}`;
    state.elementIdMap.set(el, id);
  }
  return id;
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

  // Rows are cloned from one element and reconciled by that element, so a row template is
  // exactly one root element; anything else is reported rather than rendered another way.
  if (parsed.roots.length !== 1) {
    // A row that is only a when()/whenElse() parses as its anchor elements.
    const onlyDirectives = parsed.roots.length > 0 && parsed.roots.every((r) => r.tagName === 'template');
    throw new Error(
      `${ErrorCode.REPEAT_ROW_ROOT}: a repeat() row template must have exactly one root element` +
        (onlyDirectives
          ? '; this row is only a when()/whenElse() directive. Wrap it in an element such as <li>.'
          : ` (found ${parsed.roots.length}). Wrap the row's content in a single element.`),
    );
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

  // Every bound element has a path; since ids are injected before analysis this can only be
  // a compiler bug, and an error surfaces it instead of hiding it behind another renderer.
  for (const elementId of bindingsByElement.keys()) {
    if (!elementPaths.has(elementId)) {
      throw new Error(
        `${ErrorCode.PLUGIN_ERROR}: internal compiler error — the element path for a bound element in a repeat() row could not be computed. Please report this with the row template.`,
      );
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
  staticHtml = stripTemplateExpressions(staticHtml);
  // Property-bound attributes (checked, disabled, value, …) must not ship in the template
  staticHtml = stripPropertyBoundAttributes(staticHtml, itemBindings);

  // Remove inline id attributes that were only added for bindings
  // These follow the pattern id="i0", id="i1", id="b0", id="b1", etc.
  staticHtml = staticHtml.replace(/\s*id="[ib]\d+"/g, '');

  // Aggressively strip whitespace BEFORE inserting comment marker placeholders.
  // - Collapse runs to single space
  // - Remove all inter-element whitespace (><)
  // - Strip trailing whitespace before > in opening tags (<a > → <a>)
  // Sole-content elements become empty (<td></td>) — the row creates their text node on fill.
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
        domProperty: b.domProperty,
        expression: b.expression,
        staticValue: b.staticValue,
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
          expression: sb.expression,
          signalNames: sb.signalNames,
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
          domProperty: sb.domProperty,
          expression: sb.expression,
          signalNames: sb.signalNames,
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
      // The bound element carries an injected id like any other bound element, so its
      // path resolves the same way.
      const rootId = rootEl.attributes.get('id')?.value;
      const path = rootId === mb.elementId ? [] : findElementPath(rootEl, mb.elementId, []);
      if (path === null) {
        throw new Error(
          `${ErrorCode.PLUGIN_ERROR}: internal compiler error — the element path for a bound element in a repeat() row could not be computed. Please report this with the row template.`,
        );
      }
      {
        mixedSignalItemBindings.push({
          path,
          outerSignalNames: mb.outerSignalNames!,
          type: mb.type,
          property: mb.property,
          domProperty: mb.domProperty,
          expression: mb.expression,
          staticValue: mb.staticValue,
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
  _eventBindings: EventBinding[],
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
      // Every handler on a row element is a row event, whether or not it mentions the item:
      // rows do not exist when the component binds, so a root-level listener would attach to
      // nothing. The row's delegated (or per-row) listener calls it with the event.
      const eventId = `ie${itemEventIdCounter++}`;
      const eventElementId = ensureRowElementId(binding.element, state, 'b');
      itemEvents.push({
        eventId,
        elementId: eventElementId,
        eventName: binding.eventName,
        modifiers: binding.eventModifiers || [],
        handlerExpression: binding.handlerExpression,
      });
      continue;
    }
    if (binding.type === 'text' || binding.type === 'style' || binding.type === 'attr') {
      // Check if the full expression also references the item variable.
      // If so, this is a "mixed" binding (outer signal + item data) — skip
      // classifying as a signal binding; collectItemAttrBindings will handle it.
      const fullExpr = (binding as any).jsExpression || (binding as any).fullExpression || '';
      const isMixed =
        fullExpr &&
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
      // Keep the expression when it is more than a bare read, so `user().name` writes the
      // member and not the object, and subscribe to every signal it reads.
      // The parser records a bare read as its full ${…} text; strip the braces before deciding
      const exprText = fullExpr.replace(/^\s*\$\{([\s\S]*)\}\s*$/, '$1').trim();
      const bareRead = /^[A-Za-z_$][\w$]*\(\)$/.test(exprText);
      signalBindings.push({
        id: bindingId,
        signalName: binding.signalName,
        type: binding.type,
        ...(binding.property ? { property: binding.property } : {}),
        ...(bareRead || !exprText
          ? {}
          : { expression: exprText, signalNames: binding.signalNames ?? [binding.signalName] }),
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
        // sole-content → the element's placeholder Text node; mixed-content → comment marker
        textBindingMode: context.isSoleContent ? 'textNode' : 'commentMarker',
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
      // One binding per attribute. With static text around the expression, or several
      // expressions, the value is the whole attribute as a template literal
      // (`class="row ${item.kind}"` writes `row a`); otherwise it is the expression itself.
      const attrExprRegex = /\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
      const exprs = [...attr.value.matchAll(attrExprRegex)].map((m) => (m[1] ?? '').trim());
      const refsRow = (e: string) =>
        expressionReferencesIdentifier(e, itemVar) || (indexVar ? expressionReferencesIdentifier(e, indexVar) : false);
      if (exprs.length === 0 || !exprs.some(refsRow)) continue;
      const staticText = attr.value.replace(attrExprRegex, '');
      const hasStatic = exprs.length > 1 || staticText.trim() !== '';
      {
        const innerExpr = hasStatic ? '`' + attr.value + '`' : exprs[0]!;

        // One id per element, shared by every item attribute on it and by any event handler
        // or sole-content text binding already assigned to it. Registering the element in
        // elementIdMap is what gets `id="…"` injected into the template, which is how
        // generateStaticRepeatTemplate finds the element's navigation path.
        const id = ensureRowElementId(el, state, 'i');

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

        const domProperty = attributeDomProperty(attrName, el);
        itemBindings.push({
          elementId: id,
          type: 'attr',
          property: attrName,
          domProperty,
          expression: innerExpr,
          ...(outerSignals.length > 0 ? { outerSignalNames: outerSignals } : {}),
          // What the static template ships for this attribute once every expression is stripped.
          // Property-bound and mixed attributes ship nothing useful, so the first write always happens.
          staticValue: (domProperty && domProperty !== 'className') || hasStatic ? undefined : staticText,
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
  rowSignalVars: string[];
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

  // ── Nested directives read the row's item and index through row-scoped signals ──
  const rowRefs = createRowRefRewriter(itemVar, indexVar);
  const processRowSubTemplate = (template: string, id: string) =>
    processSubTemplateWithNesting(
      rowRefs.html(template),
      signalInitializers,
      state.idCounter,
      id,
      undefined,
      state.eventIdCounter,
    );

  // ── Conditionals: compiled as sub-templates, like at component level ──
  const condResult = collectConditionalBlocks(parsed, templateContent, signalInitializers, state, {
    processSubTemplate: processRowSubTemplate,
    rewriteExpression: rowRefs.expression,
  });
  const conditionals = condResult.conditionals;
  signalBindings.push(...condResult.bindings.filter(isSimpleBinding));
  eventBindings.push(...condResult.eventBindings);

  // ── WhenElse ──
  const whenElseBlocks = collectWhenElseBlocks(
    parsed,
    signalInitializers,
    state,
    processRowSubTemplate,
    rowRefs.expression,
  );

  // ── Nested repeats ──
  for (const binding of parsed.bindings) {
    if (binding.type !== 'repeat') continue;
    if (!binding.itemsExpression || !binding.itemVar || !binding.itemTemplate) continue;

    // The inner list and its rows may read the outer item/index: route them through the row signals
    const nestedItems = rowRefs.expression(binding.itemsExpression);
    const nestedSignalNames = [
      ...new Set([...(binding.signalNames || [binding.signalName]), ...nestedItems.extraSignals]),
    ].filter((s) => s !== '');
    const nestedRepeatId = `b${state.idCounter++}`;
    const nestedProcessed = processItemTemplateRecursively(
      rowRefs.html(binding.itemTemplate),
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
      itemsExpression: nestedItems.expression,
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
      rowSignalVars: nestedProcessed.rowSignalVars,
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

  // The parent of a sole-content text binding is a bound element like any other: register it
  // so it shares one id with any attribute or event binding on it, and so buildElementIdEdits
  // injects the id attribute (or leaves a developer-supplied id in place).
  const elementByTagStart = new Map<number, HtmlElement>();
  walkElements(parsed.roots, (el) => elementByTagStart.set(el.tagStart, el));
  for (const [tagStart, id] of parentElementIds) {
    const parentEl = elementByTagStart.get(tagStart);
    if (!parentEl) continue;
    const elementId = elementIdMap.get(parentEl) ?? (parentEl.attributes.get('id')?.value || id);
    elementIdMap.set(parentEl, elementId);
    if (elementId === id) continue;
    for (const binding of itemBindings) {
      if (binding.elementId === id) binding.elementId = elementId;
    }
  }
  for (const { start, end, attrName, expr } of itemAttrMatches) {
    let transformedExpr = renameIdentifierInExpression(expr, itemVar, `${itemVar}$()`);
    if (indexVar) {
      transformedExpr = renameIdentifierInExpression(transformedExpr, indexVar, indexVar);
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
    rowSignalVars: [...rowRefs.used],
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
  rowSignalVars: string[];
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
    rowSignalVars: result.rowSignalVars,
    nextId: result.nextId,
  };
};
