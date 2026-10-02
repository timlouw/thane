/**
 * Event handler types for the type check.
 *
 * To TypeScript, `@click=${handler}` in a template is one more substitution, and `html` takes any
 * value: a handler that expects a `KeyboardEvent` passed on a click, and the `e` of an untyped
 * `(e) => …` was `any`. For the type check only, each handler the compiler registers as the
 * listener (an arrow function, a function expression, or a reference such as `onClick` or
 * `menu.close`) is rewritten as
 *
 *   @click=${(handler) satisfies ThaneEventListener<'click'>}
 *
 * which gives an untyped parameter the event's type (`MouseEvent`) and reports a handler that takes
 * another one. Outside a list row the handler is the element's own listener, so its `currentTarget`
 * is typed as the element too (`ThaneEventListener<'input', 'input'>`: an `HTMLInputElement`); a
 * row's handler is delegated to the list container, and keeps `EventTarget | null`. An event that
 * lib.dom does not know, such as a custom event, is typed `any`, as before. Any other expression, such as `navigate('/')`, runs on the event and is checked as
 * written. The rewritten text is only ever read by the type checker, and its diagnostics are
 * mapped back to the source as written.
 */

import ts from 'typescript';
import { FN } from '../../utils/constants.js';

/** The declaration of `ThaneEventListener`, a global type of the checked program only. */
export const EVENT_TYPES_DECLARATION =
  '/** The type of an `@event=${handler}` handler: the event lib.dom gives the name (or any), on the element of the tag `T` */\n' +
  "type ThaneEventListener<K extends string, T extends string = ''> = (\n" +
  '  event: (K extends keyof HTMLElementEventMap ? HTMLElementEventMap[K] : any) &\n' +
  '    (T extends keyof HTMLElementTagNameMap\n' +
  '      ? { readonly currentTarget: HTMLElementTagNameMap[T] }\n' +
  '      : T extends keyof SVGElementTagNameMap\n' +
  '        ? { readonly currentTarget: SVGElementTagNameMap[T] }\n' +
  '        : unknown),\n' +
  ') => unknown;\n';

/** A source rewritten for the type check, and the way back from its positions to the source's. */
export interface RewrittenSource {
  text: string;
  /**
   * The span in the source as written of a span in `text`. One that starts in inserted text, such as
   * an error reported on the inserted type, is the whole handler's.
   */
  toOriginal: (start: number, length: number) => { start: number; length: number };
  /** The position in `text` of a position in the source as written (inside a handler: the same code) */
  toRewritten: (position: number) => number;
  /** Whether a position in the source as written is inside a typed handler, its ends included */
  inHandler: (position: number) => boolean;
}

interface Insertion {
  at: number;
  text: string;
  /** The handler the insertion types, in the source as written */
  handler: { start: number; end: number };
}

/** The attribute a substitution is the whole value of: `@click.prevent=` or `@click="`, at the end of the text before it. */
const EVENT_ATTRIBUTE = /\s@([A-Za-z][\w-]*)(?:\.[\w-]+)*=(["']?)$/;

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

/** The insertions that type each event handler of every `html` template in the file. */
const eventHandlerInsertions = (sourceFile: ts.SourceFile): Insertion[] => {
  const insertions: Insertion[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === FN.HTML &&
      ts.isTemplateExpression(node.template)
    ) {
      const { head, templateSpans } = node.template;
      const inRow = isInRow(node);
      // The template's text so far, each substitution standing as one character: where the open tag is
      let markup = rawText(head);
      templateSpans.forEach((span, i) => {
        if (i > 0) markup += '_' + rawText(templateSpans[i - 1]!.literal);
        const before = rawText(i === 0 ? head : templateSpans[i - 1]!.literal);
        const match = EVENT_ATTRIBUTE.exec(before);
        if (!match) return;
        // The substitution is the attribute's whole value: a closing quote, if any, then the tag goes on
        const after = rawText(span.literal);
        const quote = match[2]!;
        const rest = after.slice(quote.length);
        const ends = /^[\s/>]/.test(rest) || (rest === '' && ts.isTemplateTail(span.literal));
        if (!after.startsWith(quote) || !ends) return;
        if (!isListenerValue(span.expression, sourceFile)) return;
        const handler = { start: span.expression.getStart(sourceFile), end: span.expression.end };
        const tag = inRow ? '' : openTagName(markup);
        const type = tag ? `ThaneEventListener<'${match[1]!}', '${tag}'>` : `ThaneEventListener<'${match[1]!}'>`;
        insertions.push(
          { at: handler.start, text: '(', handler },
          { at: handler.end, text: `) satisfies ${type}`, handler },
        );
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return insertions.sort((a, b) => a.at - b.at);
};

/**
 * The file with each template event handler typed, or null when it has none. Only a file that
 * could hold one (an `@` and an `html` tag in it) is parsed.
 */
export const rewriteEventHandlers = (fileName: string, text: string): RewrittenSource | null => {
  if (!text.includes('@') || !text.includes(`${FN.HTML}\``)) return null;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const insertions = eventHandlerInsertions(sourceFile);
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
      const { handler } = from.insertion;
      return { start: handler.start, length: handler.end - handler.start };
    }
    return { start: from.position, length: Math.max(0, locate(start + length).position - from.position) };
  };
  // A handler's opening insertion is before the handler's first character, its closing one after its last
  const toRewritten = (position: number): number => {
    let shift = 0;
    for (const insertion of insertions) {
      if (insertion.at > position || (insertion.at === position && insertion.text !== '(')) break;
      shift += insertion.text.length;
    }
    return position + shift;
  };
  const inHandler = (position: number): boolean =>
    insertions.some(({ handler }) => position >= handler.start && position <= handler.end);
  return { text: rewritten, toOriginal, toRewritten, inHandler };
};
