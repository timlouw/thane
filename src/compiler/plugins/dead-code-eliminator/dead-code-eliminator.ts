import ts from 'typescript';
import type { Plugin } from 'esbuild';
import { logger } from '../../utils/index.js';

const NAME = 'dead-code-eliminator';

/**
 * Tracked signal info from AST analysis
 */
interface SignalInfo {
  name: string;
  initialValue: ts.Expression | undefined;
  isLiteralFalse: boolean;
  /** Number of call expressions where the signal is called with arguments (i.e. mutations) */
  mutationCount: number;
}

/**
 * Walk a TypeScript AST node tree, calling visitor for every node.
 */
const walkAST = (node: ts.Node, visitor: (n: ts.Node) => void): void => {
  visitor(node);
  node.forEachChild(child => walkAST(child, visitor));
};

/**
 * Analyze the source using TypeScript AST to find signal declarations and their mutations.
 * 
 * Looks for the Thane signal pattern:
 *   this._signalName = signal(initialValue)
 * and tracks whether each signal is ever called with arguments (mutated).
 */
const analyzeSignals = (sourceFile: ts.SourceFile): Map<string, SignalInfo> => {
  const signals = new Map<string, SignalInfo>();

  walkAST(sourceFile, (node) => {
    // Detect: this.X = <signalFactory>(initialValue)
    // In minified code this may appear as: f(this,"_x",T(false))
    // We detect property assignments where RHS is a call to the signal factory
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      const right = node.right;

      // Check if left side is this.property access
      if (ts.isPropertyAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const propName = left.name.text;
        // Check if RHS is a call expression with exactly one argument (signal factory call)
        if (ts.isCallExpression(right) && right.arguments.length === 1) {
          const arg = right.arguments[0]!;
          const isLiteralFalse = arg.kind === ts.SyntaxKind.FalseKeyword;
          signals.set(propName, {
            name: propName,
            initialValue: arg,
            isLiteralFalse,
            mutationCount: 0,
          });
        }
      }
    }

    // Also detect minified __defProp helper pattern: f(this, "_name", T(value))
    // This appears as a call expression with 3 args where arg[0]=this, arg[1]=string, arg[2]=call
    if (ts.isCallExpression(node) && node.arguments.length === 3) {
      const [arg0, arg1, arg2] = node.arguments;
      if (arg0 && arg0.kind === ts.SyntaxKind.ThisKeyword &&
          arg1 && ts.isStringLiteral(arg1) && arg1.text.startsWith('_') &&
          arg2 && ts.isCallExpression(arg2) && arg2.arguments.length === 1) {
        const propName = arg1.text;
        const initArg = arg2.arguments[0]!;
        const isLiteralFalse = initArg.kind === ts.SyntaxKind.FalseKeyword;
        signals.set(propName, {
          name: propName,
          initialValue: initArg,
          isLiteralFalse,
          mutationCount: 0,
        });
      }
    }
  });

  // Second pass: count mutations (this.signalName(someValue) — call with args)
  walkAST(sourceFile, (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const expr = node.expression;
      if (ts.isPropertyAccessExpression(expr) && expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const propName = expr.name.text;
        const info = signals.get(propName);
        if (info) {
          info.mutationCount++;
        }
      }
    }
  });

  return signals;
};

/**
 * Remove empty callbacks and compress patterns using string operations.
 * These are safe post-minification cleanups that don't need AST analysis.
 */
const compressOutput = (source: string): string => {
  let result = source;

  // Simplify ()=>{return[]} to ()=>[]
  result = result.replace(/\(\)\s*=>\s*\{\s*return\s*\[\s*\];\s*\}/g, '()=>[]');

  // Remove redundant semicolons
  result = result.replace(/;+\}/g, '}');
  result = result.replace(/;{2,}/g, ';');

  // Clean up empty arrays with trailing commas
  result = result.replace(/return\s*\[[,\s]*\]/g, 'return[]');
  result = result.replace(/,+\]/g, ']');
  result = result.replace(/,{2,}/g, ',');

  return result;
};

export const DeadCodeEliminatorPlugin: Plugin = {
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

          // Parse the minified JS into an AST
          const sourceFile = ts.createSourceFile(
            file.path,
            originalContent,
            ts.ScriptTarget.ESNext,
            /* setParentNodes */ true,
            ts.ScriptKind.JS
          );

          const signals = analyzeSignals(sourceFile);

          let modifiedCount = 0;
          let staticCount = 0;
          let deadCount = 0;

          for (const [, info] of signals) {
            if (info.mutationCount > 0) {
              modifiedCount++;
            } else {
              staticCount++;
              if (info.isLiteralFalse) deadCount++;
            }
          }

          if (signals.size > 0) {
            logger.info(NAME, `Analyzed ${signals.size} signals: ${staticCount} static (${deadCount} always-false), ${modifiedCount} modified`);
          }

          // Apply safe compression patterns
          // Note: console removal is handled by esbuild's `drop: ['console']` in prod config
          let optimized = compressOutput(originalContent);

          const newContents = new TextEncoder().encode(optimized);
          const savedBytes = originalSize - newContents.length;
          totalSaved += savedBytes;

          result.outputFiles[i] = {
            path: file.path,
            contents: newContents,
            text: optimized,
            hash: file.hash,
          };
        }
      }

      const elapsed = (performance.now() - startTime).toFixed(2);
      const savedKB = (totalSaved / 1024).toFixed(2);

      if (totalSaved > 0) {
        logger.info(NAME, `Dead code elimination saved ${savedKB} KB in ${elapsed}ms`);
      }
    });
  },
};
