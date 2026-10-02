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
  StaticTemplateInfo,
  SimpleBinding,
} from './types.js';
import { isSimpleBinding } from './types.js';
import { ErrorCode } from '../../errors.js';
import { processSubTemplateWithNesting, reportParseDiagnostics } from './template-processing.js';
import {
  parseHtmlTemplate,
  walkElements,
  findElementsWithWhenDirective,
  attributeDomProperty,
  findTemplateExpressions,
  stripTemplateExpressions,
  extractSignalsFromExpression,
  type HtmlElement,
} from '../../utils/html-parser/index.js';
import { expressionReferencesIdentifier, replaceReferences } from '../../utils/index.js';
import {
  collectConditionalBlocks,
  collectWhenElseBlocks,
  collectDirectiveRanges,
  isNestedInsideAny,
  buildConditionalEdits,
  buildWhenElseEdits,
  buildBoundMarkEdits,
  anchorMark,
  BOUND_MARK,
  applyTemplateEdits,
  stripPropertyBoundAttributes,
  toRepeatBlock,
  type IdState,
  type TemplateEdit,
} from './template-utils.js';
import type { Range } from '../../types.js';
import { condenseBetweenTags, outsideVerbatim } from '../minification/template-minifier.js';
import { VOID } from './dom-model.js';

/**
 * Whitespace before a row text marker whose other side is not a sibling (an element's end, a void
 * element, an anchor or another marker): the parent's start tag, a boundary or a comment.
 */
const SPACE_BEFORE_MARKER_AFTER_NON_SIBLING = new RegExp(
  `(?<!<\\/[^<>]*|<(?:${[...VOID].join('|')})\\b[^<>]*|<!--[ib]\\d+[(|).]?--)>\\s+(?=<!--[ib]\\d+-->)`,
  'gi',
);

/**
 * Inside a row, nested directives (when/whenElse/repeat) cannot close over the row factory's
 * `item` and index parameters: their conditions and templates are compiled as sub-templates
 * whose bindings are driven by signals. So the row factory declares one signal per referenced
 * variable, `<itemVar>$` and `<indexVar>$`, and every reference inside a nested directive is
 * rewritten to read it (`row.name` → `row$().name`). The row's update writes the signals, and
 * the existing signal machinery re-evaluates conditions, branch bindings and nested lists.
 *
 * An expression that calls the item variable (`row()`, the Signal<Signal<T>[]> pattern) is left
 * alone: there the item is itself the signal to subscribe to. A name in `shadowed` (the parameters of
 * a nested list's rows) is the inner row's own inside that list's template, and is left alone too.
 */
const createRowRefRewriter = (itemVar: string, indexVar: string | undefined) => {
  const used = new Set<string>();
  const callsItemVar = new RegExp('\\b' + itemVar.replace(/[$]/g, '\\$&') + '\\s*\\(');
  const expression = (
    expr: string,
    shadowed: (string | undefined)[] = [],
  ): { expression: string; extraSignals: string[] } => {
    let out = expr;
    const extraSignals: string[] = [];
    for (const name of [callsItemVar.test(expr) ? undefined : itemVar, indexVar]) {
      const renamed = name && !shadowed.includes(name) ? replaceReferences(out, name, `${name}$()`) : out;
      if (renamed === out) continue;
      out = renamed;
      used.add(`${name}$`);
      extraSignals.push(`${name}$`);
    }
    return { expression: out, extraSignals };
  };
  const html = (source: string, shadowed?: (string | undefined)[]): string => {
    let out = '';
    let last = 0;
    for (const span of findTemplateExpressions(source)) {
      out += source.slice(last, span.start) + '${' + expression(span.expression, shadowed).expression + '}';
      last = span.end;
    }
    return out + source.slice(last);
  };
  return { expression, html, used };
};

/**
 * The binding id of a bound element inside a row template. Registering the element in
 * elementIdMap is what marks it (BOUND_MARK), which lets generateStaticRepeatTemplate compute its
 * path; a developer's id is left alone.
 */
const ensureRowElementId = (el: HtmlElement, state: IdState, prefix: 'b' | 'i'): string => {
  let id = state.elementIdMap.get(el);
  if (!id) {
    id = `${prefix}${state.idCounter++}`;
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
/** THANE016 for an element ref in a list row: each row has its element, and one ref would name only one of them */
export const refInRow = (name: string): string =>
  `${ErrorCode.TAG_VALUE}: \${${name}} in a list row — a ref names one element, and each row has one of its own. ` +
  'Read the element from the event in a handler (e.currentTarget), or give the row a component that holds the ref.';

export const generateStaticRepeatTemplate = (
  itemTemplate: string,
  itemBindings: ItemBinding[],
  itemEvents?: ItemEventBinding[],
  signalBindings?: SimpleBinding[],
): StaticTemplateInfo => {
  // Parse the template to get element structure
  const parsed = parseHtmlTemplate(itemTemplate);

  // Rows are cloned from one element and reconciled by that element, so a row template is
  // exactly one root element; anything else is reported rather than rendered another way.
  if (parsed.roots.length !== 1) {
    // A row that is only directives is only their anchor comments.
    const onlyDirectives = parsed.roots.length === 0 && /<!--[ib]\d+[(|).]-->/.test(itemTemplate);
    throw new Error(
      `${ErrorCode.REPEAT_ROW_ROOT}: a repeat() row template must have exactly one root element` +
        (onlyDirectives
          ? '; this row is only a directive (when(), whenElse() or repeat()). Wrap it in an element such as <li>.'
          : ` (found ${parsed.roots.length}). Wrap the row's content in a single element.`),
    );
  }

  const rootEl = parsed.roots[0]!;

  // Build a map of element ID to bindings (only element-navigable bindings)
  // Comment-marker bindings (textBindingMode === 'commentMarker') are handled
  // separately, by the path to the text node after their marker, and are not included here.
  // Mixed signal+item bindings (outerSignalNames set) are handled via the
  // dedicated mixedSignalItemBindings path and excluded from regular element bindings.
  const bindingsByElement = new Map<string, ItemBinding[]>();
  const mixedItemBindings: ItemBinding[] = [];
  for (const binding of itemBindings) {
    if (binding.textBindingMode === 'commentMarker') continue; // reached through its marker
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

  // A bound element is found by its mark
  const findElementPath = (el: HtmlElement, targetId: string, currentPath: number[]): number[] | null => {
    if (el.attributes.get(BOUND_MARK)?.value === targetId) return currentPath;
    for (let i = 0; i < el.children.length; i++) {
      const childPath = findElementPath(el.children[i]!, targetId, [...currentPath, i]);
      if (childPath) return childPath;
    }
    return null;
  };
  // The root's own mark resolves to [] (findElementPath checks the element before its children)
  const pathOf = (id: string): number[] | null => findElementPath(rootEl, id, []);
  const pathError = (): Error =>
    new Error(
      `${ErrorCode.PLUGIN_ERROR}: internal compiler error — the element path for a bound element in a repeat() row could not be computed. Please report this with the row template.`,
    );

  // Every bound element has a path; since ids are injected before analysis this can only be
  // a compiler bug, and an error surfaces it instead of hiding it behind another renderer.
  for (const elementId of bindingsByElement.keys()) {
    const path = pathOf(elementId);
    if (!path) throw pathError();
    elementPaths.set(elementId, path);
  }

  // A when() / whenElse() branch pre-rendered in the row is emitted exactly as its own template, which
  // its initializer's paths are computed on: it is set aside, by its opening anchor, while the
  // row's own markup is processed, and put back after.
  const branches = new Map<string, string>();
  let staticHtml = itemTemplate.replace(
    /<!--(b\d+)([(|])-->([\s\S]*?)(?=<!--\1[|)]-->)/g,
    (_match, id: string, kind: string, content: string) => {
      branches.set(id + kind, content);
      return `<!--${id}${kind}-->`;
    },
  );

  // Strip ALL remaining ${...} template expressions from the static HTML.
  // By this point, component-level signal bindings have already been replaced
  // with <!--bN-->value comment markers, and event bindings have been
  // extracted. The only ${...} expressions left are item-variable bindings,
  // which are handled at runtime via the element binding paths — so they must
  // all be removed from the static template.
  staticHtml = stripTemplateExpressions(staticHtml);
  // Property-bound attributes (checked, disabled, value, …) must not ship in the template
  staticHtml = stripPropertyBoundAttributes(staticHtml, itemBindings);

  // The marks stay: the row's code finds its text markers, anchors and child hosts by them in the
  // template as emitted, which is written without them

  // Strip whitespace BEFORE inserting comment marker placeholders.
  // - Between two tags, condense it: gone when it holds a line break, one space when it does not,
  //   as in component templates
  // - Collapse runs to single space
  // - Next to a comment it goes, except next to a text marker, where it is text: one space stays
  //   between a binding and a sibling (an element or anchor after it, an element's end, a void element
  //   or an anchor before it, another binding), as in component templates. Between a binding and its
  //   parent's own tags it goes.
  // - Strip trailing whitespace before > in opening tags (<a > → <a>)
  // Sole-content elements become empty (<td></td>) — the row creates their text node on fill.
  // Verbatim elements (<pre>, <textarea>, …) keep their whitespace.
  staticHtml = outsideVerbatim(staticHtml, (html) =>
    condenseBetweenTags(html)
      .replace(/\s+/g, ' ')
      .replace(/(?<=--)(?<!<!--[ib]\d+--)>\s+<(?!!--[ib]\d+-->)|(?<!--)>\s+<(?=!--)(?!!--[ib]\d+-->)/g, '><')
      .replace(/(<!--[ib]\d+-->)\s+(?=<(?![A-Za-z]|!--[ib]\d+[(|).]?-->))/g, '$1')
      .replace(SPACE_BEFORE_MARKER_AFTER_NON_SIBLING, '>')
      .replace(/\s+>/g, '>')
      .trim(),
  );

  // Insert comment marker placeholders AFTER stripping (so they survive intact).
  // Mixed-content text bindings need: <!--iN--> + text node + <!----> boundary, so that the
  // binding's text node exists on its own for the row's path to reach it.
  staticHtml = staticHtml
    .replace(/(<!--[ib]\d+-->)/g, '$1 <!---->')
    .replace(/<!--(b\d+[(|])-->/g, (open, key: string) => open + (branches.get(key) ?? ''));

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
      const path = pathOf(evt.elementId);
      if (path) eventElementPaths.set(evt.elementId, path);
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
      const path = pathOf(sb.id);
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

  // Compute paths for mixed signal+item bindings (Step 13c)
  let mixedSignalItemBindings: StaticTemplateInfo['mixedSignalItemBindings'];
  if (mixedItemBindings.length > 0) {
    mixedSignalItemBindings = [];
    for (const mb of mixedItemBindings) {
      // The bound element carries an injected id like any other bound element, so its
      // path resolves the same way.
      const path = pathOf(mb.elementId);
      if (path === null) throw pathError();
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

  return {
    staticHtml,
    elementBindings: elementBindingsArray,
    eventElementPaths,
    ...(signalElementBindings ? { signalElementBindings } : {}),
    ...(signalCommentBindings && signalCommentBindings.length > 0 ? { signalCommentBindings } : {}),
    ...(mixedSignalItemBindings && mixedSignalItemBindings.length > 0 ? { mixedSignalItemBindings } : {}),
  };
};

/**
 * The element whose only content is the row text binding at [start, end), or null. The parent is
 * the innermost element whose content holds the binding. An element the parser left unclosed
 * (closeTagStart 0) holds nothing, and text outside every element is never sole content. A
 * sole-content binding is rendered through its element's text node; any other through a comment
 * marker.
 */
const soleContentParent = (
  parsed: ReturnType<typeof parseHtmlTemplate>,
  templateContent: string,
  start: number,
  end: number,
): HtmlElement | null => {
  // Pre-order: each element that holds the binding comes after its ancestors, so the last is the innermost
  const holders: HtmlElement[] = [];
  walkElements(parsed.roots, (el) => {
    if (el.openTagEnd <= start && end <= el.closeTagStart) holders.push(el);
  });
  const parent = holders[holders.length - 1];
  if (!parent || parent.children.length > 0) return null;
  return templateContent.slice(parent.openTagEnd, parent.closeTagStart).trim() === templateContent.slice(start, end)
    ? parent
    : null;
};

// ============================================================================
// Item binding extraction helpers (used by processItemTemplate)
// ============================================================================

/**
 * The signals a row expression reads other than the row's own item, index and row signals, found
 * the way component bindings find theirs: `it.name.toUpperCase()` reads none.
 */
const outerSignalsOf = (expr: string, itemVar: string, indexVar: string | undefined): string[] =>
  extractSignalsFromExpression(expr).filter((name) => name !== itemVar && name !== `${itemVar}$` && name !== indexVar);

interface ItemTextMatch {
  start: number;
  end: number;
  expr: string;
  id: string;
  /** The element the binding is the sole content of, if any */
  soleParent: HtmlElement | null;
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
  elementIdMap: Map<HtmlElement, string>,
  textBindingSpans: Map<number, { spanId: string; exprEnd: number; signalName: string }>,
): void => {
  let itemEventIdCounter = 0;

  for (const binding of parsed.bindings) {
    if (elementsInsideConditionals.has(binding.element)) continue;
    if (conditionalElementSet.has(binding.element)) continue;
    if (binding.type === 'when' || binding.type === 'whenElse' || binding.type === 'repeat') continue;
    const insideRange = allRanges.some((r) => binding.expressionStart >= r.start && binding.expressionStart < r.end);
    if (insideRange) continue;
    if (binding.type === 'ref') throw new Error(refInRow(binding.handlerExpression!));
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
      const fullExpr = binding.jsExpression || binding.fullExpression || '';
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
  const itemTextMatches: ItemTextMatch[] = [];

  for (const { start: matchStart, end: matchEnd, expression: innerExpr } of findTemplateExpressions(templateContent)) {
    const insideRange = allRanges.some((r) => matchStart >= r.start && matchStart < r.end);
    if (insideRange) continue;
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

      // Is this binding the sole content of its parent element?
      const soleParent = soleContentParent(parsed, templateContent, matchStart, matchEnd);

      const id = `i${state.idCounter++}`;

      // Detect outer signal references in the expression (mixed binding)
      const outerSignals = outerSignalsOf(innerExpr, itemVar, indexVar);

      itemBindings.push({
        elementId: id,
        type: 'text',
        expression: expression,
        // sole-content → the element's placeholder Text node; mixed-content → comment marker
        textBindingMode: soleParent ? 'textNode' : 'commentMarker',
        ...(outerSignals.length > 0 ? { outerSignalNames: outerSignals } : {}),
      });

      itemTextMatches.push({
        start: matchStart,
        end: matchEnd,
        expr: expression,
        id,
        soleParent,
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
      const exprs = findTemplateExpressions(attr.value).map((e) => e.expression);
      const refsRow = (e: string) =>
        expressionReferencesIdentifier(e, itemVar) || (indexVar ? expressionReferencesIdentifier(e, indexVar) : false);
      if (exprs.length === 0 || !exprs.some(refsRow)) continue;
      const staticText = stripTemplateExpressions(attr.value);
      const hasStatic = exprs.length > 1 || staticText.trim() !== '';
      {
        const innerExpr = hasStatic ? '`' + attr.value + '`' : exprs[0]!;

        // One id per element, shared by every item attribute on it and by any event handler
        // or sole-content text binding already assigned to it. Registering the element in
        // elementIdMap is what marks it in the template, which is how
        // generateStaticRepeatTemplate finds the element's navigation path.
        const id = ensureRowElementId(el, state, 'i');

        // Detect outer signal references in the expression (mixed binding)
        const outerSignals = outerSignalsOf(innerExpr, itemVar, indexVar);

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
export const processItemTemplate = (
  templateContent: string,
  itemVar: string,
  indexVar: string | undefined,
  signalInitializers: Map<string, string | number | boolean>,
  startingId: number,
): {
  processedContent: string;
  bindings: ItemBinding[];
  events: ItemEventBinding[];
  signalBindings: SimpleBinding[];
  nestedConditionals: ConditionalBlock[];
  nestedWhenElse: WhenElseBlock[];
  nestedRepeats: RepeatBlock[];
  rowSignalVars: string[];
  nextId: number;
} => {
  const parsed = parseHtmlTemplate(templateContent);
  reportParseDiagnostics(parsed);
  // The reconciler holds each row by its root element, which a when() would replace
  if (parsed.roots.some((root) => root.whenDirective !== undefined)) {
    throw new Error(
      `${ErrorCode.ROW_ROOT_WHEN}: a repeat() row's root element cannot carry when(); filter the list, or put when() on an inner element.`,
    );
  }

  const itemBindings: ItemBinding[] = [];
  const itemEvents: ItemEventBinding[] = [];
  const signalBindings: SimpleBinding[] = [];
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
  const processRowSubTemplate = (template: string, id: string, report?: boolean) =>
    processSubTemplateWithNesting(
      rowRefs.html(template),
      signalInitializers,
      state.idCounter,
      id,
      undefined,
      state.eventIdCounter,
      report,
    );

  // ── Conditionals: compiled as sub-templates, like at component level ──
  const condResult = collectConditionalBlocks(parsed, templateContent, signalInitializers, state, {
    processSubTemplate: processRowSubTemplate,
    rewriteExpression: rowRefs.expression,
  });
  const conditionals = condResult.conditionals;
  signalBindings.push(...condResult.bindings.filter(isSimpleBinding));

  // ── Directive ownership: a whenElse/repeat nested inside another directive of the row (a nested
  //    list, a whenElse branch, a when() element) belongs to that directive's processing, as at
  //    component level ──
  const ranges = collectDirectiveRanges(parsed);
  const isOwnedByNestedProcessing = (start: number, end: number): boolean =>
    isNestedInsideAny(start, end, ranges.repeat) ||
    isNestedInsideAny(start, end, ranges.whenElse) ||
    isNestedInsideAny(start, end, ranges.conditional);

  // ── WhenElse ──
  const branches = collectWhenElseBlocks(
    {
      ...parsed,
      bindings: parsed.bindings.filter(
        (b) => b.type !== 'whenElse' || !isOwnedByNestedProcessing(b.expressionStart, b.expressionEnd),
      ),
    },
    signalInitializers,
    state,
    processRowSubTemplate,
    rowRefs.expression,
  );
  const whenElseBlocks = branches.whenElseBlocks;
  conditionals.push(...branches.conditionals);

  // ── Nested repeats ──
  for (const binding of parsed.bindings) {
    if (binding.type !== 'repeat') continue;
    if (!binding.itemsExpression || !binding.itemVar || !binding.itemTemplate) continue;
    if (isOwnedByNestedProcessing(binding.expressionStart, binding.expressionEnd)) continue;

    // The inner list and its rows may read the outer item/index: route them through the row signals
    const nestedItems = rowRefs.expression(binding.itemsExpression);
    const nestedSignalNames = [
      ...new Set([...(binding.signalNames || [binding.signalName]), ...nestedItems.extraSignals]),
    ].filter((s) => s !== '');
    const nestedRepeatId = `b${state.idCounter++}`;
    const nestedProcessed = processItemTemplate(
      rowRefs.html(binding.itemTemplate, [binding.itemVar, binding.indexVar]),
      binding.itemVar,
      binding.indexVar,
      signalInitializers,
      state.idCounter,
    );
    state.idCounter = nestedProcessed.nextId;
    repeatBlocks.push(
      toRepeatBlock(binding, nestedRepeatId, nestedProcessed, nestedItems.expression, nestedSignalNames),
    );
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

  const edits: TemplateEdit[] = [...buildConditionalEdits(conditionals), ...buildWhenElseEdits(whenElseBlocks)];
  for (const rep of repeatBlocks) {
    edits.push({ start: rep.startIndex, end: rep.endIndex, replacement: anchorMark(rep.id, '.') });
  }
  // Inject comment markers for signal text bindings (AST-driven, no regex)
  for (const [exprPos, { spanId, exprEnd }] of textBindingSpans) {
    edits.push({
      start: exprPos,
      end: exprEnd,
      replacement: `<!--${spanId}-->\${${templateContent.substring(exprPos + 2, exprEnd - 1)}}`,
    });
  }

  // Track which parent elements need IDs for sole-content text bindings
  const parentElementIds = new Map<HtmlElement, string>();

  // The expressions themselves stay as written: the static row template strips them, and the row
  // code is generated from the item bindings
  for (const textMatch of itemTextMatches) {
    const { start, end, expr, id, soleParent } = textMatch;

    if (soleParent) {
      // For sole content: just output the expression (no wrapper), in place of the element's whole
      // content: the row writes the element's text, so whitespace around the binding would only be
      // a node every row clones. The parent element will get the ID
      edits.push({
        start: soleParent.openTagEnd,
        end: soleParent.closeTagStart,
        replacement: `\${${expr}}`,
      });
      parentElementIds.set(soleParent, id);
    } else {
      // For mixed content: inject a comment marker so the optimized path can
      // locate the adjacent text node without a wrapper element.
      edits.push({
        start,
        end,
        replacement: `<!--${id}-->\${${expr}}`,
      });
    }
  }

  // The parent of a sole-content text binding is a bound element like any other: register it
  // so it shares one id with any attribute or event binding on it, and so buildBoundMarkEdits
  // marks it.
  for (const [parentEl, id] of parentElementIds) {
    const elementId = elementIdMap.get(parentEl) ?? id;
    elementIdMap.set(parentEl, elementId);
    if (elementId === id) continue;
    for (const binding of itemBindings) {
      if (binding.elementId === id) binding.elementId = elementId;
    }
  }
  for (const { start, end, attrName, expr } of itemAttrMatches) {
    edits.push({
      start,
      end,
      replacement: `${attrName}="\${${expr}}"`,
    });
  }
  edits.push(...buildBoundMarkEdits(elementIdMap, allRanges));
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
    bindings: itemBindings,
    events: itemEvents,
    signalBindings,
    nestedConditionals: conditionals,
    nestedWhenElse: whenElseBlocks,
    nestedRepeats: repeatBlocks,
    rowSignalVars: [...rowRefs.used],
    nextId: state.idCounter,
  };
};
