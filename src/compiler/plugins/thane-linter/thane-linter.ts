/**
 * Thane Linter — built-in esbuild plugin
 *
 * Runs on every `.ts` file during `thane dev` and `thane build`.
 * Reuses the same TypeScript AST the rest of the compiler uses,
 * so there's zero extra parsing overhead.
 *
 * Rules are pure functions:  (sourceFile, filePath) → Diagnostic[]
 * Add new rules by creating a file in `rules/` and adding it to
 * the `allRules` array in `rules/index.ts`.
 */

import type { Plugin } from 'esbuild';
import { sourceCache, logger, PLUGIN_NAME, extendsComponentQuick } from '../../utils/index.js';
import { hasErrors } from '../../errors.js';
import { allRules } from './rules/index.js';
import type { Diagnostic } from '../../types.js';
import type { LintRuleDefinition } from './rules/types.js';

const NAME = PLUGIN_NAME.LINTER;

/** Rule codes that apply to entry-point files (mount() calls), not just component files */
const ENTRY_POINT_RULES = new Set(['THANE411']);

/** Quick string check for files that contain mount() calls */
const hasMountCall = (source: string): boolean => source.includes('mount(');

export interface ThaneLinterOptions {
  /**
   * Extra rules to append to the built-in set.
   * Useful for project-specific conventions.
   */
  extraRules?: LintRuleDefinition[];

  /**
   * Rule codes to suppress (e.g. ['THANE401'] to silence property-order warnings).
   */
  suppress?: string[];
}

export const ThaneLinterPlugin = (options: ThaneLinterOptions = {}): Plugin => {
  const rules: readonly LintRuleDefinition[] = options.extraRules ? [...allRules, ...options.extraRules] : allRules;

  const suppress = new Set(options.suppress ?? []);

  return {
    name: NAME,
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        const source = await sourceCache.get(args.path);
        if (!source) return undefined;

        const isComponent = extendsComponentQuick(source.source);
        const isEntryPoint = hasMountCall(source.source);

        // Skip files that are neither component files nor entry points
        if (!isComponent && !isEntryPoint) return undefined;

        const diagnostics: Diagnostic[] = [];

        for (const rule of rules) {
          if (suppress.has(rule.meta.code)) continue;

          // Skip entry-point-only rules on non-entry files, and
          // skip component-only rules on non-component files
          const isEntryRule = ENTRY_POINT_RULES.has(rule.meta.code);
          if (isEntryRule && !isEntryPoint) continue;
          if (!isEntryRule && !isComponent) continue;

          const results = rule.check(source.sourceFile, args.path);
          diagnostics.push(...results);
        }

        if (diagnostics.length > 0) {
          logger.diagnostics(diagnostics);

          // If any rule produced an error, fail the build for this file
          if (hasErrors(diagnostics)) {
            return {
              errors: diagnostics
                .filter((d) => d.severity === 'error')
                .map((d) => ({
                  text: d.message,
                  location: d.location
                    ? {
                        file: d.location.file,
                        line: d.location.line,
                        column: d.location.column - 1, // esbuild uses 0-based columns
                      }
                    : null,
                })),
            };
          }
        }

        // Return undefined — don't transform the source, just lint it
        return undefined;
      });
    },
  };
};
