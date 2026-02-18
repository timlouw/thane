/**
 * THANE403 — require-const-tagged-templates
 *
 * Tagged template literals `html` and `css` must be declared with `const`,
 * not `let` or `var`:
 *
 *   const header = html`<header>Title</header>`;  // ✅
 *   const styles = css`:host { color: red }`;     // ✅
 *
 *   let header = html`<header>Title</header>`;    // ❌ THANE403
 *   var styles = css`:host { color: red }`;       // ❌ THANE403
 *
 * Templates declared with `let`/`var` can be reassigned, making it
 * impossible for the compiler to resolve their value at compile time.
 * The compiler's template processing pipeline requires a statically
 * known template literal to generate binding code.
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode, createError } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';

/** Tag names that require `const` declarations */
const TEMPLATE_TAGS: ReadonlySet<string> = new Set([FN.HTML, FN.CSS]);

/**
 * Check whether a TaggedTemplateExpression uses one of the template tags.
 */
const isTemplateTag = (node: ts.TaggedTemplateExpression): string | null => {
  const tag = node.tag;
  if (ts.isIdentifier(tag) && TEMPLATE_TAGS.has(tag.text)) {
    return tag.text;
  }
  return null;
};

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      const flags = node.declarationList.flags;
      const isConst = (flags & ts.NodeFlags.Const) !== 0;

      if (!isConst) {
        const isLet = (flags & ts.NodeFlags.Let) !== 0;
        const keyword = isLet ? 'let' : 'var';

        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && ts.isTaggedTemplateExpression(decl.initializer)) {
            const tagName = isTemplateTag(decl.initializer);
            if (tagName) {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(decl.getStart());
              diagnostics.push(
                createError(
                  `'${tagName}\`\`' tagged template must use 'const', not '${keyword}'. ` +
                    `Templates declared with '${keyword}' can be reassigned and cannot be resolved at compile time.`,
                  { file: filePath, line: line + 1, column: character + 1 },
                  ErrorCode.REQUIRE_CONST_TAGGED_TEMPLATES,
                ),
              );
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
};

export const requireConstTaggedTemplates: LintRuleDefinition = {
  meta: {
    code: ErrorCode.REQUIRE_CONST_TAGGED_TEMPLATES,
    name: 'require-const-tagged-templates',
    severity: 'error',
    description: "html`` and css`` tagged templates must use 'const' declarations.",
  },
  check,
};
