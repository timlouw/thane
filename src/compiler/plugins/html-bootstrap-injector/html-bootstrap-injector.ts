import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'esbuild';
import {
  logger,
  collectFilesRecursively,
  sourceCache,
  extractComponentDefinitions,
  extractPageSelector,
} from '../../utils/index.js';
import type { ComponentDefinition, BuildContext } from '../../types.js';

const NAME = 'html-bootstrap';
type MountTarget = { type: 'body' } | { type: 'element'; id: string };

interface BootstrapConfig {
  selector: string;
  target: MountTarget;
  componentDef?: ComponentDefinition | undefined;
}

const resolveImportPath = (fromFile: string, importPath: string): string => {
  const fromDir = path.dirname(fromFile);
  const tsPath = importPath.replace(/\.js$/, '.ts');
  return path.resolve(fromDir, tsPath);
};

const extractGetElementByIdArg = (node: ts.Node): string | null => {
  if (!ts.isCallExpression(node)) return null;

  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return null;
  if (expr.name.text !== 'getElementById') return null;

  const obj = expr.expression;
  if (!ts.isIdentifier(obj) || obj.text !== 'document') return null;

  const args = node.arguments;
  if (args.length !== 1) return null;

  const arg = args[0];
  if (arg && ts.isStringLiteral(arg)) {
    return arg.text;
  }

  return null;
};

const parseMountTarget = (targetNode: ts.Node, sourceFile: ts.SourceFile): MountTarget | null => {
  if (ts.isPropertyAccessExpression(targetNode)) {
    const obj = targetNode.expression;
    if (ts.isIdentifier(obj) && obj.text === 'document' && targetNode.name.text === 'body') {
      return { type: 'body' };
    }
  }
  let callExpr = targetNode;
  if (ts.isAsExpression(targetNode)) {
    callExpr = targetNode.expression;
  }
  if (ts.isNonNullExpression(targetNode)) {
    callExpr = targetNode.expression;
  }

  const elementId = extractGetElementByIdArg(callExpr);
  if (elementId) {
    return { type: 'element', id: elementId };
  }
  if (ts.isIdentifier(targetNode)) {
    const varName = targetNode.text;
    let foundId: string | null = null;

    const findDeclaration = (node: ts.Node): void => {
      if (foundId) return;

      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === varName &&
        node.initializer
      ) {
        let initExpr = node.initializer;
        if (ts.isAsExpression(initExpr)) {
          initExpr = initExpr.expression;
        }
        if (ts.isNonNullExpression(initExpr)) {
          initExpr = initExpr.expression;
        }

        const id = extractGetElementByIdArg(initExpr);
        if (id) {
          foundId = id;
        }
      }

      ts.forEachChild(node, findDeclaration);
    };

    findDeclaration(sourceFile);

    if (foundId) {
      return { type: 'element', id: foundId };
    }
  }

  return null;
};

const findMountCall = (
  sourceFile: ts.SourceFile,
): {
  componentName: string | null;
  target: MountTarget;
  hasRouter: boolean;
} | null => {
  let result: { componentName: string | null; target: MountTarget; hasRouter: boolean } | null = null;

  const visit = (node: ts.Node): void => {
    if (result) return;

    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr) && expr.text === 'mount' && node.arguments.length >= 1) {
        const firstArg = node.arguments[0];
        if (!firstArg) return;

        // New API: mount({ component?: X, target?: Y, router?: Z })
        if (ts.isObjectLiteralExpression(firstArg)) {
          let componentName: string | null = null;
          let target: MountTarget = { type: 'body' };
          let hasRouter = false;

          for (const prop of firstArg.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;

            if (prop.name.text === 'component' && ts.isIdentifier(prop.initializer)) {
              componentName = prop.initializer.text;
            } else if (prop.name.text === 'target') {
              const parsedTarget = parseMountTarget(prop.initializer, sourceFile);
              if (parsedTarget) {
                target = parsedTarget;
              }
            } else if (prop.name.text === 'router') {
              hasRouter = true;
            }
          }

          result = { componentName, target, hasRouter };
          return;
        }

        // Legacy support: mount(Component) or mount(Component, target)
        if (ts.isIdentifier(firstArg)) {
          let target: MountTarget = { type: 'body' };

          if (node.arguments.length >= 2) {
            const secondArg = node.arguments[1];
            if (secondArg) {
              if (ts.isObjectLiteralExpression(secondArg)) {
                for (const prop of secondArg.properties) {
                  if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'target') {
                    const parsedTarget = parseMountTarget(prop.initializer, sourceFile);
                    if (parsedTarget) {
                      target = parsedTarget;
                    }
                  }
                }
              } else {
                const parsedTarget = parseMountTarget(secondArg, sourceFile);
                if (parsedTarget) {
                  target = parsedTarget;
                }
              }
            }
          }

          result = {
            componentName: firstArg.text,
            target,
            hasRouter: false,
          };
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
};

const findImportPath = (sourceFile: ts.SourceFile, identifierName: string): string | null => {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings) {
      const namedBindings = statement.importClause.namedBindings;
      if (ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          if (element.name.text === identifierName) {
            const moduleSpecifier = statement.moduleSpecifier;
            if (ts.isStringLiteral(moduleSpecifier)) {
              return moduleSpecifier.text;
            }
          }
        }
      }
    }
  }
  return null;
};

const findBootstrapConfig = async (entryPointPath: string): Promise<Omit<BootstrapConfig, 'componentDef'> | null> => {
  try {
    const absolutePath = path.resolve(process.cwd(), entryPointPath);
    const source = await fs.promises.readFile(absolutePath, 'utf8');
    const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true);

    const mountInfo = findMountCall(sourceFile);

    if (!mountInfo) {
      return null;
    }

    // Mode C: router-only, no shell component
    if (!mountInfo.componentName && mountInfo.hasRouter) {
      logger.info(NAME, 'Detected Mode C: mount({ router }) — router as root, no shell');
      return null;
    }

    // No component found — nothing to bootstrap
    if (!mountInfo.componentName) {
      return null;
    }

    // Mode B: shell component + router
    if (mountInfo.hasRouter) {
      logger.info(NAME, 'Detected Mode B: mount({ component, router }) — shell with router');
    }

    // Mode A or B: resolve the component
    const importPath = findImportPath(sourceFile, mountInfo.componentName);
    if (!importPath) {
      logger.warn(NAME, `Could not find import for ${mountInfo.componentName}`);
      return null;
    }
    const componentFilePath = resolveImportPath(absolutePath, importPath);
    const componentSource = await fs.promises.readFile(componentFilePath, 'utf8');
    const componentSourceFile = ts.createSourceFile(componentFilePath, componentSource, ts.ScriptTarget.Latest, true);
    const selector = extractPageSelector(componentSourceFile);
    if (!selector) {
      logger.warn(NAME, `Could not find component selector in ${componentFilePath}`);
      return null;
    }

    return {
      selector,
      target: mountInfo.target,
    };
  } catch (error) {
    logger.error(NAME, `Error finding bootstrap config: ${error}`);
    return null;
  }
};

const collectComponentDefinitions = async (ctx?: BuildContext): Promise<Map<string, ComponentDefinition>> => {
  if (ctx) {
    return ctx.componentsBySelector;
  }

  const componentDefinitions = new Map<string, ComponentDefinition>();
  const workspaceRoot = process.cwd();
  const searchDirs = [workspaceRoot];

  const tsFilter = (name: string) => name.endsWith('.ts') && !name.endsWith('.d.ts');

  for (const dir of searchDirs) {
    const files = await collectFilesRecursively(dir, tsFilter);

    for (const filePath of files) {
      const cached = await sourceCache.get(filePath);
      if (cached) {
        const definitions = extractComponentDefinitions(cached.sourceFile, filePath);
        for (const def of definitions) {
          componentDefinitions.set(def.selector, def);
        }
      }
    }
  }

  return componentDefinitions;
};

let bootstrapConfig: BootstrapConfig | null = null;

export const getBootstrapConfig = (): BootstrapConfig | null => bootstrapConfig;

export interface HTMLBootstrapInjectorOptions {
  entryPoints: string[];
  buildContext?: BuildContext;
}

export const HTMLBootstrapInjectorPlugin = (options: HTMLBootstrapInjectorOptions): Plugin => ({
  name: NAME,
  setup(build) {
    build.onStart(async () => {
      bootstrapConfig = null;
      const { entryPoints } = options;
      const mainEntry =
        entryPoints.find((ep: string) => ep.includes('main.ts') || ep.includes('main-')) ??
        entryPoints.find((ep: string) => !ep.includes('router.ts'));
      if (!mainEntry) {
        logger.info(NAME, 'No entry point found, skipping bootstrap injection');
        return;
      }
      const config = await findBootstrapConfig(mainEntry);
      if (!config) {
        // findBootstrapConfig already logged if Mode C was detected
        logger.info(NAME, 'No shell component to bootstrap (Mode A without mount, or Mode C router-as-root)');
        return;
      }
      const components = await collectComponentDefinitions(options.buildContext);
      const componentDef = components.get(config.selector);

      bootstrapConfig = { ...config, componentDef };

      const targetDesc = config.target.type === 'body' ? 'document.body' : `#${config.target.id}`;
      logger.info(NAME, `Bootstrap component: <${config.selector}> → ${targetDesc}`);
    });
  },
});
