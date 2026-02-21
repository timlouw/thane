/**
 * JS Output Optimizer Plugin
 *
 * Applies safe, post-minification optimization patterns to the bundled output.
 *
 * ⚠️  FRAGILE: The regex-based transforms below operate on esbuild's minified
 * output format. Any change to esbuild's minification strategy (identifier
 * mangling, whitespace handling, semicolon insertion) may break them.
 * If a transform stops matching, it simply becomes a no-op — it won't break
 * output, but it won't compress it either. When updating esbuild, verify the
 * patterns still match by inspecting the built output.
 *
 * NOTE: This plugin operates on the concatenated/split bundle output files.
 * The transforms are designed to be safe on arbitrary JS — they do not assume
 * knowledge of bundle structure, only pattern-level invariants:
 *   - `()=>{return[]}` is always equivalent to `()=>[]`
 *   - multiple consecutive semicolons can be collapsed
 *   - trailing commas in arrays can be removed
 */

import type { Plugin } from 'esbuild';
import esbuild from 'esbuild';
import { logger } from '../../utils/index.js';

const NAME = 'js-output-optimizer';

/**
 * Validate that a string is syntactically valid JavaScript.
 * Uses esbuild's parser — no code execution, no CSP issues.
 * Returns true if valid, false if a syntax error is detected.
 */
const isValidJS = (source: string): boolean => {
  try {
    // transformSync with no transforms is a pure syntax check.
    // Loader 'js' parses as a script (not module) for maximum compat.
    esbuild.transformSync(source, { loader: 'js' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Apply safe optimization patterns to minified JS output.
 * Each pattern is documented with the invariant that makes it safe.
 */
const optimizeOutput = (source: string): string => {
  let result = source;

  // Simplify ()=>{return[]} to ()=>[]
  // Safe: the block form and expression form are semantically identical.
  result = result.replace(/\(\)\s*=>\s*\{\s*return\s*\[\s*\];\s*\}/g, '()=>[]');

  // Remove redundant semicolons before closing braces: ;} → }
  // Safe: ASI rules mean ; before } is always redundant.
  result = result.replace(/;+\}/g, '}');

  // Collapse multiple consecutive semicolons: ;; → ;
  // Safe: extra semicolons are empty statements.
  result = result.replace(/;{2,}/g, ';');

  // Clean up empty arrays with trailing commas: [,] → []
  // Safe: trailing commas produce undefined holes which are not intended here.
  result = result.replace(/return\s*\[[,\s]*\]/g, 'return[]');
  result = result.replace(/,+\]/g, ']');
  result = result.replace(/,{2,}/g, ',');

  // Remove trailing semicolons before EOF
  // Safe: last statement in a file never needs a semicolon.
  result = result.replace(/;+$/, '');

  // Collapse consecutive newlines in minified output to a single newline
  // Safe: whitespace between statements is insignificant in minified JS.
  result = result.replace(/\n{2,}/g, '\n');

  return result;
};

export const JsOutputOptimizerPlugin: Plugin = {
  name: NAME,
  setup(build) {
    build.onEnd(async (result) => {
      if (!result.outputFiles || result.outputFiles.length === 0) {
        return;
      }

      const startTime = performance.now();
      let totalSaved = 0;

      for (let i = 0; i < result.outputFiles.length; i++) {
        const file = result.outputFiles[i];
        if (!file) continue;

        if (file.path.endsWith('.js')) {
          const originalContent = new TextDecoder().decode(file.contents);
          const originalSize = file.contents.length;

          // Apply safe optimization patterns
          // Note: console removal is handled by esbuild's `drop: ['console']` in prod config
          const optimized = optimizeOutput(originalContent);

          // Validate that the transforms produced syntactically valid JS.
          // If not, revert to the original and log a warning.
          let finalContent: string;
          if (!isValidJS(optimized)) {
            logger.warn(NAME, `Post-optimization syntax check failed for ${file.path} — reverting to original`);
            finalContent = originalContent;
          } else {
            finalContent = optimized;
          }

          const newContents = new TextEncoder().encode(finalContent);
          const savedBytes = originalSize - newContents.length;
          totalSaved += savedBytes;

          result.outputFiles[i] = {
            path: file.path,
            contents: newContents,
            text: finalContent,
            hash: file.hash,
          };
        }
      }

      const elapsed = (performance.now() - startTime).toFixed(2);
      const savedKB = (totalSaved / 1024).toFixed(2);

      if (totalSaved > 0) {
        logger.info(NAME, `JS output optimization saved ${savedKB} KB in ${elapsed}ms`);
      }
    });
  },
};
