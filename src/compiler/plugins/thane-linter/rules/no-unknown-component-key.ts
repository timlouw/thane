/**
 * THANE415 — no-unknown-component-key
 *
 * A setup function returns `template`, `styles`, `onMount` and `onDestroy`, and nothing reads any other key.
 * TypeScript does not report one (an object literal returned from a callback gets no excess-property check), so
 * a misspelled hook would never run:
 *
 *   return { template: html`…`, onMount: () => start() };     // ✅
 *   return { template: html`…`, onMoun: () => start() };      // ❌ did you mean 'onMount'?
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode } from '../../../errors.js';
import { getSetupFunction } from '../../../utils/component-ast.js';
import { closestName } from '../../../utils/closest-name.js';
import { findReturnObjects } from '../../reactive-binding-compiler/index.js';
import { createReporter, isDefineComponentExpr } from './lint-utils.js';

/** The keys of a setup's return object */
export const COMPONENT_KEYS: readonly string[] = ['template', 'styles', 'onMount', 'onDestroy'];

const keyName = (property: ts.ObjectLiteralElementLike): string | undefined => {
  const name = property.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.NO_UNKNOWN_COMPONENT_KEY, 'error');

  const visit = (node: ts.Node) => {
    const setup = isDefineComponentExpr(node) ? getSetupFunction(node) : undefined;
    for (const returned of setup ? findReturnObjects(setup) : []) {
      for (const property of returned.properties) {
        const key = keyName(property);
        if (key === undefined || COMPONENT_KEYS.includes(key)) continue;
        const near = closestName(key, COMPONENT_KEYS);
        report(
          property.name ?? property,
          `'${key}' is not a key of a component, and nothing reads it` +
            (near ? `: did you mean '${near}'?` : `. A setup returns ${COMPONENT_KEYS.join(', ')}.`),
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
};

export const noUnknownComponentKey: LintRuleDefinition = {
  meta: {
    code: ErrorCode.NO_UNKNOWN_COMPONENT_KEY,
    name: 'no-unknown-component-key',
    severity: 'error',
    description: 'A setup returns template, styles, onMount and onDestroy, and no other key.',
  },
  check,
};
