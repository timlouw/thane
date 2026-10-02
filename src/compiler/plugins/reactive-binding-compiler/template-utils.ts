/**
 * Shared template processing utilities
 *
 * Extracted from template-processing.ts and repeat-analysis.ts to
 * eliminate ~300 lines of near-identical conditional/whenElse/edit logic.
 */

import type { Range } from '../../types.js';
import { ErrorCode } from '../../errors.js';
import type { ConditionalBlock, WhenElseBlock, RepeatBlock, BindingInfo, EventBinding } from './types.js';
import {
  findElementsWithWhenDirective,
  walkElements,
  getElementHtml,
  escapeRawTemplateLiteral,
  parseHtmlTemplate,
  type HtmlElement,
  type ParsedTemplate,
  type BindingInfo as ParsedBindingInfo,
} from '../../utils/html-parser/index.js';
import { condenseBetweenTags, outsideVerbatim } from '../minification/template-minifier.js';
import { safeEvaluateCondition } from './template-processing.js';
import type { processItemTemplate } from './repeat-analysis.js';

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

/**
 * The attribute that marks a bound element while its template is compiled: the element's
 * position in the emitted template is computed from it, and the emitted HTML carries none. It is
 * never the developer's `id`, which stays on its element and is not used to find it.
 */
export const BOUND_MARK = 'data-thane-ref';

/**
 * The comment that marks an anchor while its template is compiled: a `when()` sits between `(` and
 * `)`, a `whenElse()` has `(` then-branch `|` else-branch `)`, and `.` is a single anchor, the
 * end of a list or the place of a child component, each with the directive's id. A text
 * binding's marker is the id alone (`<!--b3-->`, the text node after it is the binding's). The
 * emitted HTML carries the same comments without data (`<!---->`).
 */
export const anchorMark = (id: string, kind: '(' | '|' | ')' | '.'): string => `<!--${id}${kind}-->`;

/** A template without its bound-element marks. */
export const stripBoundMarks = (html: string): string => html.replace(/ data-thane-ref="[^"]*"/g, '');

/** A template without its compile-time marks: the HTML that is emitted, which holds no id. */
export const stripMarks = (html: string): string => stripBoundMarks(html).replace(/<!--[ib]\d+[(|).]?-->/g, '<!---->');

export interface TemplateEdit {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Result of processing a directive sub-template — a whenElse branch or the
 * content of a when() element.
 */
export interface SubTemplateResult {
  processedContent: string;
  bindings: BindingInfo[];
  conditionals: ConditionalBlock[];
  whenElseBlocks: WhenElseBlock[];
  repeatBlocks: RepeatBlock[];
  eventBindings: EventBinding[];
  nextId: number;
}

/**
 * Processes a directive sub-template; `parentId` is the directive's (or branch's) id. `report` shows its
 * parse diagnostics: a whenElse() branch is a template of its own, a when() element's content is not.
 */
export type SubTemplateProcessor = (template: string, parentId: string, report?: boolean) => SubTemplateResult;

// ============================================================================
// Directive nesting helpers
// ============================================================================

/**
 * True when [start, end) sits strictly inside one of the given ranges.
 *
 * A directive expression nested inside another directive's range is owned by
 * that directive's recursive sub-template processing. Collecting it at the
 * outer level as well would emit overlapping template edits that corrupt the
 * HTML adjacent to the outer directive.
 */
export const isNestedInsideAny = (start: number, end: number, ranges: Range[]): boolean => {
  for (const r of ranges) {
    if (start > r.start && end < r.end) return true;
  }
  return false;
};

/** Source ranges of every repeat()/whenElse() expression and when() element in a parsed template. */
export const collectDirectiveRanges = (
  parsed: ParsedTemplate,
): { repeat: Range[]; whenElse: Range[]; conditional: Range[] } => {
  const repeat: Range[] = [];
  const whenElse: Range[] = [];
  for (const binding of parsed.bindings) {
    if (binding.type === 'repeat') {
      repeat.push({ start: binding.expressionStart, end: binding.expressionEnd });
    } else if (binding.type === 'whenElse') {
      whenElse.push({ start: binding.expressionStart, end: binding.expressionEnd });
    }
  }
  const conditional = findElementsWithWhenDirective(parsed.roots).map((el) => ({
    start: el.tagStart,
    end: el.closeTagEnd,
  }));
  return { repeat, whenElse, conditional };
};

/** The element's HTML with its `${when(...)}` directive removed, ready to be processed as a plain sub-template. */
const getElementHtmlWithoutWhenDirective = (element: HtmlElement, html: string): string => {
  if (element.whenDirectiveStart === undefined || element.whenDirectiveEnd === undefined) {
    return getElementHtml(element, html);
  }
  return (
    html.slice(element.tagStart, element.whenDirectiveStart) + html.slice(element.whenDirectiveEnd, element.closeTagEnd)
  );
};

// ============================================================================
// collectConditionalBlocks
// ============================================================================

/**
 * Shared conditional processing: find all when() directives in parsed HTML and
 * build ConditionalBlock entries.
 *
 * Each when() element's content is processed as a full sub-template, exactly like a
 * whenElse branch, so it supports nested when/whenElse/repeat directives, per-element
 * event bindings and child component mounts. Nested when() elements are collected by the
 * recursive processing of their parent, so only top-level ones are handled here.
 */
export const collectConditionalBlocks = (
  parsed: ParsedTemplate,
  templateContent: string,
  signalInitializers: Map<string, string | number | boolean>,
  state: IdState,
  opts: {
    /** Process each when() element's content as a full sub-template (see above) */
    processSubTemplate: SubTemplateProcessor;
    /** Rewrite the when() condition before it is stored (row templates route item reads through a signal). */
    rewriteExpression?: (expr: string) => { expression: string; extraSignals: string[] };
  },
): {
  conditionals: ConditionalBlock[];
  bindings: BindingInfo[];
} => {
  const conditionals: ConditionalBlock[] = [];
  const bindings: BindingInfo[] = [];

  const allConditionalElements = findElementsWithWhenDirective(parsed.roots);
  const elementsInsideConditionals = new Set<HtmlElement>();
  for (const condEl of allConditionalElements) {
    walkElements([condEl], (el) => {
      if (el !== condEl) elementsInsideConditionals.add(el);
    });
  }
  const targetElements = allConditionalElements.filter((el) => !elementsInsideConditionals.has(el));

  for (const condEl of targetElements) {
    const whenBinding = parsed.bindings.find((b) => b.element === condEl && b.type === 'when');
    if (!whenBinding || !whenBinding.jsExpression) continue;

    const rewritten = opts.rewriteExpression?.(whenBinding.jsExpression);
    const jsExpression = rewritten ? rewritten.expression : whenBinding.jsExpression;
    const signalNames = [
      ...new Set([...(whenBinding.signalNames || [whenBinding.signalName]), ...(rewritten?.extraSignals ?? [])]),
    ].filter((s) => s !== '');
    // The directive's id is the compiler's: a developer's id stays on the element
    const conditionalId = `b${state.idCounter++}`;
    state.elementIdMap.set(condEl, conditionalId);
    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);
    const base = {
      id: conditionalId,
      signalName: signalNames[0] ?? '',
      signalNames,
      jsExpression,
      initialValue,
      startIndex: condEl.tagStart,
      endIndex: condEl.closeTagEnd,
    };

    const processed = opts.processSubTemplate(
      getElementHtmlWithoutWhenDirective(condEl, templateContent),
      conditionalId,
    );
    state.idCounter = processed.nextId;
    conditionals.push({
      ...base,
      templateContent: processed.processedContent,
      nestedBindings: processed.bindings,
      nestedConditionals: processed.conditionals,
      nestedWhenElse: processed.whenElseBlocks,
      nestedRepeats: processed.repeatBlocks,
      nestedEventBindings: processed.eventBindings,
    });
    bindings.push(...processed.bindings);
  }

  return { conditionals, bindings };
};

// ============================================================================
// collectWhenElseBlocks
// ============================================================================

/**
 * Shared processing of the conditionals in content, `when(condition, then, otherwise?)`: each one's templates are
 * processed as sub-templates. One with an else-branch is a WhenElseBlock, bound over three anchors; one without
 * (or with an empty one) is a ConditionalBlock, bound like a when() element: over two anchors, by one binding.
 */
export const collectWhenElseBlocks = (
  parsed: ParsedTemplate,
  signalInitializers: Map<string, string | number | boolean>,
  state: IdState,
  processSubTemplate: SubTemplateProcessor,
  rewriteExpression?: (expr: string) => { expression: string; extraSignals: string[] },
): { whenElseBlocks: WhenElseBlock[]; conditionals: ConditionalBlock[] } => {
  const whenElseBlocks: WhenElseBlock[] = [];
  const conditionals: ConditionalBlock[] = [];

  for (const binding of parsed.bindings) {
    if (binding.type !== 'whenElse') continue;
    // A branch may be empty (html``): it shows nothing
    if (!binding.jsExpression || binding.thenTemplate === undefined || binding.elseTemplate === undefined) continue;

    const rewritten = rewriteExpression?.(binding.jsExpression);
    const jsExpression = rewritten ? rewritten.expression : binding.jsExpression;
    const signalNames = [
      ...new Set([...(binding.signalNames || [binding.signalName]), ...(rewritten?.extraSignals ?? [])]),
    ].filter((s) => s !== '');
    // Without an else-branch: a conditional of the then-branch alone
    if (binding.elseTemplate.trim() === '') {
      const id = `b${state.idCounter++}`;
      const processed = processSubTemplate(binding.thenTemplate, id, true);
      state.idCounter = processed.nextId;
      conditionals.push({
        id,
        signalName: signalNames[0] ?? '',
        signalNames,
        jsExpression,
        initialValue: safeEvaluateCondition(jsExpression, signalNames, signalInitializers),
        templateContent: processed.processedContent,
        startIndex: binding.expressionStart,
        endIndex: binding.expressionEnd,
        nestedBindings: processed.bindings,
        nestedConditionals: processed.conditionals,
        nestedWhenElse: processed.whenElseBlocks,
        nestedRepeats: processed.repeatBlocks,
        nestedEventBindings: processed.eventBindings,
      });
      continue;
    }
    // The branches' ids are the compiler's; a branch's root keeps any id of its own
    const thenId = `b${state.idCounter++}`;
    const elseId = `b${state.idCounter++}`;
    const initialValue = safeEvaluateCondition(jsExpression, signalNames, signalInitializers);

    const thenProcessed = processSubTemplate(binding.thenTemplate, thenId, true);
    state.idCounter = thenProcessed.nextId;
    const elseProcessed = processSubTemplate(binding.elseTemplate, elseId, true);
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
      thenRepeats: thenProcessed.repeatBlocks,
      elseRepeats: elseProcessed.repeatBlocks,
      thenEventBindings: thenProcessed.eventBindings,
      elseEventBindings: elseProcessed.eventBindings,
      thenConditionals: thenProcessed.conditionals,
      elseConditionals: elseProcessed.conditionals,
      thenWhenElse: thenProcessed.whenElseBlocks,
      elseWhenElse: elseProcessed.whenElseBlocks,
    });
  }

  return { whenElseBlocks, conditionals };
};

// ============================================================================
// toRepeatBlock
// ============================================================================

/** A repeat()'s empty template with its whitespace collapsed (outside verbatim elements). */
export const collapseEmptyTemplate = (template: string): string =>
  outsideVerbatim(template, (t) => condenseBetweenTags(t).replace(/\s+/g, ' ').replace(/\s+>/g, '>').trim());

const _componentRowRe = /^\s*([A-Za-z_$][\w$]*)\((.*)\)\s*$/s;

/**
 * A row that is a component call (`(item) => Card({ item })`): the component and its props as
 * written. Read from the row template before processing, which treats every `${…}` in it as row
 * markup.
 */
const componentRowOf = (rowTemplate: string): RepeatBlock['componentRow'] => {
  const match = _componentRowRe.exec(rowTemplate.trim());
  return match ? { componentName: match[1]!, propsExpression: match[2]?.trim() || '{}' } : undefined;
};

/**
 * A repeat()'s empty template, its `empty` option, collapsed. It is inserted as one static element while the
 * list is empty, so anything else is a build error (THANE011): more than one root, or text outside an element
 * (only the first element was shown, and text alone threw when the list emptied), or a `${…}`, which would be
 * shown as written.
 */
const emptyTemplateOf = (binding: ParsedBindingInfo): string | undefined => {
  if (!binding.emptyTemplate) return undefined;
  const template = collapseEmptyTemplate(binding.emptyTemplate);
  if (/(^|[^\\])\$\{/.test(template)) {
    throw new Error(
      `${ErrorCode.REPEAT_EMPTY_TEMPLATE_SHAPE}: repeat()'s empty template is static, so a \${…} in it would be shown as written: ${template}. Compute the text outside the template, or put a when() next to the list.`,
    );
  }
  const { roots } = parseHtmlTemplate(template);
  const root = roots[0];
  const end = root ? (root.isSelfClosing || root.closeTagEnd === 0 ? root.openTagEnd : root.closeTagEnd) : 0;
  if (roots.length !== 1 || template.slice(0, root!.tagStart).trim() || template.slice(end).trim()) {
    throw new Error(
      `${ErrorCode.REPEAT_EMPTY_TEMPLATE_SHAPE}: repeat()'s empty template must be one element, like a row: ${template}. Wrap its content in one element, for example html\`<li class="empty">No items</li>\`.`,
    );
  }
  return template;
};

/**
 * The RepeatBlock for a parsed repeat() binding whose row template has been processed. The
 * caller allocates the id, processes the row template and passes the (possibly rewritten) items
 * expression and its signal names.
 */
export const toRepeatBlock = (
  binding: ParsedBindingInfo,
  id: string,
  processed: ReturnType<typeof processItemTemplate>,
  itemsExpression: string,
  signalNames: string[],
): RepeatBlock => ({
  id,
  signalName: signalNames[0] || '',
  signalNames,
  itemsExpression,
  itemVar: binding.itemVar!,
  indexVar: binding.indexVar,
  itemTemplate: processed.processedContent,
  componentRow: componentRowOf(binding.itemTemplate!),
  emptyTemplate: emptyTemplateOf(binding),
  trackByFn: binding.trackByFn,
  startIndex: binding.expressionStart,
  endIndex: binding.expressionEnd,
  itemBindings: processed.bindings,
  itemEvents: processed.events,
  signalBindings: processed.signalBindings,
  nestedConditionals: processed.nestedConditionals,
  nestedWhenElse: processed.nestedWhenElse,
  nestedRepeats: processed.nestedRepeats,
  rowSignalVars: processed.rowSignalVars,
});

// ============================================================================
// buildRangeOverlapChecker
// ============================================================================

/**
 * Build a fast predicate for checking whether a position falls inside any of
 * the given structural ranges (conditionals, whenElse, repeats).
 */
export const buildRangeOverlapChecker = (ranges: Range[]): ((start: number) => boolean) => {
  return (start: number) => {
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
export const applyTemplateEdits = (source: string, edits: TemplateEdit[]): string => {
  edits.sort((a, b) => b.start - a.start);
  let result = source;
  for (const edit of edits) {
    result = result.substring(0, edit.start) + edit.replacement + result.substring(edit.end);
  }
  // Whitespace collapses everywhere except inside <pre>, <textarea>, <script> and <style>. Between two
  // tags it is condensed: gone when it holds a line break, one space when it does not. Next to an
  // anchor comment it goes: a list's container must hold only its rows and its anchor for a clear to
  // empty it at once. A text marker keeps the whitespace before it, which is text, and so does a
  // binding's boundary (`<!---->`) before an element or an anchor; before its parent's end tag it goes.
  return outsideVerbatim(result, (html) =>
    condenseBetweenTags(html)
      .replace(/\s+/g, ' ')
      .replace(/(?<=--)(?<!<!----)>\s+<(?![!-])|(?<=--)>\s+<(?=\/)/g, '><')
      .replace(/(?<!<!----)>\s+(?=<!--[ib]\d+[(|).]-->)/g, '>')
      .replace(/(<!--[ib]\d+-->)(<!---->)/g, '$1 $2')
      .replace(/\s+>/g, '>')
      .trim(),
  );
};

/**
 * Build standard edits from conditionals: the content between the directive's two anchors,
 * pre-rendered when the condition is true at compile time, otherwise nothing between them. A
 * condition that could not be resolved at compile time (initialValue undefined) is deferred: the
 * runtime evaluates it at mount and shows the content if needed.
 */
export const buildConditionalEdits = (conditionals: ConditionalBlock[]): TemplateEdit[] => {
  return conditionals.map((cond) => ({
    start: cond.startIndex,
    end: cond.endIndex,
    replacement:
      anchorMark(cond.id, '(') + (cond.initialValue === true ? cond.templateContent : '') + anchorMark(cond.id, ')'),
  }));
};

/**
 * Build standard edits from whenElse blocks: three anchors, the then-branch between the first two
 * and the else-branch between the last two, the branch the compile-time value selects pre-rendered.
 * An unresolved condition (initialValue undefined) pre-renders neither; the runtime decides at mount.
 */
export const buildWhenElseEdits = (whenElseBlocks: WhenElseBlock[]): TemplateEdit[] => {
  return whenElseBlocks.map((we) => ({
    start: we.startIndex,
    end: we.endIndex,
    replacement:
      anchorMark(we.thenId, '(') +
      (we.initialValue === true ? we.thenTemplate : '') +
      anchorMark(we.thenId, '|') +
      (we.initialValue === false ? we.elseTemplate : '') +
      anchorMark(we.thenId, ')'),
  }));
};

/**
 * Remove attributes that a binding writes as a DOM property (checked, disabled, value, …) from
 * the static markup of their element. The property is set when the element is bound; an
 * attribute left in the template would mean "present" for a boolean, or a stale default for
 * `value`. `class` stays: an empty class attribute is harmless and lets the first write be
 * skipped when the value is empty. A `class:name` toggle is not an attribute at all, and goes too.
 */
export const stripPropertyBoundAttributes = (
  html: string,
  bindings: Array<{ id?: string; elementId?: string; property?: string | undefined; domProperty?: string | undefined }>,
): string => {
  let out = html;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const b of bindings) {
    const toggle = !!b.property?.startsWith('class:');
    if (!b.property || (!toggle && (!b.domProperty || b.domProperty === 'className'))) continue;
    const id = b.id ?? b.elementId;
    if (!id) continue;
    const attr = `\\s${esc(b.property)}(?:="[^"]*"|='[^']*'|(?=[\\s/>]))`;
    const mark = `\\b${BOUND_MARK}="${esc(id)}"`;
    out = out.replace(new RegExp(`(<[^>]*${mark}[^>]*?)${attr}`), '$1');
    out = out.replace(new RegExp(`(<[^>]*?)${attr}([^>]*${mark})`), '$1$2');
  }
  return out;
};

/**
 * Markup whose unquoted attribute values that a removed `${…}` left empty (`<input class= type="checkbox">`) are
 * written as `""`: the browser would read the next attribute as the value. Only the tags are read, outside
 * their quoted values and outside comments.
 */
export const quoteEmptiedValues = (html: string): string => {
  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      const stop = end === -1 ? html.length : end + 3;
      out += html.slice(i, stop);
      i = stop;
      continue;
    }
    if (html[i] !== '<' || !/[A-Za-z]/.test(html[i + 1] ?? '')) {
      out += html[i++];
      continue;
    }
    // A start tag: copied up to its `>`, quoted values as they are
    for (; i < html.length; i++) {
      const ch = html[i]!;
      if (ch === '"' || ch === "'") {
        const close = html.indexOf(ch, i + 1);
        const stop = close === -1 ? html.length : close + 1;
        out += html.slice(i, stop);
        i = stop - 1;
        continue;
      }
      out += ch;
      if (ch === '>') {
        i++;
        break;
      }
      // An unquoted value that is not empty (`href=/about`) is the developer's, and stays
      if (ch === '=' && (/[\s>]/.test(html[i + 1] ?? '') || html.startsWith('/>', i + 1))) out += '""';
    }
  }
  return out;
};

/** Build edits that mark each bound element outside the directive ranges with its binding id (BOUND_MARK). */
export const buildBoundMarkEdits = (elementIdMap: Map<HtmlElement, string>, allRanges: Range[]): TemplateEdit[] => {
  const isInsideRange = buildRangeOverlapChecker(allRanges);
  const edits: TemplateEdit[] = [];

  for (const [element, id] of elementIdMap) {
    if (isInsideRange(element.tagStart)) continue;

    edits.push({
      start: element.tagNameEnd,
      end: element.tagNameEnd,
      replacement: ` ${BOUND_MARK}="${id}"`,
    });
  }

  return edits;
};

/**
 * Build edits to replace ${signal()} expressions with their initial values.
 * Also handles expression text bindings like ${count() + 1}.
 */
export const buildSignalReplacementEdits = (
  signalInitializers: Map<string, string | number | boolean>,
  allRanges: Range[],
  textBindingSpans?: Map<number, { spanId: string; exprEnd: number; signalName: string }>,
  expressionBindingSpans?: Map<number, { spanId: string; exprEnd: number }>,
  inlineExpressionReplacements?: Map<number, { exprEnd: number; replacement: string }>,
): TemplateEdit[] => {
  const isInsideRange = buildRangeOverlapChecker(allRanges);
  const edits: TemplateEdit[] = [];

  // Track positions already handled by expression bindings
  const expressionPositions = new Set<number>();

  if (inlineExpressionReplacements) {
    for (const [exprStart, { exprEnd, replacement }] of inlineExpressionReplacements) {
      if (isInsideRange(exprStart)) continue;
      expressionPositions.add(exprStart);
      edits.push({
        start: exprStart,
        end: exprEnd,
        replacement,
      });
    }
  }

  // ── Expression text bindings (e.g. ${count() + 1}) ──
  // Use comment marker: <!--bN--> with a space placeholder for the text node
  // An empty comment <!----> follows to prevent merging with subsequent static text
  if (expressionBindingSpans) {
    for (const [exprStart, { spanId, exprEnd }] of expressionBindingSpans) {
      if (isInsideRange(exprStart)) continue;
      expressionPositions.add(exprStart);

      edits.push({
        start: exprStart,
        end: exprEnd,
        // Comment marker + space placeholder + boundary comment
        replacement: `<!--${spanId}--> <!---->`,
      });
    }
  }

  // ── Bare signal replacements (e.g. ${count()}) — AST-driven, no regex ──
  if (textBindingSpans) {
    for (const [exprStart, { spanId, exprEnd, signalName }] of textBindingSpans) {
      if (isInsideRange(exprStart)) continue;
      if (expressionPositions.has(exprStart)) continue;

      const value = signalInitializers.get(signalName);
      const valueStr = value !== undefined ? escapeRawTemplateLiteral(String(value)) : '';

      edits.push({
        start: exprStart,
        end: exprEnd,
        // Comment marker + initial value + boundary comment to prevent text merging
        replacement: `<!--${spanId}-->${valueStr || ' '}<!---->`,
      });
    }
  }

  return edits;
};
