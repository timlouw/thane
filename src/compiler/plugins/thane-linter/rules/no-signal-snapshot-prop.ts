/**
 * THANE416 — no-signal-snapshot-prop
 *
 * A component reads its props once, when it mounts. A prop whose value reads a signal passes the value the signal
 * has then, and the child never sees it change:
 *
 *   html`${Badge({ count })}`               // ✅ the child reads the signal: ${props.count()}
 *   html`${Badge({ count: count() })}`      // ⚠ THANE416: the count when Badge mounts
 *
 * Reported for the signals the file declares (`signal(…)`, `computed(…)`), read anywhere in a prop's value but
 * inside a function (a callback reads the signal when it runs). A warning: a snapshot can be what you want, and
 * thane.config.json's `lint` turns it off.
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';
import { createReporter, isTaggedWith, readsDeclaredSignal, slotsOf } from './lint-utils.js';

const isComponentCall = (node: ts.Node): node is ts.CallExpression & { expression: ts.Identifier } =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^[A-Z]/.test(node.expression.text);

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.NO_SIGNAL_SNAPSHOT_PROP, 'warning');

  /** The signal reads in a prop's value, but not inside a function */
  const readsIn = (node: ts.Node, found: ts.CallExpression[]): ts.CallExpression[] => {
    if (ts.isFunctionLike(node)) return found;
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isIdentifier(node.expression) &&
      readsDeclaredSignal(node.expression)
    ) {
      found.push(node);
    }
    ts.forEachChild(node, (child) => void readsIn(child, found));
    return found;
  };

  const visitExpression = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) return; // a nested template is visited on its own
    if (isComponentCall(node)) {
      const props = node.arguments[0];
      for (const property of props && ts.isObjectLiteralExpression(props) ? props.properties : []) {
        if (!ts.isPropertyAssignment(property)) continue;
        for (const read of readsIn(property.initializer, [])) {
          const signal = (read.expression as ts.Identifier).text;
          const key = property.name.getText(sourceFile);
          report(
            read,
            `${key}: ${property.initializer.getText(sourceFile)} reads ${signal} once, when ${node.expression.text} mounts: ` +
              `it does not see ${signal} change. Pass the signal, ${key}: ${signal}, typed ReadonlySignal in the child's props, ` +
              'and read it in its template.',
          );
        }
      }
    }
    ts.forEachChild(node, visitExpression);
  };

  const visit = (node: ts.Node): void => {
    if (isTaggedWith(node, [FN.HTML])) for (const slot of slotsOf(node)) visitExpression(slot.expression);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
};

export const noSignalSnapshotProp: LintRuleDefinition = {
  meta: {
    code: ErrorCode.NO_SIGNAL_SNAPSHOT_PROP,
    name: 'no-signal-snapshot-prop',
    severity: 'warning',
    description: "A child's prop that reads a signal passes its value when the child mounts.",
  },
  check,
};
