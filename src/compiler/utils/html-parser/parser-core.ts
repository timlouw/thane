/**
 * HTML Parser — Core state-machine parser
 */

import type { ParserState, HtmlElement, BindingInfo, ParseDiagnostic, ParsedTemplate } from './types.js';
import { VOID_ELEMENTS } from './types.js';
import {
  findBindingsInText,
  findBindingsInAttributes,
  isEscaped,
  templateExpressionEnd,
  type BindingDetectionOptions,
} from './binding-detection.js';
import { PARSER_STATE } from '../../../contracts/index.js';

/**
 * Mutable builder type used during parsing. All discriminant fields are writable.
 * Narrowed to the HtmlElement union when pushed into the tree.
 */
interface MutableHtmlElement {
  tagName: string;
  tagStart: number;
  tagNameEnd: number;
  openTagEnd: number;
  closeTagStart: number;
  closeTagEnd: number;
  attributes: Map<string, import('./types.js').AttributeInfo>;
  children: HtmlElement[];
  parent: HtmlElement | null;
  isSelfClosing: boolean;
  isVoid: boolean;
  textContent: import('./types.js').TextNode[];
  whenDirective?: string | undefined;
  whenDirectiveStart?: number | undefined;
  whenDirectiveEnd?: number | undefined;
  /** The other `${…}`s alone in the tag (an element ref), as written, with their spans */
  tagValues?: { text: string; start: number; end: number }[] | undefined;
}

function createEmptyElement(tagName: string, tagStart: number, tagNameEnd: number): MutableHtmlElement {
  const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());
  return {
    tagName,
    tagStart,
    tagNameEnd,
    openTagEnd: 0,
    closeTagStart: 0,
    closeTagEnd: 0,
    attributes: new Map(),
    children: [],
    parent: null,
    isSelfClosing: false,
    isVoid,
    textContent: [],
    whenDirective: undefined,
    whenDirectiveStart: undefined,
    whenDirectiveEnd: undefined,
  };
}

export function parseHtmlTemplate(html: string, options?: BindingDetectionOptions): ParsedTemplate {
  const roots: HtmlElement[] = [];
  const bindings: BindingInfo[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  let state: ParserState = PARSER_STATE.TEXT;
  let pos = 0;

  let currentElement: MutableHtmlElement | null = null;
  let elementStack: HtmlElement[] = [];

  let tagName = '';
  let tagStart = 0;
  let attrName = '';
  let attrValue = '';
  let attrStart = 0;
  let attrValueStart = 0;
  let quoteChar = '';

  let textStart = 0;
  let textContent = '';

  let commentBuffer = '';

  const flushText = () => {
    if (textContent.trim()) {
      const parent = elementStack[elementStack.length - 1];
      if (parent) {
        parent.textContent.push({
          content: textContent,
          start: textStart,
          end: pos,
        });
        findBindingsInText(textContent, textStart, parent, bindings, options);
      } else {
        const virtualRoot: HtmlElement = {
          tagName: '__root__',
          tagStart: 0,
          tagNameEnd: 0,
          openTagEnd: 0,
          closeTagStart: 0,
          closeTagEnd: 0,
          attributes: new Map(),
          children: [],
          parent: null,
          isSelfClosing: false,
          isVoid: false,
          textContent: [],
        };
        findBindingsInText(textContent, textStart, virtualRoot, bindings, options);
      }
    }
    textContent = '';
  };

  const pushElement = (mutable: MutableHtmlElement): HtmlElement => {
    const element = mutable as HtmlElement;
    const parent = elementStack[elementStack.length - 1];
    if (parent) {
      parent.children.push(element);
      element.parent = parent;
    } else {
      roots.push(element);
    }
    if (!element.isSelfClosing && !element.isVoid) {
      elementStack.push(element);
    }
    return element;
  };

  const closeElement = (closingTagName: string, closeStart: number, closeEnd: number) => {
    for (let i = elementStack.length - 1; i >= 0; i--) {
      const stackElement = elementStack[i];
      if (stackElement && stackElement.tagName.toLowerCase() === closingTagName.toLowerCase()) {
        // Report any implicitly closed (skipped) elements between the match and the stack top
        for (let j = elementStack.length - 1; j > i; j--) {
          const skipped = elementStack[j];
          if (skipped) {
            diagnostics.push({
              message: `Unclosed tag <${skipped.tagName}> (implicitly closed by </${closingTagName}>)`,
              position: skipped.tagStart,
              severity: 'warning',
            });
          }
        }
        stackElement.closeTagStart = closeStart;
        stackElement.closeTagEnd = closeEnd;
        elementStack.length = i;
        return;
      }
    }
    // No matching open tag found
    diagnostics.push({
      message: `Orphaned closing tag </${closingTagName}> with no matching open tag`,
      position: closeStart,
      severity: 'error',
    });
  };

  /** Record the attribute; a duplicate is ignored, as browsers keep the first. */
  const setAttribute = (value: string, end: number, valueStart: number, valueEnd: number) => {
    if (currentElement!.attributes.has(attrName)) {
      const message = `Duplicate attribute "${attrName}" on <${currentElement!.tagName}>: the first one is kept`;
      diagnostics.push({ message, position: attrStart, severity: 'warning' });
      return;
    }
    currentElement!.attributes.set(attrName, { name: attrName, value, start: attrStart, end, valueStart, valueEnd });
  };

  /** Close the open tag at `end` (just past its `>`), push the element and go back to text. */
  const finishOpenTag = (end: number, selfClosing: boolean) => {
    const element = currentElement!;
    if (selfClosing) element.isSelfClosing = true;
    element.openTagEnd = end;
    if (selfClosing || element.isVoid) {
      element.closeTagStart = end;
      element.closeTagEnd = end;
    }
    findBindingsInAttributes(pushElement(element), bindings, options);
    currentElement = null;
    state = PARSER_STATE.TEXT;
    textContent = '';
    textStart = end;
  };

  while (pos < html.length) {
    const char = html[pos]!;
    const nextChar = html[pos + 1];

    switch (state) {
      case PARSER_STATE.TEXT:
        if (char === '$' && nextChar === '{' && !isEscaped(html, pos)) {
          // An expression is text up to its closing brace, whatever it holds; unclosed, to the end
          const end = templateExpressionEnd(html, pos);
          if (textContent === '') textStart = pos;
          textContent += html.slice(pos, end === -1 ? html.length : end);
          pos = end === -1 ? html.length : end;
          continue;
        }

        if (char === '<') {
          flushText();
          if (nextChar === '!') {
            if (html.substring(pos, pos + 4) === '<!--') {
              state = PARSER_STATE.COMMENT;
              commentBuffer = '';
              pos += 4;
              continue;
            }
          }
          tagStart = pos;
          state = PARSER_STATE.TAG_OPEN;
        } else {
          if (textContent === '') {
            textStart = pos;
          }
          textContent += char;
        }
        break;

      case PARSER_STATE.TAG_OPEN:
        if (char === '/') {
          state = PARSER_STATE.TAG_CLOSE;
          tagName = '';
        } else if (/[a-zA-Z]/.test(char)) {
          state = PARSER_STATE.TAG_NAME;
          tagName = char;
        } else {
          state = PARSER_STATE.TEXT;
          textContent += '<' + char;
          textStart = tagStart;
        }
        break;

      case PARSER_STATE.TAG_NAME:
        if (/[\w\-:]/.test(char)) {
          tagName += char;
        } else if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
          state = PARSER_STATE.TAG_SPACE;
          currentElement = createEmptyElement(tagName, tagStart, pos);
        } else if (char === '>') {
          currentElement = createEmptyElement(tagName, tagStart, pos);
          finishOpenTag(pos + 1, false);
        } else if (char === '/' && nextChar === '>') {
          currentElement = createEmptyElement(tagName, tagStart, pos);
          finishOpenTag(pos + 2, true);
          pos++;
        } else {
          // A character that cannot continue a tag name, most likely after a missing space
          // (`<button@click=…>`): it is reported, and read again as the start of the attributes
          diagnostics.push({
            message: `Missing space after <${tagName}: "${char}" cannot be part of a tag name, and is read as the start of an attribute`,
            position: pos,
            severity: 'error',
          });
          currentElement = createEmptyElement(tagName, tagStart, pos);
          state = PARSER_STATE.TAG_SPACE;
          continue;
        }
        break;

      case PARSER_STATE.TAG_SPACE:
        if (char === '>') {
          finishOpenTag(pos + 1, false);
        } else if (char === '/' && nextChar === '>') {
          finishOpenTag(pos + 2, true);
          pos++;
        } else if (char === '$' && html.substring(pos, pos + 7) === '${when(') {
          const directiveEnd = templateExpressionEnd(html, pos);
          if (directiveEnd !== -1) {
            currentElement!.whenDirective = html.substring(pos, directiveEnd);
            currentElement!.whenDirectiveStart = pos;
            currentElement!.whenDirectiveEnd = directiveEnd;
            pos = directiveEnd - 1;
          }
        } else if (char === '$' && nextChar === '{') {
          const valueEnd = templateExpressionEnd(html, pos);
          if (valueEnd !== -1) {
            (currentElement!.tagValues ??= []).push({ text: html.substring(pos, valueEnd), start: pos, end: valueEnd });
            pos = valueEnd - 1;
          }
        } else if (/[a-zA-Z_:@]/.test(char)) {
          state = PARSER_STATE.ATTR_NAME;
          attrName = char;
          attrStart = pos;
        }
        break;

      case PARSER_STATE.ATTR_NAME:
        if (/[\w\-:@.]/.test(char)) {
          attrName += char;
        } else if (char === '=') {
          state = PARSER_STATE.ATTR_EQ;
        } else if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
          let lookAhead = pos + 1;
          while (lookAhead < html.length && /\s/.test(html[lookAhead]!)) {
            lookAhead++;
          }
          if (lookAhead < html.length && html[lookAhead] === '=') {
            pos = lookAhead - 1;
            state = PARSER_STATE.ATTR_NAME;
          } else {
            setAttribute('', pos, pos, pos);
            state = PARSER_STATE.TAG_SPACE;
          }
        } else if (char === '>') {
          setAttribute('', pos, pos, pos);
          finishOpenTag(pos + 1, false);
        }
        break;

      case PARSER_STATE.ATTR_EQ:
        if (char === '"' || char === "'") {
          quoteChar = char;
          attrValue = '';
          attrValueStart = pos + 1;
          state = PARSER_STATE.ATTR_VALUE_Q;
        } else if (char === '$' && nextChar === '{') {
          const valueEnd = templateExpressionEnd(html, pos);
          if (valueEnd !== -1) {
            setAttribute(html.substring(pos, valueEnd), valueEnd, pos, valueEnd);
            pos = valueEnd - 1;
            state = PARSER_STATE.TAG_SPACE;
          }
        } else if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') {
          attrValue = char;
          attrValueStart = pos;
          state = PARSER_STATE.ATTR_VALUE_UQ;
        }
        break;

      case PARSER_STATE.ATTR_VALUE_Q:
      case PARSER_STATE.ATTR_VALUE_UQ:
        if (char === '$' && nextChar === '{' && !isEscaped(html, pos)) {
          // An expression is part of the value up to its closing brace, whatever quotes it holds:
          // `class="${on() ? "a" : "b"}"` is one value
          const end = templateExpressionEnd(html, pos);
          attrValue += html.slice(pos, end === -1 ? html.length : end);
          pos = end === -1 ? html.length : end;
          continue;
        }
        if (state === PARSER_STATE.ATTR_VALUE_Q) {
          if (char === quoteChar) {
            setAttribute(attrValue, pos + 1, attrValueStart, pos);
            state = PARSER_STATE.TAG_SPACE;
          } else {
            attrValue += char;
          }
          break;
        }
        if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
          setAttribute(attrValue, pos, attrValueStart, pos);
          state = PARSER_STATE.TAG_SPACE;
        } else if (char === '>') {
          setAttribute(attrValue, pos, attrValueStart, pos);
          finishOpenTag(pos + 1, false);
        } else {
          attrValue += char;
        }
        break;

      case PARSER_STATE.TAG_CLOSE:
        if (/[\w\-:]/.test(char)) {
          tagName += char;
        } else if (char === '>') {
          flushText();
          closeElement(tagName, tagStart, pos + 1);
          state = PARSER_STATE.TEXT;
          textContent = '';
          textStart = pos + 1;
        }
        break;

      case PARSER_STATE.COMMENT:
        commentBuffer += char;
        if (commentBuffer.endsWith('-->')) {
          state = PARSER_STATE.TEXT;
          textContent = '';
          textStart = pos + 1;
        }
        break;

      default: {
        const exhaustive: never = state;
        throw new Error(`Unhandled parser state: ${String(exhaustive)}`);
      }
    }

    pos++;
  }

  flushText();

  // Report any tags still open at end of input
  for (let i = elementStack.length - 1; i >= 0; i--) {
    const unclosed = elementStack[i];
    if (unclosed) {
      diagnostics.push({
        message: `Unclosed tag <${unclosed.tagName}> (reached end of template)`,
        position: unclosed.tagStart,
        severity: 'error',
      });
    }
  }

  return { roots, bindings, html, diagnostics };
}
