/**
 * THANE412 — single-return-object
 *
 * A component's setup function returns once: one object, or one template alone:
 *
 *   export const Card = defineComponent(() => {                // ✅
 *     return html`${when(ready(), html`<p>…</p>`, html`<p>…</p>`)}`;
 *   });
 *
 *   export const Card = defineComponent(() => {
 *     if (!ready()) return html`<p>Loading</p>`;                // ❌ THANE412
 *     return { template: html`<p>…</p>` };
 *   });
 *
 * The compiler builds one template per component, from the last return, so every branch would
 * render it (and the earlier objects' hooks and styles would be lost; an earlier template alone
 * would render nothing). Returns are found as the compiler finds them: at any depth, but not
 * inside a nested function.
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode } from '../../../errors.js';
import { getSetupFunction } from '../../../utils/component-ast.js';
import { isHtmlTemplate } from '../../../utils/index.js';
import { unwrapParens } from '../../../utils/component-ast.js';
import { createReporter, isDefineComponentExpr } from './lint-utils.js';

const MESSAGE =
  'A setup function with more than one return is not supported. ' +
  "The compiler builds one template per component, from the last return, so this one is never used. Use 'when()' in the template instead.";

/** The returns of a setup's object or template alone, outside nested functions, in source order */
const componentReturns = (setup: ts.ArrowFunction | ts.FunctionExpression): ts.ReturnStatement[] => {
  const returns: ts.ReturnStatement[] = [];
  if (!ts.isBlock(setup.body)) return returns;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      const value = unwrapParens(node.expression);
      if (ts.isObjectLiteralExpression(value) || (ts.isTaggedTemplateExpression(value) && isHtmlTemplate(value))) {
        returns.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(setup.body, visit);
  return returns;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.SINGLE_RETURN_OBJECT, 'error');

  const visit = (node: ts.Node) => {
    const setup = isDefineComponentExpr(node) ? getSetupFunction(node) : undefined;
    // Every return but the last, reported at its `return`
    for (const returned of setup ? componentReturns(setup).slice(0, -1) : []) report(returned, MESSAGE);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
};

export const singleReturnObject: LintRuleDefinition = {
  meta: {
    code: ErrorCode.SINGLE_RETURN_OBJECT,
    name: 'single-return-object',
    severity: 'error',
    description: 'A component setup function returns once: one object, or one template.',
  },
  check,
};
