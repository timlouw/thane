/**
 * THANE408 — component-const-declaration
 *
 * Component declarations using `defineComponent()` must use `const`,
 * not `let` or `var`. Reassigning a component variable after creation
 * would break the compiler's static analysis and could cause selector
 * collisions or lost references.
 *
 *   export const MyCounter = defineComponent(() => { ... });  // ✅
 *
 *   export let MyCounter = defineComponent(() => { ... });    // ❌ THANE408
 *   export var MyCounter = defineComponent(() => { ... });    // ❌ THANE408
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode, createError } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';

const isDefineComponentExpr = (node: ts.Expression): boolean => {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    return ts.isIdentifier(callee) && callee.text === FN.DEFINE_COMPONENT;
  }
  return false;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      const flags = node.declarationList.flags;
      const isConst = (flags & ts.NodeFlags.Const) !== 0;

      if (!isConst) {
        const isLet = (flags & ts.NodeFlags.Let) !== 0;
        const keyword = isLet ? 'let' : 'var';

        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && isDefineComponentExpr(decl.initializer)) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(decl.getStart());
            diagnostics.push(
              createError(
                `Component declaration must use 'const', not '${keyword}'. ` +
                'Reassigning a component variable breaks the compiler\'s static analysis ' +
                'and can cause selector collisions.',
                { file: filePath, line: line + 1, column: character + 1 },
                ErrorCode.COMPONENT_CONST_DECLARATION,
              ),
            );
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
};

export const componentConstDeclaration: LintRuleDefinition = {
  meta: {
    code: ErrorCode.COMPONENT_CONST_DECLARATION,
    name: 'component-const-declaration',
    severity: 'error',
    description: "defineComponent() declarations must use 'const'.",
  },
  check,
};
