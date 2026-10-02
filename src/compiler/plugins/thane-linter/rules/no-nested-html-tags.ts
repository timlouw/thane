/**
 * THANE404 — no-nested-html-tags
 *
 * An `html` tagged template inside another is compiled where it is the whole `${}` (it is inlined) or an
 * argument of a directive (a branch, a row, an empty template). Anywhere else in a `${}` it would be a
 * plain value, and it is reported:
 *
 *   html`<div>${html`<span>${count()}</span>`}</div>`             // ✅ inlined
 *   html`<div>${when(show(), html`<p>Yes</p>`)}</div>`            // ✅ directive arguments
 *   html`<div>${repeat(items(), (i) => html`…`)}</div>`            // ✅
 *
 *   html`<div>${show() ? html`<p>Yes</p>` : ''}</div>`            // ❌ THANE404: use when()
 *   html`<ul>${items().map((i) => html`<li>${i}</li>`)}</ul>`     // ❌ THANE404: use repeat()
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';
import { createReporter, isTaggedWith } from './lint-utils.js';

/** Directive calls whose arguments may legitimately contain html`` */
const DIRECTIVE_CALLS: ReadonlySet<string> = new Set([FN.REPEAT, FN.WHEN]);

const isDirectiveCall = (node: ts.Node): boolean => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return ts.isIdentifier(callee) && DIRECTIVE_CALLS.has(callee.text);
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.NO_NESTED_HTML_TAGS, 'error');

  const visit = (node: ts.Node, insideHtmlTag: boolean) => {
    if (isTaggedWith(node, [FN.HTML])) {
      if (insideHtmlTag) {
        report(
          node,
          "An 'html' template here is not compiled: inside another template, one is compiled where it is the whole " +
            '${…} or a directive argument. Use when() to choose between templates, and repeat() for a list.',
        );
        // Still visit children to catch deeper nesting
      }
      // A template that is the whole `${}` is inlined; anything else in a `${}` is inside this one
      const template = node.template;
      if (ts.isTemplateExpression(template)) {
        for (const span of template.templateSpans) visit(span.expression, !isTaggedWith(span.expression, [FN.HTML]));
      }
      return;
    }

    // Directive calls (repeat, when) inside html`` reset the nesting —
    // their template arguments are processed independently by the compiler.
    if (insideHtmlTag && isDirectiveCall(node)) {
      ts.forEachChild(node, (child) => visit(child, false));
      return;
    }

    ts.forEachChild(node, (child) => visit(child, insideHtmlTag));
  };

  visit(sourceFile, false);
  return diagnostics;
};

export const noNestedHtmlTags: LintRuleDefinition = {
  meta: {
    code: ErrorCode.NO_NESTED_HTML_TAGS,
    name: 'no-nested-html-tags',
    severity: 'error',
    description: 'An html`` template inside another is the whole ${…} or a directive argument.',
  },
  check,
};
