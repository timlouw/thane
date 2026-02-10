/**
 * THANE405 — no-conditional-template-init
 *
 * Variables initialized with `html` or `css` tagged templates must use
 * a direct tagged template literal — not a conditional (ternary), logical
 * expression, or other dynamic initializer:
 *
 *   const header = html`<header>Title</header>`;              // ✅
 *   const styles = css`:host { color: red }`;                 // ✅
 *
 *   const tpl = isAdmin                                       // ❌ THANE405
 *     ? html`<div>Admin</div>`
 *     : html`<div>User</div>`;
 *
 *   const tpl = show && html`<div>Content</div>`;             // ❌ THANE405
 *
 * The compiler resolves template variable values at compile time via AST
 * analysis. A conditional initializer is opaque — the compiler cannot
 * determine which branch is taken, so the template cannot be inlined.
 * Use `whenElse()` for conditional template rendering instead.
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode, createWarning } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';

/** Tag names that cannot appear in conditional initializers */
const TEMPLATE_TAGS: ReadonlySet<string> = new Set([FN.HTML, FN.CSS]);

/**
 * Recursively check whether a node contains an html`` or css`` tagged template.
 */
const containsTemplateTag = (node: ts.Node): boolean => {
  if (ts.isTaggedTemplateExpression(node)) {
    const tag = node.tag;
    if (ts.isIdentifier(tag) && TEMPLATE_TAGS.has(tag.text)) return true;
  }
  let found = false;
  node.forEachChild((child) => {
    if (!found) found = containsTemplateTag(child);
  });
  return found;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = node.initializer;

      // Ternary: const tpl = cond ? html`a` : html`b`
      if (ts.isConditionalExpression(init)) {
        if (containsTemplateTag(init.whenTrue) || containsTemplateTag(init.whenFalse)) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          diagnostics.push(
            createWarning(
              'Conditional assignment of tagged templates is not supported. ' +
              "The compiler cannot determine which template to use at compile time. Use 'whenElse()' instead.",
              { file: filePath, line: line + 1, column: character + 1 },
              ErrorCode.NO_CONDITIONAL_TEMPLATE_INIT,
            ),
          );
        }
      }

      // Logical expressions: const tpl = show && html`a`  or  const tpl = a || html`b`
      if (ts.isBinaryExpression(init) &&
          (init.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
           init.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
           init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
        if (containsTemplateTag(init.left) || containsTemplateTag(init.right)) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          diagnostics.push(
            createWarning(
              'Logical expression assignment of tagged templates is not supported. ' +
              "The compiler cannot resolve the template value at compile time. Use 'whenElse()' instead.",
              { file: filePath, line: line + 1, column: character + 1 },
              ErrorCode.NO_CONDITIONAL_TEMPLATE_INIT,
            ),
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
};

export const noConditionalTemplateInit: LintRuleDefinition = {
  meta: {
    code: ErrorCode.NO_CONDITIONAL_TEMPLATE_INIT,
    name: 'no-conditional-template-init',
    severity: 'warning',
    description: 'Tagged templates must not use conditional/logical initializers.',
  },
  check,
};
