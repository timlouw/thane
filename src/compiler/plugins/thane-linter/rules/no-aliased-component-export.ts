/**
 * THANE409 — no-aliased-component-export
 *
 * A component is exported where it is declared:
 *
 *   export const MyCounter = defineComponent(() => { ... });  // ✅
 *
 * The compiler derives a component's selector from the name it is declared under, so an export under
 * another name, or a separate export statement, would name it differently from its selector:
 *
 *   const _Internal = defineComponent(() => { ... });
 *   export { _Internal as MyCounter };  // ❌ THANE409
 *
 * A re-export of a component another file declares is fine: a file of re-exports (a barrel) works, and
 * child calls follow it to the component's own file.
 */

import ts from 'typescript';
import type { Diagnostic } from '../../../types.js';
import type { LintRuleDefinition } from './types.js';
import { ErrorCode } from '../../../errors.js';
import { createReporter, isDefineComponentExpr } from './lint-utils.js';

const check = (sourceFile: ts.SourceFile, filePath: string): Diagnostic[] => {
  const { diagnostics, report } = createReporter(sourceFile, filePath, ErrorCode.NO_ALIASED_COMPONENT_EXPORT, 'error');

  // Collect all local variable names that are assigned defineComponent()
  const componentVarNames = new Set<string>();

  const collectComponentVars = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && isDefineComponentExpr(decl.initializer)) {
          componentVarNames.add(decl.name.text);
        }
      }
    }
    ts.forEachChild(node, collectComponentVars);
  };
  collectComponentVars(sourceFile);

  // An export statement of a local component: export { X as Y }, or export { X }
  for (const stmt of sourceFile.statements) {
    if (
      ts.isExportDeclaration(stmt) &&
      !stmt.moduleSpecifier &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      // Skip type-only export declarations: export type { ... } from '...'
      if (stmt.isTypeOnly) continue;

      for (const spec of stmt.exportClause.elements) {
        // Skip inline type-only specifiers: export { type X } from '...'
        if (spec.isTypeOnly) continue;

        const localName = (spec.propertyName ?? spec.name).text;
        const exportedName = spec.name.text;

        // Aliased export of a local component variable
        if (componentVarNames.has(localName) && localName !== exportedName) {
          report(
            spec,
            `Aliased component export is not supported: '${localName}' exported as '${exportedName}'. ` +
              'The compiler derives the selector from the declaration name, not the exported name. ' +
              `Use 'export const ${exportedName} = defineComponent(...)' instead.`,
          );
        }

        // Non-aliased deferred export of a component: const X = ...; export { X };
        // This is allowed in principle (name matches), but the compiler's
        // extractComponentDefinitions only finds `export const X = defineComponent(...)`.
        // A separate `export { X }` won't be detected. Block it for safety.
        if (componentVarNames.has(localName) && localName === exportedName) {
          report(
            spec,
            `Deferred component export is not supported. The compiler requires the export keyword ` +
              `on the declaration: export const ${exportedName} = defineComponent(...)`,
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
    description: 'A component is exported where it is declared, under its own name.',
  },
  check,
};
