import fs from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import ts from 'typescript';
import {
  collectFilesRecursively,
  extractComponentDefinitions,
  logger,
  PLUGIN_NAME,
  sourceCache,
} from '../../utils/index.js';

const NAME = PLUGIN_NAME.TYPES_SYNC;
const GENERATED_ROOT_DIR = '.thane';
const GENERATED_TYPES_DIR = 'types';
const GENERATED_ROUTER_DIR = 'router';
const GENERATED_CLIENT_FILE_NAME = 'client.d.ts';
const ROUTE_COMPONENT_PROPS = new Set(['componentModule', 'component']);

interface ImportBinding {
  moduleSpecifier: string;
  importedName?: string | undefined;
}

interface LazyImportInfo {
  importPath: string;
  exportName?: string | undefined;
}

const getPropertyNameText = (name: ts.PropertyName | ts.PrivateIdentifier): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};

const escapeTypeLiteral = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
};

const collectImportBindings = (sourceFile: ts.SourceFile): Map<string, ImportBinding> => {
  const bindings = new Map<string, ImportBinding>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const clause = statement.importClause;
    if (!clause) continue;

    const moduleSpecifier = statement.moduleSpecifier.text;

    if (clause.name) {
      bindings.set(clause.name.text, { moduleSpecifier });
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        bindings.set(element.name.text, {
          moduleSpecifier,
          importedName: element.propertyName?.text ?? element.name.text,
        });
      }
    }
  }

  return bindings;
};

const extractImportPathFromArrow = (node: ts.ArrowFunction): LazyImportInfo | null => {
  let importCall: ts.CallExpression | null = null;
  let exportName: string | undefined;
  const body = node.body;

  if (ts.isCallExpression(body)) {
    const expr = body.expression;

    if (expr.kind === ts.SyntaxKind.ImportKeyword) {
      importCall = body;
    } else if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'then') {
      const innerCall = expr.expression;
      if (ts.isCallExpression(innerCall) && innerCall.expression.kind === ts.SyntaxKind.ImportKeyword) {
        importCall = innerCall;
        const callback = body.arguments[0];
        if (callback && ts.isArrowFunction(callback) && ts.isPropertyAccessExpression(callback.body)) {
          exportName = callback.body.name.text;
        }
      }
    }
  }

  if (!importCall || importCall.arguments.length === 0) {
    return null;
  }

  const importArg = importCall.arguments[0];
  if (!importArg || !ts.isStringLiteral(importArg)) {
    return null;
  }

  return { importPath: importArg.text, exportName };
};

const resolveImportedSourceFile = async (specifier: string, importerPath: string): Promise<string | null> => {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const importerDir = path.dirname(importerPath);
  const absoluteBase = path.resolve(importerDir, specifier);
  const candidates = [
    absoluteBase,
    `${absoluteBase}.ts`,
    `${absoluteBase}.tsx`,
    absoluteBase.replace(/\.js$/i, '.ts'),
    absoluteBase.replace(/\.js$/i, '.tsx'),
    path.join(absoluteBase, 'index.ts'),
    path.join(absoluteBase, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // Keep probing candidates.
    }
  }

  return null;
};

const resolveSelectorFromSource = async (
  sourcePath: string,
  exportName?: string | undefined,
): Promise<string | null> => {
  const cached = await sourceCache.get(sourcePath);
  if (!cached) {
    return null;
  }

  const definitions = extractComponentDefinitions(cached.sourceFile, sourcePath);
  if (exportName) {
    return definitions.find((definition) => definition.name === exportName)?.selector ?? null;
  }

  if (definitions.length === 1) {
    return definitions[0]?.selector ?? null;
  }

  return definitions[definitions.length - 1]?.selector ?? null;
};

const resolveSelectorFromImport = async (binding: ImportBinding, routesFilePath: string): Promise<string | null> => {
  const sourcePath = await resolveImportedSourceFile(binding.moduleSpecifier, routesFilePath);
  if (!sourcePath) {
    return null;
  }

  return resolveSelectorFromSource(sourcePath, binding.importedName);
};

const resolveSelectorFromLazyImport = async (info: LazyImportInfo, routesFilePath: string): Promise<string | null> => {
  const sourcePath = await resolveImportedSourceFile(info.importPath, routesFilePath);
  if (!sourcePath) {
    return null;
  }

  return resolveSelectorFromSource(sourcePath, info.exportName);
};

const getRouteComponentSelector = async (
  property: ts.PropertyAssignment,
  importBindings: Map<string, ImportBinding>,
  routesFilePath: string,
): Promise<string | null> => {
  const initializer = property.initializer;

  if (ts.isIdentifier(initializer)) {
    const binding = importBindings.get(initializer.text);
    return binding ? resolveSelectorFromImport(binding, routesFilePath) : null;
  }

  if (ts.isArrowFunction(initializer)) {
    const importInfo = extractImportPathFromArrow(initializer);
    return importInfo ? resolveSelectorFromLazyImport(importInfo, routesFilePath) : null;
  }

  return null;
};

const getImportSpecifier = (fromFilePath: string, toFilePath: string): string => {
  let relativePath = path.relative(path.dirname(fromFilePath), toFilePath).replace(/\\/g, '/');
  relativePath = relativePath.replace(/\.[^.]+$/u, '.js');

  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }

  return relativePath;
};

const generateFileContent = (
  generatedFilePath: string,
  routesFilePath: string,
  selectorEntries: Array<[string, string]>,
): string => {
  const routesImportSpecifier = getImportSpecifier(generatedFilePath, routesFilePath);
  const selectorLines =
    selectorEntries.length > 0
      ? selectorEntries
          .map(([selector, pattern]) => `    '${escapeTypeLiteral(selector)}': '${escapeTypeLiteral(pattern)}';`)
          .join('\n')
      : '    // No route component selectors were resolved.';

  return [
    '/* Auto-generated by Thane. Do not edit by hand. */',
    `import type Routes from '${escapeTypeLiteral(routesImportSpecifier)}';`,
    '',
    'type __ThaneRoutes = typeof Routes;',
    "type __ThaneRoutePaths = Exclude<keyof __ThaneRoutes & string, 'notFound'>;",
    '',
    'declare global {',
    '  namespace ThaneTypeRegistry {',
    '    interface Register {',
    '      routePaths: __ThaneRoutePaths;',
    '    }',
    '',
    '    interface RouteComponentRegister {',
    selectorLines,
    '    }',
    '  }',
    '}',
    '',
    'export {};',
    '',
  ].join('\n');
};

const readClientTypesTemplate = async (): Promise<string> => {
  const clientTypesUrl = new URL('../../../../client.d.ts', import.meta.url);
  return fs.readFile(clientTypesUrl, 'utf8');
};

const getProjectConfigPath = (filePath: string): string | null => {
  return ts.findConfigFile(path.dirname(filePath), ts.sys.fileExists, 'tsconfig.json') ?? null;
};

const getGeneratedOutputPath = (projectConfigPath: string, routesFilePath: string): string => {
  const projectRoot = path.dirname(projectConfigPath);
  const relativeRoutePath = path.relative(projectRoot, routesFilePath);
  const generatedRelativePath = relativeRoutePath.replace(/\.[^.]+$/u, '.generated.d.ts');

  return path.join(projectRoot, GENERATED_ROOT_DIR, GENERATED_TYPES_DIR, GENERATED_ROUTER_DIR, generatedRelativePath);
};

const getGeneratedClientTypesPath = (projectConfigPath: string): string => {
  const projectRoot = path.dirname(projectConfigPath);
  return path.join(projectRoot, GENERATED_ROOT_DIR, GENERATED_TYPES_DIR, GENERATED_CLIENT_FILE_NAME);
};

const ensureGeneratedDirectory = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const writeGeneratedFile = async (
  filePath: string,
  routesFilePath: string,
  selectorMap: Map<string, string>,
): Promise<void> => {
  const sortedSelectorEntries = Array.from(selectorMap.entries()).sort(([left], [right]) => left.localeCompare(right));
  const nextContent = generateFileContent(filePath, routesFilePath, sortedSelectorEntries);
  const previousContent = await fs.readFile(filePath, 'utf8').catch(() => null);

  if (previousContent === nextContent) {
    return;
  }

  await ensureGeneratedDirectory(filePath);
  await fs.writeFile(filePath, nextContent, 'utf8');
};

const writeGeneratedClientTypesFile = async (filePath: string, content: string): Promise<void> => {
  const previousContent = await fs.readFile(filePath, 'utf8').catch(() => null);
  if (previousContent === content) {
    return;
  }

  await ensureGeneratedDirectory(filePath);
  await fs.writeFile(filePath, content, 'utf8');
};

const collectRouteTyping = async (
  routesFilePath: string,
): Promise<{ routePaths: Set<string>; selectorMap: Map<string, string> } | null> => {
  const cached = await sourceCache.get(routesFilePath);
  if (!cached || !cached.source.includes('defineRoutes(')) {
    return null;
  }

  const importBindings = collectImportBindings(cached.sourceFile);
  const routePaths = new Set<string>();
  const selectorMap = new Map<string, string>();
  let foundRoutes = false;

  const visit = async (node: ts.Node): Promise<void> => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineRoutes') {
      const [firstArg] = node.arguments;
      if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
        foundRoutes = true;

        for (const property of firstArg.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const routeKey = getPropertyNameText(property.name);
          if (!routeKey) continue;

          if (routeKey !== 'notFound') {
            routePaths.add(routeKey);
          }

          if (!ts.isObjectLiteralExpression(property.initializer)) {
            continue;
          }

          for (const routeProp of property.initializer.properties) {
            if (!ts.isPropertyAssignment(routeProp)) continue;
            const routePropName = getPropertyNameText(routeProp.name);
            if (!routePropName || !ROUTE_COMPONENT_PROPS.has(routePropName)) continue;

            const selector = await getRouteComponentSelector(routeProp, importBindings, routesFilePath);
            if (selector) {
              selectorMap.set(selector, routeKey);
            }
          }
        }
      }
    }

    const childVisits: Promise<void>[] = [];
    ts.forEachChild(node, (child) => {
      childVisits.push(visit(child));
    });
    if (childVisits.length > 0) {
      await Promise.all(childVisits);
    }
  };

  await visit(cached.sourceFile);
  return foundRoutes ? { routePaths, selectorMap } : null;
};

export const syncProjectTypes = async (workspaceRoot: string = process.cwd()): Promise<number> => {
  const tsFiles = await collectFilesRecursively(
    workspaceRoot,
    (fileName) => fileName.endsWith('.ts') && !fileName.endsWith('.d.ts'),
  );
  const generatedRoot = path.join(workspaceRoot, GENERATED_ROOT_DIR);
  const generatedFiles = (await fs
    .stat(generatedRoot)
    .then(() => true)
    .catch(() => false))
    ? await collectFilesRecursively(generatedRoot, (fileName) => fileName.endsWith('.d.ts'))
    : [];
  const legacyGeneratedFiles = await collectFilesRecursively(
    workspaceRoot,
    (fileName) => fileName === '__thane-router.generated.d.ts',
  );
  const nextGeneratedFiles = new Set<string>();
  const projectConfigPaths = new Set<string>();
  const clientTypesContent = await readClientTypesTemplate();
  let generatedCount = 0;

  for (const filePath of tsFiles) {
    const projectConfigPath = getProjectConfigPath(filePath);
    if (projectConfigPath) {
      projectConfigPaths.add(projectConfigPath);
    }
  }

  for (const projectConfigPath of projectConfigPaths) {
    const clientTypesPath = getGeneratedClientTypesPath(projectConfigPath);
    nextGeneratedFiles.add(clientTypesPath);
    await writeGeneratedClientTypesFile(clientTypesPath, clientTypesContent);
  }

  for (const filePath of tsFiles) {
    const routeTyping = await collectRouteTyping(filePath);
    if (!routeTyping) {
      continue;
    }

    const projectConfigPath = getProjectConfigPath(filePath);
    if (!projectConfigPath) {
      continue;
    }

    const outputPath = getGeneratedOutputPath(projectConfigPath, filePath);
    nextGeneratedFiles.add(outputPath);
    await writeGeneratedFile(outputPath, filePath, routeTyping.selectorMap);
    generatedCount++;
  }

  for (const staleFile of generatedFiles) {
    if (!nextGeneratedFiles.has(staleFile)) {
      await fs.rm(staleFile, { force: true });
    }
  }

  for (const legacyFile of legacyGeneratedFiles) {
    await fs.rm(legacyFile, { force: true });
  }

  const legacyGeneratedRouterDir = path.join(workspaceRoot, GENERATED_ROOT_DIR, 'router-types');
  await fs.rm(legacyGeneratedRouterDir, { recursive: true, force: true }).catch(() => {
    /* ignore missing legacy dir */
  });

  return generatedCount;
};

export const ProjectTypesSyncPlugin: Plugin = {
  name: NAME,
  setup(build) {
    build.onStart(async () => {
      const generatedCount = await syncProjectTypes();
      if (generatedCount > 0) {
        logger.info(NAME, `Generated hidden type file(s) for ${generatedCount} route table(s)`);
      }
    });
  },
};

export const RouterTypegenPlugin = ProjectTypesSyncPlugin;
