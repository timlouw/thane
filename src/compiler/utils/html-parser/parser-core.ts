/**
 * HTML Parser — Core state-machine parser
 */

import type { ParserState, HtmlElement, BindingInfo, ParseDiagnostic, ParsedTemplate } from './types.js';
import { VOID_ELEMENTS } from './types.js';
import { findBindingsInText, findBindingsInAttributes } from './binding-detection.js';

function createEmptyElement(tagName: string, tagStart: number, tagNameEnd: number): HtmlElement {
  const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());
  return {
    tagName,
    tagStart,
    tagNameEnd: tagNameEnd,
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
  } as HtmlElement;
}

export function parseHtmlTemplate(html: string): ParsedTemplate {
  const roots: HtmlElement[] = [];
  const bindings: BindingInfo[] = [];
  const diagnostics: ParseDiagnostic[] = [];

  let state: ParserState = 'TEXT';
  let pos = 0;

  let currentElement: HtmlElement | null = null;
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

  let exprBraceDepth = 0;
  let inTemplateBacktick = false;
  let templateBraceDepth = 0;

  const flushText = () => {
    if (textContent.trim()) {
      const parent = elementStack[elementStack.length - 1];
      if (parent) {
        parent.textContent.push({
          content: textContent,
          start: textStart,
          end: pos,
        });
        findBindingsInText(textContent, textStart, parent, bindings);
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
        } as HtmlElement;
        findBindingsInText(textContent, textStart, virtualRoot, bindings);
      }
    }
    textContent = '';
  };

  const pushElement = (element: HtmlElement) => {
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

  while (pos < html.length) {
    const char = html[pos]!;
    const nextChar = html[pos + 1];

    switch (state) {
      case 'TEXT':
        if (char === '$' && nextChar === '{' && !inTemplateBacktick) {
          if (textContent === '') {
            textStart = pos;
          }
          textContent += '${';
          pos += 2;
          exprBraceDepth = 1;
          continue;
        }

        if (exprBraceDepth > 0) {
          if (textContent === '') {
            textStart = pos;
          }

          if (inTemplateBacktick) {
            if (char === '$' && nextChar === '{') {
              templateBraceDepth++;
              textContent += '${';
              pos += 2;
              continue;
            }
            if (char === '}' && templateBraceDepth > 0) {
              templateBraceDepth--;
              textContent += char;
              pos++;
              continue;
            }
            if (char === '`' && templateBraceDepth === 0) {
              inTemplateBacktick = false;
              textContent += char;
              pos++;
              continue;
            }
            textContent += char;
            pos++;
            continue;
          }

          if (char === '`') {
            inTemplateBacktick = true;
            templateBraceDepth = 0;
            textContent += char;
            pos++;
            continue;
          }
          if (char === '{') {
            exprBraceDepth++;
            textContent += char;
            pos++;
            continue;
          }
          if (char === '}') {
            exprBraceDepth--;
            textContent += char;
            pos++;
            if (exprBraceDepth === 0) {
            }
            continue;
          }
          textContent += char;
          pos++;
          continue;
        }

        if (char === '<') {
          flushText();
          if (nextChar === '!') {
            if (html.substring(pos, pos + 4) === '<!--') {
              state = 'COMMENT';
              commentBuffer = '';
              pos += 4;
              continue;
            }
          }
          tagStart = pos;
          state = 'TAG_OPEN';
        } else {
          if (textContent === '') {
            textStart = pos;
          }
          textContent += char;
        }
        break;

      case 'TAG_OPEN':
        if (char === '/') {
          state = 'TAG_CLOSE';
          tagName = '';
        } else if (/[a-zA-Z]/.test(char)) {
          state = 'TAG_NAME';
          tagName = char;
        } else {
          state = 'TEXT';
          textContent += '<' + char;
        }
        break;

      case 'TAG_NAME':
        if (/[\w\-:]/.test(char)) {
          tagName += char;
        } else if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
          state = 'TAG_SPACE';
          currentElement = createEmptyElement(tagName, tagStart, pos);
        } else if (char === '>') {
          currentElement = createEmptyElement(tagName, tagStart, pos);
          currentElement.openTagEnd = pos + 1;
          if (currentElement.isVoid) {
            currentElement.closeTagStart = pos + 1;
            currentElement.closeTagEnd = pos + 1;
          }
          pushElement(currentElement);
          findBindingsInAttributes(currentElement, bindings);
          currentElement = null;
          state = 'TEXT';
          textContent = '';
          textStart = pos + 1;
        } else if (char === '/' && nextChar === '>') {
          currentElement = createEmptyElement(tagName, tagStart, pos);
          (currentElement as any).isSelfClosing = true;
          currentElement.openTagEnd = pos + 2;
          currentElement.closeTagStart = pos + 2;
          currentElement.closeTagEnd = pos + 2;
          pushElement(currentElement);
          findBindingsInAttributes(currentElement, bindings);
          currentElement = null;
          state = 'TEXT';
          pos++;
          textContent = '';
          textStart = pos + 1;
        }
        break;

      case 'TAG_SPACE':
        if (char === '>') {
          currentElement!.openTagEnd = pos + 1;
          if (currentElement!.isVoid) {
            currentElement!.closeTagStart = pos + 1;
            currentElement!.closeTagEnd = pos + 1;
          }
          pushElement(currentElement!);
          findBindingsInAttributes(currentElement!, bindings);
          currentElement = null;
          state = 'TEXT';
          textContent = '';
          textStart = pos + 1;
        } else if (char === '/' && nextChar === '>') {
          (currentElement as any).isSelfClosing = true;
          currentElement!.openTagEnd = pos + 2;
          currentElement!.closeTagStart = pos + 2;
          currentElement!.closeTagEnd = pos + 2;
          pushElement(currentElement!);
          findBindingsInAttributes(currentElement!, bindings);
          currentElement = null;
          state = 'TEXT';
          pos++;
          textContent = '';
          textStart = pos + 1;
        } else if (char === '"' && html.substring(pos, pos + 8) === '"${when(') {
          const directiveStart = pos;
          let braceDepth = 0;
          let i = pos + 2;
          while (i < html.length) {
            if (html[i] === '{') braceDepth++;
            else if (html[i] === '}') {
              braceDepth--;
              if (braceDepth === 0 && html[i + 1] === '"') {
                const directiveEnd = i + 2;
                const directive = html.substring(directiveStart, directiveEnd);
                (currentElement as any).whenDirective = directive;
                (currentElement as any).whenDirectiveStart = directiveStart;
                (currentElement as any).whenDirectiveEnd = directiveEnd;
                pos = directiveEnd - 1;
                break;
              }
            }
            i++;
          }
          state = 'TAG_SPACE';
        } else if (/[a-zA-Z_:@]/.test(char)) {
          state = 'ATTR_NAME';
          attrName = char;
          attrStart = pos;
        }
        break;

      case 'ATTR_NAME':
        if (/[\w\-:@.]/.test(char)) {
          attrName += char;
        } else if (char === '=') {
          state = 'ATTR_EQ';
        } else if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
          let lookAhead = pos + 1;
          while (lookAhead < html.length && /\s/.test(html[lookAhead]!)) {
            lookAhead++;
          }
          if (lookAhead < html.length && html[lookAhead] === '=') {
            pos = lookAhead - 1;
            state = 'ATTR_NAME';
          } else {
            currentElement!.attributes.set(attrName, {
              name: attrName,
              value: '',
              start: attrStart,
              end: pos,
              valueStart: pos,
              valueEnd: pos,
            });
            state = 'TAG_SPACE';
          }
        } else if (char === '>') {
          currentElement!.attributes.set(attrName, {
            name: attrName,
            value: '',
            start: attrStart,
            end: pos,
            valueStart: pos,
            valueEnd: pos,
          });
          currentElement!.openTagEnd = pos + 1;
          if (currentElement!.isVoid) {
            currentElement!.closeTagStart = pos + 1;
            currentElement!.closeTagEnd = pos + 1;
          }
          pushElement(currentElement!);
          findBindingsInAttributes(currentElement!, bindings);
          currentElement = null;
          state = 'TEXT';
          textContent = '';
          textStart = pos + 1;
        }
        break;

      case 'ATTR_EQ':
        if (char === '"' || char === "'") {
          quoteChar = char;
          attrValue = '';
          attrValueStart = pos + 1;
          state = 'ATTR_VALUE_Q';
        } else if (char === '$' && nextChar === '{') {
          attrValueStart = pos;
          let braceDepth = 0;
          let i = pos;
          while (i < html.length) {
            if (html[i] === '$' && html[i + 1] === '{') {
              braceDepth++;
              i += 2;
              continue;
            }
            if (html[i] === '{') {
              braceDepth++;
            } else if (html[i] === '}') {
              braceDepth--;
              if (braceDepth === 0) {
                attrValue = html.substring(attrValueStart, i + 1);
                currentElement!.attributes.set(attrName, {
                  name: attrName,
                  value: attrValue,
                  start: attrStart,
                  end: i + 1,
                  valueStart: attrValueStart,
                  valueEnd: i + 1,
                });
                pos = i;
                state = 'TAG_SPACE';
                break;
              }
            }
            i++;
          }
        } else if (char !== ' ' && char !== '\t' && char !== '\n' && char !== '\r') {
          attrValue = char;
          attrValueStart = pos;
          state = 'ATTR_VALUE_UQ';
        }
        break;

      case 'ATTR_VALUE_Q':
        if (char === quoteChar) {
          currentElement!.attributes.set(attrName, {
            name: attrName,
            value: attrValue,
            start: attrStart,
            end: pos + 1,
            valueStart: attrValueStart,
            valueEnd: pos,
          });
          state = 'TAG_SPACE';
        } else {
          attrValue += char;
        }
        break;

      case 'ATTR_VALUE_UQ':
        if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
          currentElement!.attributes.set(attrName, {
            name: attrName,
            value: attrValue,
            start: attrStart,
            end: pos,
            valueStart: attrValueStart,
            valueEnd: pos,
          });
          state = 'TAG_SPACE';
        } else if (char === '>') {
          currentElement!.attributes.set(attrName, {
            name: attrName,
            value: attrValue,
            start: attrStart,
            end: pos,
            valueStart: attrValueStart,
            valueEnd: pos,
          });
          currentElement!.openTagEnd = pos + 1;
          if (currentElement!.isVoid) {
            currentElement!.closeTagStart = pos + 1;
            currentElement!.closeTagEnd = pos + 1;
          }
          pushElement(currentElement!);
          findBindingsInAttributes(currentElement!, bindings);
          currentElement = null;
          state = 'TEXT';
          textContent = '';
          textStart = pos + 1;
        } else {
          attrValue += char;
        }
        break;

      case 'TAG_CLOSE':
        if (/[\w-]/.test(char)) {
          tagName += char;
        } else if (char === '>') {
          flushText();
          closeElement(tagName, tagStart, pos + 1);
          state = 'TEXT';
          textContent = '';
          textStart = pos + 1;
        } else if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        }
        break;

      case 'COMMENT':
        commentBuffer += char;
        if (commentBuffer.endsWith('-->')) {
          state = 'TEXT';
          textContent = '';
          textStart = pos + 1;
        }
        break;
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
