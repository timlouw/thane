/**
 * THANE400 — no-default-export-component
 *
 * defineComponent() must use a named export so the compiler can auto-derive
 * the component selector from the export name:
 *
 *   export const MyCounter = defineComponent(() => { ... });  // ✅
 *   export default defineComponent(() => { ... });            // ❌ THANE400
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

  for (const stmt of sourceFile.statements) {
    // export default defineComponent(...)
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && isDefineComponentExpr(stmt.expression)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart());
      diagnostics.push(
        createError(
          'defineComponent must use a named export: export const MyComponent = defineComponent(...)',
          { file: filePath, line: line + 1, column: character + 1 },
          ErrorCode.NO_DEFAULT_EXPORT_COMPONENT,
        ),
      );
    }
  }

  return diagnostics;
};

export const noDefaultExportComponent: LintRuleDefinition = {
  meta: {
    code: ErrorCode.NO_DEFAULT_EXPORT_COMPONENT,
    name: 'no-default-export-component',
    severity: 'error',
    description: 'defineComponent() must use a named export so the selector can be auto-derived.',
  },
  check,
};
