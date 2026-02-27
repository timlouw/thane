/**
 * Second-pass AST minification via esbuild's transformSync.
 * Collapses redundancies introduced during bundle concatenation/splitting.
 */

import type { Plugin } from 'esbuild';
import esbuild from 'esbuild';
import { logger } from '../../utils/index.js';

const NAME = 'js-output-optimizer';

/** Validate that a string is syntactically valid JS via esbuild's parser. */
const isValidJS = (source: string): boolean => {
  try {
    esbuild.transformSync(source, { loader: 'js' });
    return true;
  } catch {
    return false;
  }
};

/** Re-minify JS via esbuild transformSync (syntax + whitespace). */
const optimizeOutput = (source: string): string => {
  try {
    const result = esbuild.transformSync(source, {
      loader: 'js',
      minifySyntax: true,
      minifyWhitespace: true,
    });
    // esbuild appends a trailing newline; strip it for a tight output.
    return result.code.replace(/\n$/, '');
  } catch {
    // Transform failed — return original; the safety-net isValidJS check will catch it.
    logger.verbose(`${NAME}: esbuild re-transform failed, keeping original`);
    return source;
  }
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

          const optimized = optimizeOutput(originalContent);

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
