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
  const rules: readonly LintRuleDefinition[] = options.extraRules
    ? [...allRules, ...options.extraRules]
    : allRules;

  const suppress = new Set(options.suppress ?? []);

  return {
    name: NAME,
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        // Only lint files that contain defineComponent
        const source = await sourceCache.get(args.path);
        if (!source) return undefined;
        if (!extendsComponentQuick(source.source)) return undefined;

        const diagnostics: Diagnostic[] = [];

        for (const rule of rules) {
          if (suppress.has(rule.meta.code)) continue;
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
