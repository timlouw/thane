/**
 * THANE411 — duplicate-mount-target
 *
 * Detects multiple `mount()` calls in the same file that target the same
 * element or use the default target (document.body). Mounting two components
 * to the same target appends duplicate content and causes binding collisions.
 *
 * This is a compile-time check — no runtime overhead is added.
 *
 *   mount(App);                                    // ✅ single mount
 *
 *   mount(App);                                    // ❌ THANE411
 *   mount(App);                                    //    duplicate default mount
 *
 *   mount(App, document.getElementById('app'));    // ✅ different target
 *   mount(Other, document.getElementById('nav'));  // ✅ different target
 *
 *   mount(App, el);                                // ❌ THANE411 if same variable
 *   mount(Other, el);
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode, createWarning } from '../../../errors.js';

const isMountCall = (node: ts.CallExpression): boolean => {
  return ts.isIdentifier(node.expression) && node.expression.text === 'mount';
};

/**
 * Derive a "target key" from a mount() call.
 *
 * New API:   mount({ target: document.getElementById('app') })
 * Legacy:    mount(App, document.getElementById('app'))
 *
 * If no target, the target is 'document.body' (default).
 * Returns a string identifier for comparison, or null if it's too
 * complex to analyze statically.
 */
const getTargetKey = (call: ts.CallExpression, sourceFile: ts.SourceFile): string => {
  const firstArg = call.arguments[0];

  // New API: mount({ component?, target?, ... })
  if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
    for (const prop of firstArg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === 'target'
      ) {
        const target = prop.initializer;
        if (ts.isIdentifier(target)) return `var:${target.text}`;
        if (ts.isPropertyAccessExpression(target)) return target.getText(sourceFile);
        if (ts.isCallExpression(target)) return target.getText(sourceFile);
        return target.getText(sourceFile);
      }
    }
    return '__default_body__';
  }

  // Legacy: mount(Component, target)
  if (call.arguments.length < 2) {
    return '__default_body__';
  }

  const target = call.arguments[1]!;

  // Simple identifier: mount(App, el)
  if (ts.isIdentifier(target)) {
    return `var:${target.text}`;
  }

  // Property access: mount(App, document.body)
  if (ts.isPropertyAccessExpression(target)) {
    return target.getText(sourceFile);
  }

  // Call expression: mount(App, document.getElementById('app'))
  if (ts.isCallExpression(target)) {
    return target.getText(sourceFile);
  }

  // Too complex to analyze
  return target.getText(sourceFile);
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  // Only check entry-point files (files that call mount())
  // Collect all mount() calls, scoped to the function/arrow body they appear in.
  // mount() calls inside different closures may legally use variables with the
  // same name (e.g. `const t = document.createElement('div')` in three separate
  // arrow functions) — these must NOT be flagged as duplicates.

  const scopeStack: Array<Map<string, { line: number; character: number }>> = [new Map()];
  const pendingDiagnostics: Diagnostic[] = [];

  const currentScope = () => scopeStack[scopeStack.length - 1]!;

  const visit = (node: ts.Node) => {
    // Push a new scope for function-like boundaries (function declarations,
    // arrow functions, method declarations). This means mount() calls inside
    // different closures get independent duplicate tracking.
    const isScopeBoundary =
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node);

    if (isScopeBoundary) {
      scopeStack.push(new Map());
    }

    if (ts.isCallExpression(node) && isMountCall(node)) {
      const targetKey = getTargetKey(node, sourceFile);
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const scope = currentScope();
      const existing = scope.get(targetKey);
      if (existing) {
        const targetDesc = targetKey === '__default_body__' ? 'document.body (default)' : targetKey;
        pendingDiagnostics.push(
          createWarning(
            `Duplicate mount() call targeting ${targetDesc}. ` +
              `A previous mount() to the same target was found at line ${existing.line + 1}. ` +
              'Mounting multiple components to the same target appends duplicate content ' +
              'and causes binding collisions. Use a different target element for each mount().',
            { file: filePath, line: line + 1, column: character + 1 },
            ErrorCode.DUPLICATE_MOUNT_TARGET,
          ),
        );
      } else {
        scope.set(targetKey, { line, character });
      }
    }

    ts.forEachChild(node, visit);

    if (isScopeBoundary) {
      scopeStack.pop();
    }
  };

  visit(sourceFile);

  diagnostics.push(...pendingDiagnostics);

  return diagnostics;
};

export const duplicateMountTarget: LintRuleDefinition = {
  meta: {
    code: ErrorCode.DUPLICATE_MOUNT_TARGET,
    name: 'duplicate-mount-target',
    severity: 'warning',
    description: 'Detects multiple mount() calls to the same target element.',
  },
  check,
};
