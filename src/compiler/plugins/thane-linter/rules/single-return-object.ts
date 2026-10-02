/**
 * THANE412 — single-return-object
 *
 * A component's setup function returns one object:
 *
 *   export const Card = defineComponent(() => {                // ✅
 *     return { template: html`${when(ready(), html`<p>…</p>`, html`<p>…</p>`)}` };
 *   });
 *
 *   export const Card = defineComponent(() => {
 *     if (!ready()) return { template: html`<p>Loading</p>` }; // ❌ THANE412
 *     return { template: html`<p>…</p>` };
 *   });
 *
 * The compiler builds one template per component, from the last return object, so every branch
 * would render it (and the earlier objects' hooks and styles would be lost). Returns are found as
 * the compiler finds them: at any depth, but not inside a nested function.
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode } from '../../../errors.js';
import { getSetupFunction } from '../../../utils/component-ast.js';
import { findReturnObjects } from '../../reactive-binding-compiler/index.js';
import { createReporter, isDefineComponentExpr } from './lint-utils.js';

const MESSAGE =
  'A setup function with more than one return object is not supported. ' +
  "The compiler builds one template per component, from the last return, so this one is never used. Use 'when()' in the template instead.";

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.SINGLE_RETURN_OBJECT, 'error');

  const visit = (node: ts.Node) => {
    const setup = isDefineComponentExpr(node) ? getSetupFunction(node) : undefined;
    // Every return object but the last, reported at its `return`
    for (const returned of setup ? findReturnObjects(setup).slice(0, -1) : []) report(returned.parent, MESSAGE);
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
    description: 'A component setup function returns one object.',
  },
  check,
};
