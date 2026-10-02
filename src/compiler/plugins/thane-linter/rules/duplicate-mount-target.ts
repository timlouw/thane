/**
 * THANE411 — duplicate-mount-target
 *
 * Detects multiple `mount()` calls in the same scope that target the same element, the default
 * target (document.body) included. Mounting two components to the same target appends duplicate
 * content and causes binding collisions.
 *
 * This is a compile-time check — no runtime overhead is added.
 *
 *   mount(App);                                                   // ✅ single mount
 *
 *   mount(App);                                                   // ❌ THANE411
 *   mount(Other, { target: document.body });                      //    both document.body
 *
 *   mount(App, { target: document.getElementById('app') });       // ✅ different targets
 *   mount(Nav, { target: document.getElementById('nav') });
 *
 *   mount(App, { target: el });                                   // ❌ THANE411
 *   mount(Other, { target: el! });                                //    the same variable
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode } from '../../../errors.js';
import { isFunctionCall } from '../../../utils/ast-utils.js';
import { createReporter, locate } from './lint-utils.js';

const DEFAULT_TARGET = 'document.body';

/** A target expression without the parentheses, non-null assertions and casts around it */
const unwrap = (expression: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isAsExpression(expression)
    ? unwrap(expression.expression)
    : expression;

/** The key a target is compared by: a variable by its name, anything else by its source text. */
const keyOf = (target: ts.Expression, sourceFile: ts.SourceFile): string => {
  const inner = unwrap(target);
  return ts.isIdentifier(inner) ? `var:${inner.text}` : inner.getText(sourceFile);
};

/**
 * The key of a `mount(App, { target, … })` call's target; document.body when it has none. A call whose
 * options are not an object literal (`mount(App, options)`, `mount(...args)`) has a target the rule cannot
 * know, and is not compared.
 */
const getTargetKey = (call: ts.CallExpression, sourceFile: ts.SourceFile): string | null => {
  const [app, options] = call.arguments;
  if (!app || ts.isSpreadElement(app)) return null;
  if (!options) return DEFAULT_TARGET;
  if (!ts.isObjectLiteralExpression(options)) return null;
  for (const prop of options.properties) {
    const name = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : '';
    if (name !== 'target') continue;
    if (ts.isShorthandPropertyAssignment(prop)) return `var:${prop.name.text}`;
    if (ts.isPropertyAssignment(prop)) return keyOf(prop.initializer, sourceFile);
  }
  return DEFAULT_TARGET;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.DUPLICATE_MOUNT_TARGET, 'warning');

  // mount() calls are compared within the function they appear in: calls in different closures may
  // legally use variables of the same name (a `const t = document.createElement('div')` in each)
  const scopeStack: Array<Map<string, ts.CallExpression>> = [new Map()];

  const visit = (node: ts.Node) => {
    const isScopeBoundary =
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node);
    if (isScopeBoundary) scopeStack.push(new Map());

    const targetKey =
      ts.isCallExpression(node) && isFunctionCall(node, 'mount') ? getTargetKey(node, sourceFile) : null;
    if (targetKey !== null) {
      const scope = scopeStack[scopeStack.length - 1]!;
      const existing = scope.get(targetKey);
      if (existing) {
        report(
          node,
          `Duplicate mount() call targeting ${targetKey}. ` +
            `A previous mount() to the same target was found at line ${locate(sourceFile, existing).line}. ` +
            'Mounting multiple components to the same target appends duplicate content ' +
            'and causes binding collisions. Use a different target element for each mount().',
        );
      } else {
        scope.set(targetKey, node as ts.CallExpression);
      }
    }

    ts.forEachChild(node, visit);
    if (isScopeBoundary) scopeStack.pop();
  };

  visit(sourceFile);

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
