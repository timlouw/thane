/**
 * THANE404 — no-nested-html-tags
 *
 * An `html` tagged template literal must not appear inside another
 * `html` tagged template literal:
 *
 *   html`<div>${count()}</div>`                           // ✅
 *   html`<div>${whenElse(show(), html`<p>Yes</p>`)}</div>` // ✅ (directive arg)
 *   html`<div>${repeat(items(), (i) => html`…`)}</div>`    // ✅ (repeat arg)
 *
 *   html`<div>${html`<span>${count()}</span>`}</div>`     // ❌ THANE404
 *
 * The compiler's `findHtmlTemplates()` deliberately skips nested html``
 * expressions to avoid double-processing. The inner template will NOT be
 * processed for signal bindings, ID injection, or subscription generation —
 * it will be treated as raw text at runtime.
 *
 * Exception: html`` inside arguments to `repeat()`, `when()`, or `whenElse()`
 * are processed by the compiler as sub-templates and are therefore allowed.
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode, createError } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';

const isHtmlTag = (node: ts.TaggedTemplateExpression): boolean => {
  const tag = node.tag;
  return ts.isIdentifier(tag) && tag.text === FN.HTML;
};

/** Directive calls whose arguments may legitimately contain html`` */
const DIRECTIVE_CALLS: ReadonlySet<string> = new Set([FN.REPEAT, FN.WHEN, FN.WHEN_ELSE]);

const isDirectiveCall = (node: ts.Node): boolean => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return ts.isIdentifier(callee) && DIRECTIVE_CALLS.has(callee.text);
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  const visit = (node: ts.Node, insideHtmlTag: boolean) => {
    if (ts.isTaggedTemplateExpression(node) && isHtmlTag(node)) {
      if (insideHtmlTag) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        diagnostics.push(
          createError(
            "Nested 'html' tagged templates are not supported. The inner template will not be " +
            'processed for signal bindings or subscriptions. Extract it into a const variable instead.',
            { file: filePath, line: line + 1, column: character + 1 },
            ErrorCode.NO_NESTED_HTML_TAGS,
          ),
        );
        // Still visit children to catch deeper nesting
      }
      // Children of this html`` are now "inside"
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }

    // Directive calls (repeat, when, whenElse) inside html`` reset the nesting —
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
    description: "html`` tagged templates must not be nested inside another html``.",
  },
  check,
};
