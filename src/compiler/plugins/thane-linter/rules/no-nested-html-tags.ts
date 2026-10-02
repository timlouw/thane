/**
 * THANE404 — no-nested-html-tags
 *
 * An `html` tagged template inside another is compiled where it is the whole `${}` (it is inlined), an argument
 * of a directive (a branch, a row, an empty template), a branch of JavaScript control flow in content (a
 * ternary, `&&`, a `.map()` row), which the compiler turns into the directive it means, or a prop of a child
 * component (a slot, compiled in this template's scope). Anywhere else in a `${}` it would be a plain value, and
 * it is reported:
 *
 *   html`<div>${html`<span>${count()}</span>`}</div>`             // ✅ inlined
 *   html`<div>${when(show(), html`<p>Yes</p>`)}</div>`            // ✅ directive arguments
 *   html`<div>${show() ? html`<p>Yes</p>` : null}</div>`          // ✅ control flow in content
 *   html`<ul>${items().map((i) => html`<li>${i}</li>`)}</ul>`     // ✅
 *   html`${Card({ body: html`<p>${note()}</p>` })}`               // ✅ a slot
 *
 *   html`<div title=${show() ? html`<b>a</b>` : ''}>x</div>`      // ❌ THANE404: in a tag
 *   html`<div>${label(html`<b>a</b>`)}</div>`                     // ❌ THANE404: a plain value
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

/** The value of a property of the props object of a child component call: `Card({ body: html`…` })` */
const isSlotValue = (node: ts.Node): node is ts.PropertyAssignment =>
  ts.isPropertyAssignment(node) &&
  ts.isObjectLiteralExpression(node.parent) &&
  ts.isCallExpression(node.parent.parent) &&
  node.parent.parent.arguments[0] === node.parent &&
  ts.isIdentifier(node.parent.parent.expression) &&
  /^[A-Z]/.test(node.parent.parent.expression.text) &&
  isTaggedWith(node.initializer, [FN.HTML]);

const unwrap = (node: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};

/**
 * The branches of control flow in content, where a template goes: a ternary's two (and those of the ternaries
 * nested in them), the right side of `&&`, a `.map()` row's body. Null for any other expression.
 */
const branchesOf = (expr: ts.Expression): { branches: ts.Expression[]; rest: ts.Node[] } | null => {
  const node = unwrap(expr);
  if (ts.isConditionalExpression(node)) {
    const inner = [node.whenTrue, node.whenFalse].map((b) => branchesOf(b) ?? { branches: [b], rest: [] });
    return { branches: inner.flatMap((b) => b.branches), rest: [node.condition, ...inner.flatMap((b) => b.rest)] };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const right = branchesOf(node.right) ?? { branches: [node.right], rest: [] };
    return { branches: right.branches, rest: [node.left, ...right.rest] };
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'map' &&
    node.arguments.length === 1
  ) {
    const row = node.arguments[0]!;
    if (ts.isArrowFunction(row) && !ts.isBlock(row.body)) {
      return { branches: [row.body], rest: [node.expression.expression, ...row.parameters] };
    }
  }
  return null;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.NO_NESTED_HTML_TAGS, 'error');

  const visit = (node: ts.Node, insideHtmlTag: boolean) => {
    if (isTaggedWith(node, [FN.HTML])) {
      if (insideHtmlTag) {
        report(
          node,
          "An 'html' template here is not compiled: inside another template, one is compiled where it is the whole " +
            '${…}, a directive argument, or a branch of a ternary, && or .map() in content.',
        );
        // Still visit children to catch deeper nesting
      }
      const template = node.template;
      if (ts.isTemplateExpression(template)) {
        // The markup so far, each `${}` standing as one character: whether a span is in an element's tag
        let markup = template.head.rawText ?? template.head.text;
        for (const span of template.templateSpans) {
          const inTag = /<[A-Za-z][^<>]*$/.test(markup);
          markup += '_' + (span.literal.rawText ?? span.literal.text);
          const flow = inTag ? null : branchesOf(span.expression);
          if (flow) {
            for (const branch of flow.branches) visit(branch, !isTaggedWith(unwrap(branch), [FN.HTML]));
            for (const other of flow.rest) visit(other, true);
            continue;
          }
          // A template that is the whole `${}` is inlined; anything else in a `${}` is inside this one
          visit(span.expression, !isTaggedWith(span.expression, [FN.HTML]));
        }
      }
      return;
    }

    // Directive calls (repeat, when) inside html`` reset the nesting —
    // their template arguments are processed independently by the compiler.
    if (insideHtmlTag && isDirectiveCall(node)) {
      ts.forEachChild(node, (child) => visit(child, false));
      return;
    }

    // A child component's prop that is a template is a slot, compiled on its own
    if (insideHtmlTag && isSlotValue(node)) {
      visit(node.initializer, false);
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
    description:
      'An html`` template inside another is the whole ${…}, a directive argument, or a branch of control flow in content.',
  },
  check,
};
