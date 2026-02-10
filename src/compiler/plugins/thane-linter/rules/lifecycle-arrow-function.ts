/**
 * THANE402 — lifecycle-arrow-function
 *
 * Lifecycle hooks in the defineComponent() return object must be
 * arrow functions, not method shorthand or regular function expressions:
 *
 *   onMount: () => { ... },   // ✅ arrow function
 *   onDestroy: () => { ... }, // ✅ arrow function
 *
 *   onMount() { ... },                   // ❌ THANE402 — method shorthand
 *   onMount: function() { ... },         // ❌ THANE402 — function expression
 *
 * This keeps a consistent code style and avoids accidental `this` binding
 * issues — arrow functions inherit the enclosing lexical scope, which is
 * the only correct context inside defineComponent.
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode, createError } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';

/** Properties that must be arrow functions. */
const LIFECYCLE_PROPS = new Set(['onMount', 'onDestroy']);

// ============================================================================
// AST helpers (shared pattern with component-property-order)
// ============================================================================

const findReturnObjects = (node: ts.Node, results: ts.ObjectLiteralExpression[]): void => {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && callee.text === FN.DEFINE_COMPONENT) {
      for (const arg of node.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          collectReturns(arg.body, results);
        }
      }
      return;
    }
  }
  ts.forEachChild(node, (child) => findReturnObjects(child, results));
};

const collectReturns = (body: ts.Node, results: ts.ObjectLiteralExpression[]): void => {
  if (ts.isObjectLiteralExpression(body)) {
    results.push(body);
    return;
  }
  if (ts.isBlock(body)) {
    for (const stmt of body.statements) {
      if (ts.isReturnStatement(stmt) && stmt.expression && ts.isObjectLiteralExpression(stmt.expression)) {
        results.push(stmt.expression);
      }
    }
  }
};

// ============================================================================
// Rule check
// ============================================================================

/**
 * Inspect each property in the return object. If it is a lifecycle hook,
 * the value must be an arrow function — not a method declaration (shorthand)
 * and not a regular `function()` expression.
 */
const checkArrowFunctions = (
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const prop of obj.properties) {
    // Get the property name regardless of node type
    const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : null;
    if (!name || !LIFECYCLE_PROPS.has(name)) continue;

    // ── Method declaration shorthand: onMount() { ... } ──────────────
    if (ts.isMethodDeclaration(prop)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(prop.getStart());
      diagnostics.push(
        createError(
          `'${name}' must be an arrow function, not a method shorthand (use '${name}: () => { ... }')`,
          { file: filePath, line: line + 1, column: character + 1 },
          ErrorCode.LIFECYCLE_ARROW_FUNCTION,
        ),
      );
      continue;
    }

    // ── Property assignment: onMount: <expr> ─────────────────────────
    if (ts.isPropertyAssignment(prop)) {
      const init = prop.initializer;

      // Regular function expression: onMount: function() { ... }
      if (ts.isFunctionExpression(init)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(prop.getStart());
        diagnostics.push(
          createError(
            `'${name}' must be an arrow function, not a function expression (use '${name}: () => { ... }')`,
            { file: filePath, line: line + 1, column: character + 1 },
            ErrorCode.LIFECYCLE_ARROW_FUNCTION,
          ),
        );
        continue;
      }

      // Arrow function — this is correct, no diagnostic
      if (ts.isArrowFunction(init)) {
        continue;
      }

      // Anything else (identifier reference, call expression, etc.) — also flag
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(prop.getStart());
      diagnostics.push(
        createError(
          `'${name}' must be an inline arrow function (use '${name}: () => { ... }')`,
          { file: filePath, line: line + 1, column: character + 1 },
          ErrorCode.LIFECYCLE_ARROW_FUNCTION,
        ),
      );
    }
  }

  return diagnostics;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const returnObjects: ts.ObjectLiteralExpression[] = [];
  findReturnObjects(sourceFile, returnObjects);

  const diagnostics: Diagnostic[] = [];
  for (const obj of returnObjects) {
    diagnostics.push(...checkArrowFunctions(obj, sourceFile, filePath));
  }

  return diagnostics;
};

export const lifecycleArrowFunction: LintRuleDefinition = {
  meta: {
    code: ErrorCode.LIFECYCLE_ARROW_FUNCTION,
    name: 'lifecycle-arrow-function',
    severity: 'error',
    description: 'Lifecycle hooks (onMount, onDestroy) must use arrow functions.',
  },
  check,
};
