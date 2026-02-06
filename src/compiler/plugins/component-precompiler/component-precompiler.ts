import fs from 'fs';
import path from 'path';
import type { Plugin } from 'esbuild';
import ts from 'typescript';
import vm from 'vm';
import type { ComponentDefinition } from '../../types.js';
import {
  extractComponentDefinitions,
  findEnclosingClass,
  isSignalCall,
  collectFilesRecursively,
  sourceCache,
  logger,
  PLUGIN_NAME,
  FN,
  createLoaderResult,
  extendsComponentQuick,
  generateComponentHTML,
} from '../../utils/index.js';
import { transformComponentSource } from '../reactive-binding-compiler/reactive-binding-compiler.js';

/**
 * Sentinel value distinguishing "evaluation failed" from "evaluated to undefined".
 * Using a unique symbol prevents any ambiguity.
 */
const EVAL_FAILED = Symbol('EVAL_FAILED');
type EvalResult<T = any> = T | typeof EVAL_FAILED;

interface ComponentImportInfo {
  importPath: string;
  componentNames: Set<string>;
  allNamedImports: string[];
  importStart: number;
  importEnd: number;
  quoteChar: string;
}

const NAME = PLUGIN_NAME.COMPONENT;

const findComponentImports = (sourceFile: ts.SourceFile, knownComponents: Map<string, ComponentDefinition>): ComponentImportInfo[] => {
  const imports: ComponentImportInfo[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) return;

      const importPath = moduleSpecifier.text;
      const componentNames = new Set<string>();
      const allNamedImports: string[] = [];

      for (const element of node.importClause.namedBindings.elements) {
        const importedName = element.name.text;
        const fullImportText = element.getText(sourceFile);
        allNamedImports.push(fullImportText);

        if (knownComponents.has(importedName)) {
          componentNames.add(importedName);
        }
      }

      if (componentNames.size > 0) {
        const specifierText = moduleSpecifier.getFullText(sourceFile);
        const quoteChar = specifierText.includes("'") ? "'" : '"';

        imports.push({
          importPath,
          componentNames,
          allNamedImports,
          importStart: node.getStart(sourceFile),
          importEnd: node.getEnd(),
          quoteChar,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
};

const transformComponentImportsToSideEffects = (source: string, sourceFile: ts.SourceFile, componentImports: ComponentImportInfo[], ctfedComponents: Set<string>): string => {
  const sortedImports = [...componentImports].sort((a, b) => b.importStart - a.importStart);

  let modifiedSource = source;

  for (const importInfo of sortedImports) {
    const ctfedInThisImport = new Set([...importInfo.componentNames].filter((name) => ctfedComponents.has(name)));

    if (ctfedInThisImport.size === 0) continue;

    const { importPath, quoteChar, allNamedImports } = importInfo;

    const remainingImports = allNamedImports.filter((imp) => {
      const asIndex = imp.indexOf(' as ');
      const name = asIndex >= 0 ? imp.substring(0, asIndex).trim() : imp.trim();
      return !ctfedInThisImport.has(name);
    });

    let newImport = '';

    newImport = `import ${quoteChar}${importPath}${quoteChar};`;

    if (remainingImports.length > 0) {
      newImport += `\nimport { ${remainingImports.join(', ')} } from ${quoteChar}${importPath}${quoteChar};`;
    }

    modifiedSource = modifiedSource.substring(0, importInfo.importStart) + newImport + modifiedSource.substring(importInfo.importEnd);
  }

  return modifiedSource;
};

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

const evaluateExpressionCTFE = (node: ts.Node, sourceFile: ts.SourceFile, classProperties: Map<string, any>): EvalResult => {
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
    code = code.replace(/this\./g, '');

    const result = vm.runInContext(`(${code})`, context, {
      timeout: 50,
    });
    return result;
  } catch {
    return EVAL_FAILED;
  }
};

const extractClassPropertiesCTFE = (classNode: ts.ClassExpression | ts.ClassDeclaration, sourceFile: ts.SourceFile): Map<string, any> => {
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

const findComponentCallsCTFE = (
  source: string,
  sourceFile: ts.SourceFile,
  knownComponents: Map<string, ComponentDefinition>,
): Array<{
  componentName: string;
  props: Record<string, any>;
  startIndex: number;
  endIndex: number;
}> => {
  const calls: Array<{
    componentName: string;
    props: Record<string, any>;
    startIndex: number;
    endIndex: number;
  }> = [];

  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag;
      if (ts.isIdentifier(tag) && tag.text === 'html') {
        const template = node.template;

        const enclosingClass = findEnclosingClass(node);
        const classProperties = enclosingClass ? extractClassPropertiesCTFE(enclosingClass, sourceFile) : new Map<string, any>();

        if (ts.isTemplateExpression(template)) {
          template.templateSpans.forEach((span) => {
            const expr = span.expression;

            if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
              const componentName = expr.expression.text;
              const componentDef = knownComponents.get(componentName);

              if (componentDef && expr.arguments.length > 0) {
                const propsArg = expr.arguments[0];
                if (!propsArg) return;

                const props = evaluateExpressionCTFE(propsArg, sourceFile, classProperties);

                if (props !== EVAL_FAILED && typeof props === 'object' && props !== null) {
                  // Use the AST span positions directly — the span covers
                  // from the head's end (after `${`) to the literal text start (before `}`)
                  const spanStart = span.getStart(sourceFile);
                  const spanEnd = span.getEnd();

                  // Walk back from span start to find the opening `${`
                  const exprFullStart = spanStart - 2 >= 0 ? spanStart - 2 : spanStart;
                  // The span end already includes the closing `}` in the template literal
                  // Use the expression's own positions which are more reliable
                  const exprStart = expr.getStart(sourceFile);
                  const exprEnd = expr.getEnd();

                  // Find the enclosing ${...} by searching from expression position
                  let dollarBraceStart = exprStart - 1;
                  while (dollarBraceStart >= 0 && source.substring(dollarBraceStart, dollarBraceStart + 2) !== '${') {
                    dollarBraceStart--;
                  }

                  // The closing brace position is at the span's literal text start - 1
                  // but we can just find the first } after expression end
                  let closingBrace = exprEnd;
                  while (closingBrace < source.length && source[closingBrace] !== '}') {
                    closingBrace++;
                  }
                  closingBrace++;

                  if (dollarBraceStart >= 0 && closingBrace <= source.length) {
                    calls.push({
                      componentName,
                      props,
                      startIndex: dollarBraceStart,
                      endIndex: closingBrace,
                    });
                  }
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

export const ComponentPrecompilerPlugin: Plugin = {
  name: NAME,
  setup(build) {
    const componentDefinitions = new Map<string, ComponentDefinition>();

    const generateHTML = generateComponentHTML;

    build.onStart(async () => {
      componentDefinitions.clear();
      sourceCache.clear();

      const workspaceRoot = process.cwd();
      const searchDirs = [path.join(workspaceRoot, 'libs', 'components'), path.join(workspaceRoot, 'apps')];

      const tsFilter = (name: string) => name.endsWith('.ts') && !name.endsWith('.d.ts');

      for (const dir of searchDirs) {
        const files = await collectFilesRecursively(dir, tsFilter);

        for (const filePath of files) {
          const cached = await sourceCache.get(filePath);
          if (cached) {
            const definitions = extractComponentDefinitions(cached.sourceFile, filePath);
            for (const def of definitions) {
              componentDefinitions.set(def.name, def);
            }
          }
        }
      }

      if (componentDefinitions.size > 0) {
        logger.info(NAME, `Found ${componentDefinitions.size} component(s) for CTFE`);
      }
    });

    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      try {
        if (args.path.includes('scripts') || args.path.includes('node_modules')) {
          return undefined;
        }

        const source = await fs.promises.readFile(args.path, 'utf8');

        if (!source.includes(FN.HTML + '`')) {
          return undefined;
        }

        let hasComponentCalls = false;
        for (const [componentName] of componentDefinitions) {
          if (source.includes(componentName + '(')) {
            hasComponentCalls = true;
            break;
          }
        }

        if (!hasComponentCalls) {
          let modifiedSource = source;
          
          if (extendsComponentQuick(source)) {
            const transformed = transformComponentSource(modifiedSource, args.path);
            if (transformed) {
              modifiedSource = transformed;
            }
          }
          
          modifiedSource = modifiedSource.replace(/css`/g, '`');
          modifiedSource = modifiedSource.replace(/html`/g, '`');
          return createLoaderResult(modifiedSource);
        }

        const sourceFile = sourceCache.parse(args.path, source);
        const componentCalls = findComponentCallsCTFE(source, sourceFile, componentDefinitions);

        if (componentCalls.length === 0) {
          let modifiedSource = source;
          
          if (extendsComponentQuick(source)) {
            const transformed = transformComponentSource(modifiedSource, args.path);
            if (transformed) {
              modifiedSource = transformed;
            }
          }
          
          modifiedSource = modifiedSource.replace(/css`/g, '`');
          modifiedSource = modifiedSource.replace(/html`/g, '`');
          return createLoaderResult(modifiedSource);
        }

        const ctfedComponents = new Set<string>();

        let modifiedSource = source;
        const sortedCalls = [...componentCalls].sort((a, b) => b.startIndex - a.startIndex);

        for (const call of sortedCalls) {
          const componentDef = componentDefinitions.get(call.componentName);
          if (componentDef) {
            const compiledHTML = generateHTML({
              selector: componentDef.selector,
              props: call.props,
            });

            modifiedSource = modifiedSource.substring(0, call.startIndex) + compiledHTML + modifiedSource.substring(call.endIndex);
            ctfedComponents.add(call.componentName);
          }
        }

        const componentImports = findComponentImports(sourceFile, componentDefinitions);
        if (componentImports.length > 0) {
          modifiedSource = transformComponentImportsToSideEffects(modifiedSource, sourceFile, componentImports, ctfedComponents);
        }

        if (extendsComponentQuick(source)) {
          const transformed = transformComponentSource(modifiedSource, args.path);
          if (transformed) {
            modifiedSource = transformed;
          }
        }

        modifiedSource = modifiedSource.replace(/css`/g, '`');
        modifiedSource = modifiedSource.replace(/html`/g, '`');

        return createLoaderResult(modifiedSource);
      } catch (error) {
        logger.error(NAME, `Error processing ${args.path}`, error);
        return undefined;
      }
    });
  },
};
