/**
 * THANE407 — single-component-per-file
 *
 * Only one `defineComponent()` call is allowed per file. The compiler
 * assumes a single component per file for template compilation, binding
 * injection, and selector derivation. Multiple calls cause the compiler
 * to silently process only one and skip the rest.
 *
 *   export const MyCounter = defineComponent(() => { ... });  // ✅ one per file
 *
 *   export const Foo = defineComponent(() => { ... });        // ❌ THANE407
 *   export const Bar = defineComponent(() => { ... });        //    two in one file
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
  const locations: { line: number; character: number; node: ts.Node }[] = [];

  const visit = (node: ts.Node) => {
    // Match: [export] const X = defineComponent(...)
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && isDefineComponentExpr(decl.initializer)) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(decl.getStart());
          locations.push({ line, character, node: decl });
        }
      }
    }

    // Also catch: export default defineComponent(...)
    if (ts.isExportAssignment(node) && !node.isExportEquals && isDefineComponentExpr(node.expression)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      locations.push({ line, character, node });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (locations.length > 1) {
    // Report on every call after the first
    for (let i = 1; i < locations.length; i++) {
      const loc = locations[i]!;
      diagnostics.push(
        createError(
          `Only one defineComponent() is allowed per file. Found ${locations.length} calls — ` +
            'the compiler processes only one component per file. Split additional components into separate files.',
          { file: filePath, line: loc.line + 1, column: loc.character + 1 },
          ErrorCode.SINGLE_COMPONENT_PER_FILE,
        ),
      );
    }
  }

  return diagnostics;
};

export const singleComponentPerFile: LintRuleDefinition = {
  meta: {
    code: ErrorCode.SINGLE_COMPONENT_PER_FILE,
    name: 'single-component-per-file',
    severity: 'error',
    description: 'Only one defineComponent() call is allowed per file.',
  },
  check,
};
