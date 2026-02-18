/**
 * HTML Parser — Binding detection
 *
 * Finds signal bindings, events, when/whenElse/repeat directives in parsed HTML.
 */

import type { HtmlElement, BindingInfo } from './types.js';
import { WHEN_ELSE_REGEX, REPEAT_REGEX, SIGNAL_EXPR_REGEX, SIGNAL_CALL_REGEX } from './types.js';
import { logger } from '../logger.js';
import { parseArrowFunction } from '../ast-utils.js';

/**
 * Shared argument parser for both whenElse and repeat expressions.
 *
 * Parses a comma-separated argument list from a `${directive(` call,
 * handling nested template literals and balanced parentheses.
 *
 * @param text - full text being parsed
 * @param startPos - position right after the opening paren of the directive
 * @returns parsed args and end position, or null if parsing fails
 */
function parseDirectiveArgs(text: string, startPos: number): { args: string[]; end: number } | null {
  let pos = startPos;
  let parenDepth = 1;

  const args: string[] = [];
  let currentArg = '';
  let inBacktick = false;
  let templateBraceDepth = 0;

  while (pos < text.length) {
    const char = text[pos];

    if (char === '`' && !inBacktick) {
      inBacktick = true;
      templateBraceDepth = 0;
      currentArg += char;
      pos++;
      continue;
    }

    if (char === '`' && inBacktick && templateBraceDepth === 0) {
      inBacktick = false;
      currentArg += char;
      pos++;
      continue;
    }

    if (inBacktick && char === '$' && text[pos + 1] === '{') {
      templateBraceDepth++;
      currentArg += '${';
      pos += 2;
      continue;
    }

    if (inBacktick && char === '}' && templateBraceDepth > 0) {
      templateBraceDepth--;
      currentArg += char;
      pos++;
      continue;
    }

    if (inBacktick) {
      currentArg += char;
      pos++;
      continue;
    }

    if (char === '(') {
      parenDepth++;
      currentArg += char;
    } else if (char === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        args.push(currentArg.trim());
        pos++;
        if (text[pos] === '}') {
          pos++;
        }
        return { args, end: pos };
      }
      currentArg += char;
    } else if (char === ',' && parenDepth === 1) {
      args.push(currentArg.trim());
      currentArg = '';
    } else {
      currentArg += char;
    }

    pos++;
  }

  return null;
}

function extractHtmlTemplateContent(arg: string): string {
  const htmlMatch = arg.match(/^html`([\s\S]*)`$/);
  if (htmlMatch && htmlMatch[1] !== undefined) {
    return htmlMatch[1];
  }

  const plainMatch = arg.match(/^`([\s\S]*)`$/);
  if (plainMatch && plainMatch[1] !== undefined) {
    return plainMatch[1];
  }

  return arg;
}

function extractSignalsFromExpression(expression: string): string[] {
  const signalCallRegex = SIGNAL_CALL_REGEX();
  const signals: string[] = [];
  let signalMatch: RegExpExecArray | null;
  while ((signalMatch = signalCallRegex.exec(expression)) !== null) {
    const signalName = signalMatch[1];
    if (signalName && !signals.includes(signalName)) {
      signals.push(signalName);
    }
  }
  return signals;
}

function findTemplateExpressions(
  value: string,
): Array<{ start: number; end: number; expression: string; full: string }> {
  const results: Array<{ start: number; end: number; expression: string; full: string }> = [];
  let searchPos = 0;

  while (searchPos < value.length) {
    const dollarIdx = value.indexOf('${', searchPos);
    if (dollarIdx === -1) break;

    let braceDepth = 1;
    let i = dollarIdx + 2;
    let inBacktick = false;
    let templateBraceDepth = 0;

    while (i < value.length && braceDepth > 0) {
      const ch = value[i];

      if (inBacktick) {
        if (ch === '`' && templateBraceDepth === 0) {
          inBacktick = false;
        } else if (ch === '$' && value[i + 1] === '{') {
          templateBraceDepth++;
          i++;
        } else if (ch === '}' && templateBraceDepth > 0) {
          templateBraceDepth--;
        }
        i++;
        continue;
      }

      if (ch === '`') {
        inBacktick = true;
        templateBraceDepth = 0;
      } else if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
      }

      if (braceDepth > 0) i++;
    }

    if (braceDepth !== 0) {
      searchPos = dollarIdx + 2;
      continue;
    }

    const full = value.substring(dollarIdx, i + 1);
    const expression = value.substring(dollarIdx + 2, i).trim();
    results.push({ start: dollarIdx, end: i + 1, expression, full });
    searchPos = i + 1;
  }

  return results;
}

function inferStyleProperty(styleValue: string, expressionStart: number): string | null {
  let colon = -1;
  for (let i = expressionStart - 1; i >= 0; i--) {
    const ch = styleValue[i];
    if (ch === ';') break;
    if (ch === ':') {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const declStart = styleValue.lastIndexOf(';', colon) + 1;
  const prop = styleValue.substring(declStart, colon).trim();
  if (!/^[\w-]+$/.test(prop)) return null;
  return prop;
}

export function parseWhenElseExpression(
  text: string,
  startPos: number,
): {
  end: number;
  condition: string;
  thenTemplate: string;
  elseTemplate: string;
  signals: string[];
} | null {
  const argsStart = startPos + '${whenElse('.length;
  const parsed = parseDirectiveArgs(text, argsStart);
  if (!parsed || parsed.args.length !== 3) return null;

  const condition = parsed.args[0];
  const arg1 = parsed.args[1];
  const arg2 = parsed.args[2];
  if (!condition || !arg1 || !arg2) return null;

  const thenTemplate = extractHtmlTemplateContent(arg1);
  const elseTemplate = extractHtmlTemplateContent(arg2);
  const signals = extractSignalsFromExpression(condition);

  return {
    end: parsed.end,
    condition,
    thenTemplate,
    elseTemplate,
    signals,
  };
}

export function parseRepeatExpression(
  text: string,
  startPos: number,
): {
  end: number;
  itemsExpression: string;
  itemVar: string;
  indexVar?: string | undefined;
  itemTemplate: string;
  emptyTemplate?: string | undefined;
  trackByFn?: string | undefined;
  signals: string[];
} | null {
  const argsStart = startPos + '${repeat('.length;
  const parsed = parseDirectiveArgs(text, argsStart);
  if (!parsed) return null;

  const filteredArgs = parsed.args.filter((a) => a.trim() !== '');

  if (filteredArgs.length < 2 || filteredArgs.length > 4) {
    return null;
  }

  const itemsExpression = filteredArgs[0];
  const templateFn = filteredArgs[1];
  if (!itemsExpression || !templateFn) {
    return null;
  }

  const arrowParsed = parseArrowFunction(templateFn);
  if (!arrowParsed) {
    return null;
  }

  const params = arrowParsed.params.split(',').map((p) => p.trim());
  const itemVar = params[0];
  if (!itemVar) return null;
  const indexVar = params[1];

  const templateBody = arrowParsed.body.trim();
  const itemTemplate = extractHtmlTemplateContent(templateBody);

  let emptyTemplate: string | undefined;
  const arg2 = filteredArgs[2];
  if (filteredArgs.length >= 3 && arg2 && arg2.trim() !== 'null' && arg2.trim() !== 'undefined') {
    emptyTemplate = extractHtmlTemplateContent(arg2.trim());
  }

  let trackByFn: string | undefined;
  const arg3 = filteredArgs[3];
  if (filteredArgs.length === 4 && arg3) {
    const trimmed = arg3.trim();
    const parsed2 = parseArrowFunction(trimmed);
    if (!parsed2) {
      logger.warn(
        'html-parser',
        `trackBy function should be an arrow function returning a key property, e.g., (item) => item.id`,
      );
    }
    trackByFn = trimmed;
  }

  const signals = extractSignalsFromExpression(itemsExpression);

  return {
    end: parsed.end,
    itemsExpression,
    itemVar,
    indexVar,
    itemTemplate,
    emptyTemplate,
    trackByFn,
    signals,
  };
}

export function findBindingsInText(
  text: string,
  textStart: number,
  parent: HtmlElement | null,
  bindings: BindingInfo[],
): void {
  if (!parent) return;

  const complexExprPositions: Array<{ start: number; end: number }> = [];

  const whenElseRegex = WHEN_ELSE_REGEX();
  let whenElseMatch: RegExpExecArray | null;

  while ((whenElseMatch = whenElseRegex.exec(text)) !== null) {
    const startPos = whenElseMatch.index;
    const parsed = parseWhenElseExpression(text, startPos);
    if (parsed) {
      complexExprPositions.push({ start: startPos, end: parsed.end });

      bindings.push({
        element: parent,
        type: 'whenElse',
        signalName: parsed.signals[0] || '',
        signalNames: parsed.signals,
        expressionStart: textStart + startPos,
        expressionEnd: textStart + parsed.end,
        fullExpression: text.substring(startPos, parsed.end),
        jsExpression: parsed.condition,
        thenTemplate: parsed.thenTemplate,
        elseTemplate: parsed.elseTemplate,
      });
    }
  }

  const repeatRegex = REPEAT_REGEX();
  let repeatMatch: RegExpExecArray | null;

  while ((repeatMatch = repeatRegex.exec(text)) !== null) {
    const startPos = repeatMatch.index;
    const parsed = parseRepeatExpression(text, startPos);
    if (parsed) {
      complexExprPositions.push({ start: startPos, end: parsed.end });

      bindings.push({
        element: parent,
        type: 'repeat',
        signalName: parsed.signals[0] || '',
        signalNames: parsed.signals,
        expressionStart: textStart + startPos,
        expressionEnd: textStart + parsed.end,
        fullExpression: text.substring(startPos, parsed.end),
        itemsExpression: parsed.itemsExpression,
        itemVar: parsed.itemVar,
        indexVar: parsed.indexVar,
        itemTemplate: parsed.itemTemplate,
        emptyTemplate: parsed.emptyTemplate,
        trackByFn: parsed.trackByFn,
      });
    }
  }

  const signalExprRegex = SIGNAL_EXPR_REGEX();
  let match: RegExpExecArray | null;

  // Track bare signal binding positions so we skip them for complex expression detection
  const bareSignalPositions: Array<{ start: number; end: number }> = [];

  while ((match = signalExprRegex.exec(text)) !== null) {
    const pos = match.index;
    const insideComplex = complexExprPositions.some((cp) => pos >= cp.start && pos < cp.end);
    if (insideComplex) continue;

    const signalName = match[1];
    if (!signalName) continue;

    bareSignalPositions.push({ start: pos, end: pos + match[0].length });

    bindings.push({
      element: parent,
      type: 'text',
      signalName,
      expressionStart: textStart + match.index,
      expressionEnd: textStart + match.index + match[0].length,
      fullExpression: match[0],
    });
  }

  // ── Complex expression text bindings ──
  // Detect ${expr} interpolations that contain signal calls but aren't bare ${sig()}.
  // Examples: ${count() + 1}, ${isActive() ? 'Yes' : 'No'}, ${a() + b()}
  const allSkipRanges = [...complexExprPositions, ...bareSignalPositions];
  let searchPos = 0;
  while (searchPos < text.length) {
    const dollarIdx = text.indexOf('${', searchPos);
    if (dollarIdx === -1) break;

    // Skip if inside a whenElse/repeat/bare-signal range
    const isInsideSkipRange = allSkipRanges.some((r) => dollarIdx >= r.start && dollarIdx < r.end);
    if (isInsideSkipRange) {
      searchPos = dollarIdx + 2;
      continue;
    }

    // Find the matching closing brace (handle nested braces and template literals)
    let braceDepth = 1;
    let i = dollarIdx + 2;
    let inBacktick = false;
    let templateBraceDepth = 0;

    while (i < text.length && braceDepth > 0) {
      const ch = text[i];

      if (inBacktick) {
        if (ch === '`' && templateBraceDepth === 0) {
          inBacktick = false;
        } else if (ch === '$' && text[i + 1] === '{') {
          templateBraceDepth++;
          i++;
        } else if (ch === '}' && templateBraceDepth > 0) {
          templateBraceDepth--;
        }
        i++;
        continue;
      }

      if (ch === '`') {
        inBacktick = true;
        templateBraceDepth = 0;
      } else if (ch === '{') {
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
      }
      if (braceDepth > 0) i++;
    }

    if (braceDepth !== 0) {
      searchPos = dollarIdx + 2;
      continue;
    }

    const exprContent = text.substring(dollarIdx + 2, i); // inner expression (without ${ and })
    const fullExpr = text.substring(dollarIdx, i + 1); // ${expr}

    // Check if expression contains signal calls
    const signals = extractSignalsFromExpression(exprContent);
    if (signals.length > 0) {
      bindings.push({
        element: parent,
        type: 'text',
        signalName: signals[0]!,
        signalNames: signals,
        expressionStart: textStart + dollarIdx,
        expressionEnd: textStart + i + 1,
        fullExpression: fullExpr,
        jsExpression: exprContent,
      });
    }

    searchPos = i + 1;
  }
}

export function findBindingsInAttributes(element: HtmlElement, bindings: BindingInfo[]): void {
  if (element.whenDirective) {
    const whenMatch = element.whenDirective.match(/^"\$\{when\((.+)\)\}"$/);
    if (whenMatch) {
      const innerExpr = whenMatch[1];
      if (!innerExpr) return;
      const signals = extractSignalsFromExpression(innerExpr);

      const primarySignal = signals[0];
      if (signals.length > 0 && primarySignal) {
        bindings.push({
          element,
          type: 'when',
          signalName: primarySignal,
          signalNames: signals,
          expressionStart: element.whenDirectiveStart!,
          expressionEnd: element.whenDirectiveEnd!,
          fullExpression: element.whenDirective,
          jsExpression: innerExpr,
        });
      }
    }
  }

  for (const [name, attr] of element.attributes) {
    if (name.startsWith('@')) {
      const eventParts = name.slice(1).split('.');
      const eventName = eventParts[0];
      const modifiers = eventParts.slice(1);

      const eventExprMatch = attr.value.match(/^\$\{(.+)\}$/s);
      if (eventExprMatch && eventExprMatch[1]) {
        const handlerExpression = eventExprMatch[1].trim();
        bindings.push({
          element,
          type: 'event',
          signalName: '',
          eventName,
          eventModifiers: modifiers,
          handlerExpression,
          expressionStart: attr.start,
          expressionEnd: attr.end,
          fullExpression: `@${name.slice(1)}="${attr.value}"`,
        });
      }
      continue;
    }

    if (name === 'style') {
      const styleExprs = findTemplateExpressions(attr.value);
      for (const expr of styleExprs) {
        const signals = extractSignalsFromExpression(expr.expression);
        if (signals.length === 0) continue;

        const propertyName = inferStyleProperty(attr.value, expr.start);
        if (!propertyName) continue;

        const bareSignal = expr.expression.match(/^\s*(\w+)\(\)\s*$/);
        const primarySignal = bareSignal?.[1] || signals[0]!;

        bindings.push({
          element,
          type: 'style',
          signalName: primarySignal,
          ...(bareSignal ? {} : { signalNames: signals, jsExpression: expr.expression }),
          property: propertyName,
          expressionStart: attr.valueStart + expr.start,
          expressionEnd: attr.valueStart + expr.end,
          fullExpression: expr.full,
        });
      }
      continue;
    }

    const attrExprs = findTemplateExpressions(attr.value);
    for (const expr of attrExprs) {
      const signals = extractSignalsFromExpression(expr.expression);
      if (signals.length === 0) continue;

      const bareSignal = expr.expression.match(/^\s*(\w+)\(\)\s*$/);
      const signalName = bareSignal?.[1] || signals[0]!;

      bindings.push({
        element,
        type: 'attr',
        signalName,
        ...(bareSignal ? {} : { signalNames: signals, jsExpression: expr.expression }),
        property: name,
        expressionStart: attr.valueStart + expr.start,
        expressionEnd: attr.valueStart + expr.end,
        fullExpression: expr.full,
      });
    }
  }
}
