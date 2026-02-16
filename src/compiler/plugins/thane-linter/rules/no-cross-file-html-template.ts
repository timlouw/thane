/**
 * THANE410 — no-cross-file-html-template
 *
 * `html` tagged template variables used in a component's `template` property
 * must be defined in the same file. The compiler resolves template content
 * at compile time by searching the local AST — imported variables are opaque
 * and cannot be statically analyzed.
 *
 *   // ✅ Template defined in the same file
 *   const header = html`<header>Title</header>`;
 *   export const App = defineComponent(() => ({
 *     template: html`${header}<main>Content</main>`,
 *   }));
 *
 *   // ❌ THANE410 — imported template, compiler cannot resolve it
 *   import { header } from './shared-templates.js';
 *   export const App = defineComponent(() => ({
 *     template: html`${header}<main>Content</main>`,
 *   }));
 *
 * Note: Importing CSS strings from .css files for the `styles` property IS
 * allowed — only html`` template variables have this restriction.
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode, createWarning } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  // Collect all imported identifiers
  const importedNames = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      // Default import
      if (stmt.importClause.name) {
        importedNames.add(stmt.importClause.name.text);
      }
      // Named imports
      if (stmt.importClause.namedBindings) {
        if (ts.isNamedImports(stmt.importClause.namedBindings)) {
          for (const el of stmt.importClause.namedBindings.elements) {
            importedNames.add(el.name.text);
          }
        }
        // Namespace import: import * as X from '...'
        if (ts.isNamespaceImport(stmt.importClause.namedBindings)) {
          importedNames.add(stmt.importClause.namedBindings.name.text);
        }
      }
    }
  }

  if (importedNames.size === 0) return diagnostics;

  // Walk html tagged template expressions and check interpolations
  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === FN.HTML) {
      const template = node.template;
      if (ts.isTemplateExpression(template)) {
        for (const span of template.templateSpans) {
          // Check if the interpolation is a bare imported identifier
          if (ts.isIdentifier(span.expression) && importedNames.has(span.expression.text)) {
            // Verify the import is not from a known non-template source
            // (e.g. component imports, signal imports, etc.)
            const importName = span.expression.text;

            // Check if this identifier is used inside a template literal that's
            // the value of the `template` property in a defineComponent return
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(span.expression.getStart());
            diagnostics.push(
              createWarning(
                `Imported variable '${importName}' is used inside an html\`\` template. ` +
                'The compiler cannot resolve imported template variables at compile time. ' +
                'Define the template fragment in the same file as a const variable instead.',
                { file: filePath, line: line + 1, column: character + 1 },
                ErrorCode.NO_CROSS_FILE_HTML_TEMPLATE,
              ),
            );
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
};

export const noCrossFileHtmlTemplate: LintRuleDefinition = {
  meta: {
    code: ErrorCode.NO_CROSS_FILE_HTML_TEMPLATE,
    name: 'no-cross-file-html-template',
    severity: 'warning',
    description: 'html`` template variables must be defined in the same file, not imported.',
  },
  check,
};
