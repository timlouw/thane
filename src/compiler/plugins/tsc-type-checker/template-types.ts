/**
 * Template value types for the type check.
 *
 * To TypeScript, every `${…}` in a template is one more substitution, and `html` takes any value: a handler
 * that expects a `KeyboardEvent` passed on a click, the `e` of an untyped `(e) => …` was `any`, and
 * `${user()}` (an object, shown as `[object Object]`) or a promise type-checked. For the type check only, each
 * substitution of an `html` template is rewritten with the type its position takes:
 *
 * - content, `<p>${value}</p>`: `(value) satisfies ThaneContent`, text, a number, true or false, nothing (null or
 *   undefined), or templates (a Fragment, or a list of them);
 * - an attribute's value, `<p class=${value}>`: `(value) satisfies ThaneAttribute`, text, a number, true or false,
 *   or nothing;
 * - alone in an element's tag, `<input ${value}>`: `__thaneTag<'input'>()(value)`, a `when()` or an element ref
 *   for that kind of element;
 * - a two-way binding, `<input bind:value=${name}>`: `(name) satisfies ThaneBind<'value'>`, a writable signal of a
 *   string (of a boolean for `bind:checked`);
 * - an event attribute's handler, as follows.
 *
 * Each handler the compiler registers as the listener (an arrow function, a function expression, or a reference
 * such as `onClick` or `menu.close`) is rewritten as
 *
 *   @click=${(handler) satisfies ThaneEventListener<'click'>}
 *
 * which gives an untyped parameter the event's type (`MouseEvent`) and reports a handler that takes
 * another one. Outside a list row the handler is the element's own listener, so its `currentTarget`
 * is typed as the element too (`ThaneEventListener<'input', 'input'>`: an `HTMLInputElement`); a
 * row's handler is delegated to the list container, and keeps `EventTarget | null`. An event that
 * lib.dom does not know, such as a custom event, is typed `any`, as before. Any other expression, such as
 * `navigate('/')`, runs on the event, and nothing reads its value: it is rewritten as `__thaneEventCall(expression)`,
 * which rejects a value that is a function (`@click=${makeHandler(id)}`, `@click=${open() ? close : show}`): that
 * handler would never be called. The rewritten text is only ever read by the type checker, and its diagnostics are
 * mapped back to the source as written.
 */

import ts from 'typescript';
import { FN } from '../../utils/constants.js';
import { needsOwnListener } from '../../utils/event-modifiers.js';

/** The declaration of the types the rewrite names, globals of the checked program only. */
export const TEMPLATE_TYPES_DECLARATION =
  "/** What a `${…}` in a template's content shows: text, a number, true or false, nothing (null or undefined), or templates */\n" +
  "type ThaneContent = string | number | boolean | null | undefined | import('thane').Fragment | ReadonlyArray<import('thane').Fragment>;\n" +
  "/** What a `${…}` in an element's tag gives an attribute: text, a number, true or false, or nothing (null or undefined) */\n" +
  'type ThaneAttribute = string | number | boolean | null | undefined;\n' +
  "/** The element of a tag: lib.dom's for its name, never (no check) for one lib.dom does not know */\n" +
  'type ThaneElement<K extends string> = K extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[K] : K extends keyof SVGElementTagNameMap ? SVGElementTagNameMap[K] : never;\n' +
  '/** A `${…}` alone in a tag: a when() (a string), or a ref for that kind of element */\n' +
  'type ThaneTagCheck<K extends string, V> = V extends string\n' +
  '  ? unknown\n' +
  "  : V extends import('thane').Ref<infer T>\n" +
  '    ? ThaneElement<K> extends T\n' +
  '      ? unknown\n' +
  "      : 'this ref is for another kind of element than the tag it is in'\n" +
  '    : "a ${…} alone in an element\'s tag is when(condition) or an element ref";\n' +
  'declare function __thaneTag<K extends string>(): <V>(value: V & ThaneTagCheck<K, V>) => void;\n' +
  "/** What bind:value and bind:checked take: a signal they write, of the property's type */\n" +
  "type ThaneBind<P extends string> = import('thane').Signal<P extends 'checked' ? boolean : string>;\n" +
  '/** The type of an `@event=${handler}` handler: the event lib.dom gives the name (or any), on the element of the tag `T` */\n' +
  "type ThaneEventListener<K extends string, T extends string = ''> = (\n" +
  '  event: (K extends keyof HTMLElementEventMap ? HTMLElementEventMap[K] : any) &\n' +
  '    (T extends keyof HTMLElementTagNameMap\n' +
  '      ? { readonly currentTarget: HTMLElementTagNameMap[T] }\n' +
  '      : T extends keyof SVGElementTagNameMap\n' +
  '        ? { readonly currentTarget: SVGElementTagNameMap[T] }\n' +
  '        : unknown),\n' +
  ') => unknown;\n' +
  '/** An `@event=${…}` that is not a handler runs on the event, and nothing reads its value: a function there is never called */\n' +
  'declare function __thaneEventCall<T>(\n' +
  '  value: T extends (...args: never[]) => unknown\n' +
  "    ? 'this runs on the event and its value is a function, which nothing calls: pass the handler itself, @click=${handler}, or call it, @click=${(e) => handler(e)}'\n" +
  '    : T,\n' +
  '): void;\n';

/** A source rewritten for the type check, and the way back from its positions to the source's. */
export interface RewrittenSource {
  text: string;
  /**
   * The span in the source as written of a span in `text`. One that starts in inserted text, such as
   * an error reported on the inserted type, is the whole substitution's.
   */
  toOriginal: (start: number, length: number) => { start: number; length: number };
  /** The position in `text` of a position in the source as written (inside a substitution: the same code) */
  toRewritten: (position: number) => number;
  /** Whether a position in the source as written is inside a typed substitution, its ends included */
  inSlot: (position: number) => boolean;
}

interface Insertion {
  at: number;
  text: string;
  /** Whether it opens the substitution's rewrite (it goes before the substitution's first character) */
  opens: boolean;
  /** The substitution the insertion types, in the source as written */
  slot: { start: number; end: number };
  /** How many html templates hold the substitution: at one position, an outer one opens first and closes last */
  depth: number;
}

/** The attribute a substitution is the whole value of: `@click.prevent=` or `@click="`, at the end of the text before it. */
const EVENT_ATTRIBUTE = /\s@([A-Za-z][\w-]*)((?:\.[\w-]+)*)=(["']?)$/;

/** What the compiler registers as the listener itself: a function, or a plain or member reference. */
const isListenerValue = (expression: ts.Expression, sourceFile: ts.SourceFile): boolean => {
  let node = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
  return /^[A-Za-z_$][\w$.]*$/.test(expression.getText(sourceFile));
};

/** The text of a template literal part, as written. */
const rawText = (part: ts.TemplateLiteralLikeNode): string => part.rawText ?? part.text;

/** The name of the tag still open at the end of `markup` (the element an attribute belongs to), or '' */
const openTagName = (markup: string): string => /<([a-zA-Z][\w-]*)[^<>]*$/.exec(markup)?.[1]?.toLowerCase() ?? '';

/**
 * Whether a template is (inside) a list row: a function that is `repeat()`'s row argument holds it, or the
 * callback of a `.map()` in a template, which the compiler turns into a repeat()
 */
const isInRow = (node: ts.Node): boolean => {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    const call: ts.Node | undefined = at.parent;
    if (!(ts.isArrowFunction(at) || ts.isFunctionExpression(at)) || !call || !ts.isCallExpression(call)) continue;
    const callee = call.expression;
    if (ts.isIdentifier(callee) && callee.text === FN.REPEAT && call.arguments[1] === at) return true;
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'map' && call.arguments[0] === at) return true;
  }
  return false;
};

/** Whether `markup` (a template's text so far) ends inside an element's tag */
const inTag = (markup: string): boolean => /<[a-zA-Z][\w-]*[^<>]*$/.test(markup);

/** Whether `markup`, which ends inside a tag, ends where an attribute's value goes: after `=`, or in quotes */
const inAttributeValue = (markup: string): boolean => {
  const tag = /<[a-zA-Z][\w-]*[^<>]*$/.exec(markup)?.[0] ?? '';
  const quotes = (quote: string): number => tag.split(quote).length - 1;
  // After `=`, past other substitutions of the same value (`=${a}${b}`, each `_` in the markup)
  return /=\s*_*$/.test(tag) || quotes('"') % 2 === 1 || quotes("'") % 2 === 1;
};

const isHtmlTemplate = (node: ts.Node): node is ts.TaggedTemplateExpression & { template: ts.TemplateExpression } =>
  ts.isTaggedTemplateExpression(node) &&
  ts.isIdentifier(node.tag) &&
  node.tag.text === FN.HTML &&
  ts.isTemplateExpression(node.template);

/** The insertions that type each substitution of every `html` template in the file. */
const templateInsertions = (sourceFile: ts.SourceFile): Insertion[] => {
  const insertions: Insertion[] = [];
  const visit = (node: ts.Node, depth: number): void => {
    if (isHtmlTemplate(node)) {
      const { head, templateSpans } = node.template;
      const inRow = isInRow(node);
      // The template's text so far, each substitution standing as one character: where the open tag is
      let markup = rawText(head);
      templateSpans.forEach((span, i) => {
        if (i > 0) markup += '_' + rawText(templateSpans[i - 1]!.literal);
        const slot = { start: span.expression.getStart(sourceFile), end: span.expression.end };
        const wrap = (open: string, close: string): void => {
          insertions.push(
            { at: slot.start, text: open, slot, opens: true, depth },
            { at: slot.end, text: close, slot, opens: false, depth },
          );
        };
        const before = rawText(i === 0 ? head : templateSpans[i - 1]!.literal);
        const match = EVENT_ATTRIBUTE.exec(before);
        // An event attribute's whole value: a closing quote, if any, then the tag goes on
        const after = rawText(span.literal);
        const quote = match?.[3] ?? '';
        const rest = after.slice(quote.length);
        const whole =
          !!match &&
          after.startsWith(quote) &&
          (/^[\s/>]/.test(rest) || (rest === '' && ts.isTemplateTail(span.literal)));
        if (match && whole) {
          if (!isListenerValue(span.expression, sourceFile)) return wrap('__thaneEventCall(', ')');
          // A row's handler is delegated to the list container, unless a modifier gives it its element's own listener
          const ownListener = !inRow || needsOwnListener(match[2]!.split('.').slice(1));
          const tag = ownListener ? openTagName(markup) : '';
          const type = tag ? `ThaneEventListener<'${match[1]!}', '${tag}'>` : `ThaneEventListener<'${match[1]!}'>`;
          return wrap('(', `) satisfies ${type}`);
        }
        if (!inTag(markup)) return wrap('(', ') satisfies ThaneContent');
        // bind:value=${name}: a signal the binding writes, of the property's type
        const bound = /\sbind:(value|checked)=["']?$/.exec(before);
        if (bound) return wrap('(', `) satisfies ThaneBind<'${bound[1]!}'>`);
        if (inAttributeValue(markup)) return wrap('(', ') satisfies ThaneAttribute');
        wrap(`__thaneTag<'${openTagName(markup)}'>()(`, ')');
      });
    }
    ts.forEachChild(node, (child) => visit(child, isHtmlTemplate(node) ? depth + 1 : depth));
  };
  visit(sourceFile, 0);
  // At one position, an outer substitution opens before an inner one and closes after it
  return insertions.sort((a, b) => a.at - b.at || (a.opens ? a.depth - b.depth : b.depth - a.depth));
};

/**
 * The file with each substitution of its `html` templates typed, or null when it has none. Only a file that
 * could hold one (an `html` template with a `${`) is read, from `parsed` (a parse of `text` with its parent
 * nodes set) or a parse of its own.
 */
export const rewriteTemplates = (fileName: string, text: string, parsed?: ts.SourceFile): RewrittenSource | null => {
  if (!text.includes(`${FN.HTML}\``) || !text.includes('${')) return null;
  const sourceFile =
    parsed?.text === text
      ? parsed
      : ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const insertions = templateInsertions(sourceFile);
  if (insertions.length === 0) return null;

  let rewritten = '';
  let from = 0;
  for (const insertion of insertions) {
    rewritten += text.slice(from, insertion.at) + insertion.text;
    from = insertion.at;
  }
  rewritten += text.slice(from);

  /** A position in the source as written, and the insertion it is inside, if any */
  const locate = (position: number): { position: number; insertion?: Insertion } => {
    let shift = 0;
    for (const insertion of insertions) {
      const at = insertion.at + shift;
      if (position < at) break;
      if (position < at + insertion.text.length) return { position: insertion.at, insertion };
      shift += insertion.text.length;
    }
    return { position: position - shift };
  };
  const toOriginal = (start: number, length: number): { start: number; length: number } => {
    const from = locate(start);
    if (from.insertion) {
      const { slot } = from.insertion;
      return { start: slot.start, length: slot.end - slot.start };
    }
    return { start: from.position, length: Math.max(0, locate(start + length).position - from.position) };
  };
  // A substitution's opening insertion is before its first character, its closing one after its last
  const toRewritten = (position: number): number => {
    let shift = 0;
    for (const insertion of insertions) {
      if (insertion.at > position || (insertion.at === position && !insertion.opens)) break;
      shift += insertion.text.length;
    }
    return position + shift;
  };
  const inSlot = (position: number): boolean =>
    insertions.some(({ slot }) => position >= slot.start && position <= slot.end);
  return { text: rewritten, toOriginal, toRewritten, inSlot };
};
