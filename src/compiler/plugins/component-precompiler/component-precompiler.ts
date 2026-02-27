import fs from 'node:fs';
import type { Plugin } from 'esbuild';
import ts from 'typescript';
import vm from 'node:vm';
import type { ComponentDefinition, BuildContext } from '../../types.js';
import {
  findEnclosingClass,
  isSignalCall,
  sourceCache,
  logger,
  PLUGIN_NAME,
  FN,
  createLoaderResult,
  extendsComponentQuick,
  generateComponentHTML,
  createBuildContext,
} from '../../utils/index.js';
import { transformDefineComponentSource } from '../reactive-binding-compiler/index.js';
import { ErrorCode, createError } from '../../errors.js';

/** Sentinel distinguishing "evaluation failed" from "evaluated to undefined". */
const EVAL_FAILED = Symbol('EVAL_FAILED');
type EvalResult<T = any> = T | typeof EVAL_FAILED;

const NAME = PLUGIN_NAME.COMPONENT;

const createCTFEContext = (classProperties: Map<string, any>) => {
  const sandbox: Record<string, any> = {
    JSON,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  };

  for (const [key, value] of classProperties) {
    sandbox[key] = value;
  }

  return vm.createContext(sandbox);
};

/**
 * Remove `this.` property accesses from an expression string using AST-aware rewriting.
 * Only replaces `this.` in actual property accesses, not inside string literals.
 */
const stripThisAccessAST = (code: string): string => {
  try {
    const tempSource = ts.createSourceFile('__ctfe_temp.ts', code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const edits: { start: number; end: number }[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
        // Record the `this.` portion for removal (from `this` start to dot end)
        edits.push({
          start: node.expression.getStart(tempSource),
          end: node.expression.getEnd() + 1, // +1 for the dot
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(tempSource);

    // Apply edits in reverse order to preserve positions
    let result = code;
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i]!;
      result = result.substring(0, edit.start) + result.substring(edit.end);
    }
    return result;
  } catch {
    // Fallback: if AST parsing fails, return original
    return code;
  }
};

const evaluateExpressionCTFE = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  classProperties: Map<string, any>,
): EvalResult => {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return undefined;

  if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
    const propName = node.name.text;
    if (classProperties.has(propName)) {
      return classProperties.get(propName);
    }
    return EVAL_FAILED;
  }

  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, any> = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name) {
        let key: string;
        if (ts.isIdentifier(prop.name)) {
          key = prop.name.text;
        } else if (ts.isStringLiteral(prop.name)) {
          key = prop.name.text;
        } else if (ts.isNumericLiteral(prop.name)) {
          key = prop.name.text;
        } else {
          continue;
        }
        const value = evaluateExpressionCTFE(prop.initializer, sourceFile, classProperties);
        if (value === EVAL_FAILED) {
          return EVAL_FAILED;
        }
        obj[key] = value;
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        if (classProperties.has(key)) {
          obj[key] = classProperties.get(key);
        } else {
          return EVAL_FAILED;
        }
      }
    }
    return obj;
  }

  if (ts.isArrayLiteralExpression(node)) {
    const arr = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        return EVAL_FAILED;
      }
      const value = evaluateExpressionCTFE(el, sourceFile, classProperties);
      if (value === EVAL_FAILED) {
        return EVAL_FAILED;
      }
      arr.push(value);
    }
    return arr;
  }

  try {
    const context = createCTFEContext(classProperties);
    let code = node.getText(sourceFile);
    code = stripThisAccessAST(code);

    const result = vm.runInContext(`(${code})`, context, {
      timeout: 50,
    });
    return result;
  } catch {
    return EVAL_FAILED;
  }
};

const extractClassPropertiesCTFE = (
  classNode: ts.ClassExpression | ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
): Map<string, any> => {
  const resolvedProperties = new Map<string, any>();
  const unresolvedProperties = new Map<string, ts.Expression>();

  for (const member of classNode.members) {
    if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name) && member.initializer) {
      if (ts.isCallExpression(member.initializer) && isSignalCall(member.initializer)) {
        continue;
      }

      const propName = member.name.text;
      unresolvedProperties.set(propName, member.initializer);
    }
  }

  let resolved = true;
  const maxIterations = unresolvedProperties.size + 1;
  let iterations = 0;

  while (resolved && unresolvedProperties.size > 0 && iterations < maxIterations) {
    resolved = false;
    iterations++;

    for (const [propName, initializer] of unresolvedProperties) {
      const value = evaluateExpressionCTFE(initializer, sourceFile, resolvedProperties);
      if (value !== EVAL_FAILED) {
        resolvedProperties.set(propName, value);
        unresolvedProperties.delete(propName);
        resolved = true;
      }
    }
  }

  return resolvedProperties;
};

/** Child component mount point data, passed from CTFE to the binding compiler. */
export interface ChildMountInfo {
  /** Component class name, e.g. "MyElementComponent" */
  componentName: string;
  /** Kebab-case selector, e.g. "my-element-component" */
  selector: string;
  /** Raw source text of the props argument, e.g. "{ color: myColor }" */
  propsExpression: string;
  /** Pre-allocated anchor ID from the CTFE counter: "b0", "b1", … */
  anchorId: string;
  /** Byte offset of the ${Component(…)} interpolation in the template string */
  templatePosition: number;
}

interface CTFECallInfo {
  componentName: string;
  propsExpression: string;
  evaluatedProps?: Record<string, any> | undefined;
  startIndex: number;
  endIndex: number;
  /** Byte offset inside the template literal text */
  templatePosition: number;
}

const findComponentCallsCTFE = (
  source: string,
  sourceFile: ts.SourceFile,
  knownComponents: Map<string, ComponentDefinition>,
): CTFECallInfo[] => {
  const calls: CTFECallInfo[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag;
      if (ts.isIdentifier(tag) && tag.text === 'html') {
        const template = node.template;

        const enclosingClass = findEnclosingClass(node);
        const classProperties = enclosingClass
          ? extractClassPropertiesCTFE(enclosingClass, sourceFile)
          : new Map<string, any>();

        if (ts.isTemplateExpression(template)) {
          template.templateSpans.forEach((span) => {
            const expr = span.expression;

            if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
              const componentName = expr.expression.text;
              const componentDef = knownComponents.get(componentName);

              if (componentDef) {
                // Capture the raw props expression text (even for dynamic/signal props)
                let propsExpression = '{}';
                if (expr.arguments.length > 0 && expr.arguments[0]) {
                  propsExpression = expr.arguments[0].getText(sourceFile);
                }

                // Try to evaluate props statically (for optimisation hints)
                let evaluatedProps: Record<string, any> | undefined;
                if (expr.arguments.length > 0 && expr.arguments[0]) {
                  const props = evaluateExpressionCTFE(expr.arguments[0]!, sourceFile, classProperties);
                  if (props !== EVAL_FAILED && typeof props === 'object' && props !== null) {
                    evaluatedProps = props as Record<string, any>;
                  }
                }

                // Compute ${…} range in source file
                const spanIndex = template.templateSpans.indexOf(span);
                let dollarBraceStart: number;
                if (spanIndex === 0) {
                  dollarBraceStart = template.head.getEnd() - 2;
                } else {
                  const prevSpan = template.templateSpans[spanIndex - 1]!;
                  dollarBraceStart = prevSpan.literal.getEnd() - 2;
                }
                const closingBrace = span.literal.getStart(sourceFile) + 1;

                // Compute the position inside the template literal text.
                // This is the offset from the template head start to the ${…} start.
                const templatePosition = dollarBraceStart - template.head.getStart();

                if (dollarBraceStart >= 0 && closingBrace <= source.length) {
                  calls.push({
                    componentName,
                    propsExpression,
                    evaluatedProps,
                    startIndex: dollarBraceStart,
                    endIndex: closingBrace,
                    templatePosition,
                  });
                }
              }
            }
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return calls;
};

export const ComponentPrecompilerPlugin = (ctx?: BuildContext): Plugin => ({
  name: NAME,
  setup(build) {
    const componentDefinitions = new Map<string, ComponentDefinition>();

    build.onStart(async () => {
      componentDefinitions.clear();

      if (ctx) {
        // Use shared context from BuildContext
        for (const [name, def] of ctx.componentsByName) {
          componentDefinitions.set(name, def);
        }
      } else {
        // Fallback: reuse createBuildContext to avoid duplicating the scan logic
        const fallbackCtx = await createBuildContext();
        for (const [name, def] of fallbackCtx.componentsByName) {
          componentDefinitions.set(name, def);
        }
      }

      if (componentDefinitions.size > 0) {
        logger.info(NAME, `Found ${componentDefinitions.size} component(s) for CTFE`);
      }
    });

    /**
     * Strip tagged template tags (css`...` → `...`, html`...` → `...`) using AST
     * to avoid false positives from regex matching inside string literals.
     */
    const stripTemplateTags = (code: string): string => {
      const sf = ts.createSourceFile('__strip.ts', code, ts.ScriptTarget.Latest, true);
      // Collect positions to strip in reverse order (end → start)
      const edits: { start: number; end: number }[] = [];
      const walk = (node: ts.Node) => {
        if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag)) {
          const tagName = node.tag.text;
          if (tagName === 'css' || tagName === 'html') {
            // Remove the tag identifier — keep only the template literal
            edits.push({ start: node.tag.getStart(sf), end: node.template.getStart(sf) });
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(sf);
      // Apply in reverse to preserve positions
      let result = code;
      for (let i = edits.length - 1; i >= 0; i--) {
        const edit = edits[i]!;
        result = result.substring(0, edit.start) + result.substring(edit.end);
      }
      return result;
    };

    /**
     * Apply reactive binding transformation, strip template tags, and produce loader result.
     * When childMounts are present, passes them to the binding compiler so it can
     * emit mount calls in __b and start its idCounter at the correct offset.
     */
    const buildTransformedResult = (
      source: string,
      modifiedSource: string,
      filePath: string,
      childMounts?: ChildMountInfo[],
      childMountCount?: number,
    ): { contents: string; loader: 'ts' } => {
      let result = modifiedSource;
      if (extendsComponentQuick(source)) {
        const transformed = transformDefineComponentSource(result, filePath, childMounts, childMountCount);
        if (transformed) {
          result = transformed;
        }
      }
      result = stripTemplateTags(result);
      return createLoaderResult(result);
    };

    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      try {
        if (args.path.includes('scripts') || args.path.includes('node_modules')) {
          return undefined;
        }

        const source = await fs.promises.readFile(args.path, 'utf8');

        if (!source.includes(FN.HTML + '`')) {
          return undefined;
        }

        // ── CTFE: inline component calls if definitions are available ──
        let modifiedSource = source;
        let hasComponentCalls = false;
        for (const [componentName] of componentDefinitions) {
          if (source.includes(componentName + '(')) {
            hasComponentCalls = true;
            break;
          }
        }

        // Child mount data to pass to the binding compiler
        let childMounts: ChildMountInfo[] | undefined;
        let childMountCount: number | undefined;

        if (hasComponentCalls) {
          const sourceFile = sourceCache.parse(args.path, source);
          const componentCalls = findComponentCallsCTFE(source, sourceFile, componentDefinitions);

          if (componentCalls.length > 0) {
            // CTFE counter — allocates b0, b1, … for child component anchors.
            // The binding compiler starts its idCounter at this offset.
            let childIdCounter = 0;
            const mounts: ChildMountInfo[] = [];

            const sortedCalls = [...componentCalls].sort((a, b) => b.startIndex - a.startIndex);

            for (const call of sortedCalls) {
              const componentDef = componentDefinitions.get(call.componentName);
              if (componentDef) {
                const anchorId = `b${childIdCounter++}`;
                const compiledHTML = generateComponentHTML({
                  selector: componentDef.selector,
                  props: {},
                  anchorId,
                });

                modifiedSource =
                  modifiedSource.substring(0, call.startIndex) + compiledHTML + modifiedSource.substring(call.endIndex);

                mounts.push({
                  componentName: call.componentName,
                  selector: componentDef.selector,
                  propsExpression: call.propsExpression,
                  anchorId,
                  templatePosition: call.templatePosition,
                });
              }
            }

            childMounts = mounts;
            childMountCount = childIdCounter;
          }
        }

        return buildTransformedResult(source, modifiedSource, args.path, childMounts, childMountCount);
      } catch (error) {
        const diagnostic = createError(
          `Error processing ${args.path}: ${error instanceof Error ? error.message : error}`,
          { file: args.path, line: 0, column: 0 },
          ErrorCode.PLUGIN_ERROR,
        );
        logger.diagnostic(diagnostic);
        return undefined;
      }
    });
  },
});
