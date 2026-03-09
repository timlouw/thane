/**
 * THANE409 — no-aliased-component-export
 *
 * Components must be exported directly at the declaration site:
 *
 *   export const MyCounter = defineComponent(() => { ... });  // ✅
 *
 * Aliased or re-exported components prevent the compiler from correctly
 * deriving the selector, since the compiler looks at the variable name
 * at the declaration site, not the exported name:
 *
 *   const _Internal = defineComponent(() => { ... });
 *   export { _Internal as MyCounter };  // ❌ THANE409
 *
 *   export { MyCounter } from './counter.js';  // ❌ THANE409 (re-export)
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode, createError } from '../../../errors.js';
import { FN } from '../../../utils/constants.js';

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  // Collect all local variable names that are assigned defineComponent()
  const componentVarNames = new Set<string>();

  const collectComponentVars = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isCallExpression(decl.initializer) &&
          ts.isIdentifier(decl.initializer.expression) &&
          decl.initializer.expression.text === FN.DEFINE_COMPONENT
        ) {
          componentVarNames.add(decl.name.text);
        }
      }
    }
    ts.forEachChild(node, collectComponentVars);
  };
  collectComponentVars(sourceFile);

  // Check for aliased exports: export { X as Y } where X is a component
  // Check for re-exports: export { X } from './file.js' (any re-export of a defineComponent)
  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      // Skip type-only export declarations: export type { ... } from '...'
      if (stmt.isTypeOnly) continue;

      for (const spec of stmt.exportClause.elements) {
        // Skip inline type-only specifiers: export { type X } from '...'
        if (spec.isTypeOnly) continue;

        const localName = (spec.propertyName ?? spec.name).text;
        const exportedName = spec.name.text;

        // Re-export from another module — we can't verify if it's a component,
        // but if the module specifier is present, it's a re-export
        if (stmt.moduleSpecifier) {
          // Only warn if the name looks like a PascalCase component name
          if (/^[A-Z]/.test(exportedName)) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(spec.getStart());
            diagnostics.push(
              createError(
                `Component re-exports are not supported. Define the component in this file instead: ` +
                  `export const ${exportedName} = defineComponent(...)`,
                { file: filePath, line: line + 1, column: character + 1 },
                ErrorCode.NO_ALIASED_COMPONENT_EXPORT,
              ),
            );
          }
          continue;
        }

        // Aliased export of a local component variable
        if (componentVarNames.has(localName) && localName !== exportedName) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(spec.getStart());
          diagnostics.push(
            createError(
              `Aliased component export is not supported: '${localName}' exported as '${exportedName}'. ` +
                'The compiler derives the selector from the declaration name, not the exported name. ' +
                `Use 'export const ${exportedName} = defineComponent(...)' instead.`,
              { file: filePath, line: line + 1, column: character + 1 },
              ErrorCode.NO_ALIASED_COMPONENT_EXPORT,
            ),
          );
        }

        // Non-aliased deferred export of a component: const X = ...; export { X };
        // This is allowed in principle (name matches), but the compiler's
        // extractComponentDefinitions only finds `export const X = defineComponent(...)`.
        // A separate `export { X }` won't be detected. Block it for safety.
        if (componentVarNames.has(localName) && localName === exportedName) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(spec.getStart());
          diagnostics.push(
            createError(
              `Deferred component export is not supported. The compiler requires the export keyword ` +
                `on the declaration: export const ${exportedName} = defineComponent(...)`,
              { file: filePath, line: line + 1, column: character + 1 },
              ErrorCode.NO_ALIASED_COMPONENT_EXPORT,
            ),
          );
        }
      }
    }
  }

  return diagnostics;
};

export const noAliasedComponentExport: LintRuleDefinition = {
  meta: {
    code: ErrorCode.NO_ALIASED_COMPONENT_EXPORT,
    name: 'no-aliased-component-export',
    severity: 'error',
    description: 'Components must be exported directly at the declaration site, not aliased or re-exported.',
  },
  check,
};
