/**
 * THANE413 — no-aliased-thane-import
 *
 * The compiler finds the template markers (`html`, `css`, `when`, `repeat`) and
 * `defineComponent` by their names, so they are imported under those names:
 *
 *   import { defineComponent, html, repeat } from 'thane';  // ✅
 *
 *   import { html as h } from 'thane';                      // ❌ THANE413: h`…` is never compiled
 *
 *   import * as thane from 'thane';
 *   thane.html`<p>…</p>`;                                   // ❌ THANE413
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';
import { createReporter } from './lint-utils.js';

/** The names the compiler reads a construct by. */
const COMPILED_BY_NAME: ReadonlySet<string> = new Set([FN.HTML, FN.CSS, FN.WHEN, FN.REPEAT, FN.DEFINE_COMPONENT]);

const importLine = (name: string): string => `import { ${name} } from 'thane'`;

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.NO_ALIASED_THANE_IMPORT, 'error');

  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== 'thane') continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (element.isTypeOnly || !COMPILED_BY_NAME.has(imported) || element.name.text === imported) continue;
      report(
        element,
        `'${imported}' is imported as '${element.name.text}', and the compiler finds it only by its own name. ` +
          `Import it as '${imported}': ${importLine(imported)}`,
      );
    }
  }

  if (namespaces.size > 0) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text) &&
        COMPILED_BY_NAME.has(node.name.text)
      ) {
        report(
          node,
          `'${node.getText(sourceFile)}' is not compiled: the compiler finds '${node.name.text}' only by its own name. ` +
            `Import it by name: ${importLine(node.name.text)}`,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return diagnostics;
};

export const noAliasedThaneImport: LintRuleDefinition = {
  meta: {
    code: ErrorCode.NO_ALIASED_THANE_IMPORT,
    name: 'no-aliased-thane-import',
    severity: 'error',
    description: 'The template markers and defineComponent are imported from thane under their own names.',
  },
  check,
};
