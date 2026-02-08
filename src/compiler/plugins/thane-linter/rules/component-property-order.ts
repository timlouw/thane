/**
 * THANE401 — component-property-order
 *
 * The return object of defineComponent() must declare properties in
 * canonical lifecycle order:
 *
 *   template → styles → onMount → onDestroy
 *
 * Out-of-order declarations emit a warning (not a build error).
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode, createWarning } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';

/** Canonical property order. Properties not in this list are ignored. */
const CANONICAL_ORDER = ['template', 'styles', 'onMount', 'onDestroy'] as const;

const orderIndex = new Map<string, number>(
  CANONICAL_ORDER.map((name, i) => [name, i]),
);

/**
 * Walk the AST to find all object-literal return values inside
 * defineComponent() calls (either direct return or arrow shorthand).
 */
const findReturnObjects = (node: ts.Node, results: ts.ObjectLiteralExpression[]): void => {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && callee.text === FN.DEFINE_COMPONENT) {
      // Find the setup function argument (last function-like arg)
      for (const arg of node.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          collectReturns(arg.body, results);
        }
      }
      return; // Don't recurse further into defineComponent args
    }
  }
  ts.forEachChild(node, (child) => findReturnObjects(child, results));
};

const collectReturns = (body: ts.Node, results: ts.ObjectLiteralExpression[]): void => {
  // Arrow with expression body: () => ({ template, ... })
  if (ts.isObjectLiteralExpression(body)) {
    results.push(body);
    return;
  }
  // Block body — look for return statements
  if (ts.isBlock(body)) {
    for (const stmt of body.statements) {
      if (ts.isReturnStatement(stmt) && stmt.expression && ts.isObjectLiteralExpression(stmt.expression)) {
        results.push(stmt.expression);
      }
    }
  }
};

/**
 * Check a single return object for out-of-order properties.
 */
const checkPropertyOrder = (
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  filePath: string,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  let lastIdx = -1;
  let lastName = '';

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop) && !ts.isMethodDeclaration(prop)) {
      continue;
    }
    const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : null;
    if (!name) continue;

    const idx = orderIndex.get(name);
    if (idx === undefined) continue; // not a lifecycle property — skip

    if (idx < lastIdx) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(prop.getStart());

      // Build the "expected order" hint
      const orderHint = CANONICAL_ORDER.join(' → ');

      diagnostics.push(
        createWarning(
          `'${name}' should be declared after '${lastName}' (expected order: ${orderHint})`,
          { file: filePath, line: line + 1, column: character + 1 },
          ErrorCode.COMPONENT_PROPERTY_ORDER,
        ),
      );
    }

    lastIdx = idx;
    lastName = name;
  }

  return diagnostics;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const returnObjects: ts.ObjectLiteralExpression[] = [];
  findReturnObjects(sourceFile, returnObjects);

  const diagnostics: Diagnostic[] = [];
  for (const obj of returnObjects) {
    diagnostics.push(...checkPropertyOrder(obj, sourceFile, filePath));
  }

  return diagnostics;
};

export const componentPropertyOrder: LintRuleDefinition = {
  meta: {
    code: ErrorCode.COMPONENT_PROPERTY_ORDER,
    name: 'component-property-order',
    severity: 'warning',
    description: 'Enforce canonical property order in defineComponent return objects (template → styles → onMount → onDestroy).',
  },
  check,
};
