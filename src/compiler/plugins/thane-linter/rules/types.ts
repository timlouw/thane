/**
 * Thane Linter Rule Types
 *
 * Each rule is a pure function that receives a parsed AST and returns
 * diagnostics. This makes rules trivially composable and testable.
 */

import type ts from 'typescript';
import type { Diagnostic } from '../../../types.js';

/**
 * A lint rule function.
 *
 * Receives the parsed TypeScript AST and the file path, returns an array
 * of diagnostics (errors, warnings, or info). Returning an empty array
 * means the file passes the rule.
 */
export type LintRule = (sourceFile: ts.SourceFile, filePath: string) => Diagnostic[];

/**
 * Metadata describing a lint rule for documentation and filtering.
 */
export interface LintRuleMeta {
  /** Unique error code (e.g. 'THANE400') */
  code: string;
  /** Short human-readable name (e.g. 'no-default-export-component') */
  name: string;
  /** Default severity — can be overridden per-project in the future */
  severity: 'error' | 'warning' | 'info';
  /** One-line description shown in help output */
  description: string;
}

/**
 * A fully described lint rule: metadata + check function.
 *
 * To add a new rule:
 * 1. Create a file in `rules/` that exports a `LintRuleDefinition`.
 * 2. Import it in `thane-linter.ts` and add it to the `rules` array.
 */
export interface LintRuleDefinition {
  meta: LintRuleMeta;
  check: LintRule;
}
