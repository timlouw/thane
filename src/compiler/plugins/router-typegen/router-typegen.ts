import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { collectFilesRecursively, extractComponentDefinitions, sourceCache } from '../../utils/index.js';
import { createModuleResolver, type ModuleResolver } from '../../utils/module-graph.js';
import { readRouteTableHeads } from './route-head.js';

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

/** The selector of the component `exportName` names in the imported file, or of its last exported component. */
const resolveSelector = async (
  specifier: string,
  exportName: string | undefined,
  routesFilePath: string,
): Promise<string | null> => {
  const sourcePath = await resolveImportedSourceFile(specifier, routesFilePath);
  const cached = sourcePath ? await sourceCache.get(sourcePath) : null;
  if (!sourcePath || !cached) {
    return null;
  }

  const definitions = extractComponentDefinitions(cached.sourceFile, sourcePath).filter((d) => d.exported);
  const definition = exportName ? definitions.find((d) => d.name === exportName) : definitions.at(-1);
  return definition?.selector ?? null;
};

const getRouteComponentSelector = async (
  property: ts.PropertyAssignment,
  importBindings: Map<string, ImportBinding>,
  routesFilePath: string,
): Promise<string | null> => {
  const initializer = property.initializer;

  if (ts.isIdentifier(initializer)) {
    const binding = importBindings.get(initializer.text);
    return binding ? resolveSelector(binding.moduleSpecifier, binding.importedName, routesFilePath) : null;
  }

  if (ts.isArrowFunction(initializer)) {
    const importInfo = extractImportPathFromArrow(initializer);
    return importInfo ? resolveSelector(importInfo.importPath, importInfo.exportName, routesFilePath) : null;
  }

  return null;
};

/** One route's search values: each parameter and the type of its parsed value */
type SearchTypes = Array<[pattern: string, fields: Array<[key: string, type: string]>]>;

/**
 * The type of the value a search parser gives, from the source: the helpers' by their arguments, a
 * function's from its return type annotation, `unknown` otherwise.
 */
const searchValueType = (parser: ts.Expression, sourceFile: ts.SourceFile): string => {
  let node = parser;
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) node = node.expression;
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const [first, second] = node.arguments;
    const optional = (type: string, fallback: ts.Expression | undefined) => (fallback ? type : `${type} | undefined`);
    switch (node.expression.text) {
      case 'searchString':
        return optional('string', first);
      case 'searchNumber':
        return optional('number', first);
      case 'searchFlag':
        return 'boolean';
      case 'searchOneOf': {
        let list = first;
        while (list && (ts.isAsExpression(list) || ts.isParenthesizedExpression(list))) list = list.expression;
        const values =
          list && ts.isArrayLiteralExpression(list) && list.elements.every(ts.isStringLiteral)
            ? list.elements.map((element) => `'${escapeTypeLiteral((element as ts.StringLiteral).text)}'`).join(' | ')
            : 'string';
        return optional(values || 'never', second);
      }
    }
  }
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.type) return node.type.getText(sourceFile);
  return 'unknown';
};

const generateFileContent = (
  tableKey: string,
  routePaths: string[],
  selectorEntries: Array<[string, string]>,
  customMeta: Array<[string, string]>,
  search: SearchTypes = [],
): string => {
  // The paths are written out as string literals. Deriving them from `typeof Routes` made the
  // global `navigate()` depend on the type of the route table, which depends on the type of
  // every page a lazy loader returns — so a page that called `navigate()` in its own template
  // was part of its own type (TS7022).
  const routePathUnion =
    routePaths.length > 0 ? routePaths.map((routePath) => `'${escapeTypeLiteral(routePath)}'`).join(' | ') : 'never';
  const selectorLines = selectorEntries.map(
    ([selector, pattern]) => `          '${escapeTypeLiteral(selector)}': '${escapeTypeLiteral(pattern)}';`,
  );

  // One entry per route table, keyed by the table's file: two tables in one program (two apps that share
  // a tsconfig) add up, instead of the first one's paths hiding the second's
  return [
    '/* Auto-generated by Thane. Do not edit by hand. */',
    'declare global {',
    '  namespace ThaneTypeRegistry {',
    '    interface RouteTables {',
    `      '${escapeTypeLiteral(tableKey)}': {`,
    `        routePaths: ${routePathUnion};`,
    // The app's own head fields, for setMeta(): written out too, for the same reason as the paths
    ...(customMeta.length > 0
      ? [
          `        customMeta: { ${customMeta.map(([key, type]) => `'${escapeTypeLiteral(key)}'?: ${type};`).join(' ')} };`,
        ]
      : []),
    // Each route's search values, from its `search` schema
    ...(search.length > 0
      ? [
          '        search: {',
          ...search.map(
            ([pattern, fields]) =>
              `          '${escapeTypeLiteral(pattern)}': { ${fields.map(([key, type]) => `'${escapeTypeLiteral(key)}': ${type};`).join(' ')} };`,
          ),
          '        };',
        ]
      : []),
    // Each page component's selector, and the route pattern it is mounted for
    ...(selectorLines.length > 0
      ? ['        components: {', ...selectorLines, '        };']
      : ['        components: {};']),
    '      };',
    '    }',
    '  }',
    '}',
    '',
    'export {};',
    '',
  ].join('\n');
};

/**
 * The generated client types: one line referencing the package's own client.d.ts, so its `*.css`
 * declaration exists once however a project includes it (`"types": ["thane/client"]` is that file).
 */
const clientTypesReference = (generatedFile: string): string => {
  const packaged = fileURLToPath(new URL('../../../../client.d.ts', import.meta.url));
  return `/// <reference path="${path.relative(path.dirname(generatedFile), packaged).replace(/\\/g, '/')}" />\n`;
};

/** The tsconfig.json that owns `filePath`, searching upwards but never above `projectRoot`. */
const getProjectConfigPath = (filePath: string, projectRoot: string): string | null => {
  const rootDir = path.resolve(projectRoot);
  const sameDir = (a: string, b: string): boolean =>
    process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  let dir = path.dirname(path.resolve(filePath));
  for (;;) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (ts.sys.fileExists(candidate)) return candidate;
    if (sameDir(dir, rootDir)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
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
  tableKey: string,
  routePaths: Set<string>,
  selectorMap: Map<string, string>,
  customMeta: Array<[string, string]>,
  search: SearchTypes,
): Promise<void> => {
  const sortedSelectorEntries = Array.from(selectorMap.entries()).sort(([left], [right]) => left.localeCompare(right));
  const nextContent = generateFileContent(tableKey, Array.from(routePaths), sortedSelectorEntries, customMeta, search);
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
  generatedFile: string,
  resolve: ModuleResolver,
): Promise<{
  routePaths: Set<string>;
  selectorMap: Map<string, string>;
  customMeta: Array<[string, string]>;
  search: SearchTypes;
} | null> => {
  const cached = await sourceCache.get(routesFilePath);
  if (!cached || !cached.source.includes('defineRoutes(')) {
    return null;
  }

  const importBindings = collectImportBindings(cached.sourceFile);
  const routePaths = new Set<string>();
  const routeComponents: Array<[routeKey: string, routeProp: ts.PropertyAssignment]> = [];
  const search: SearchTypes = [];
  let foundRoutes = false;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineRoutes') {
      const [firstArg] = node.arguments;
      if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
        foundRoutes = true;

        for (const property of firstArg.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const routeKey = getPropertyNameText(property.name);
          if (!routeKey) continue;

          if (routeKey !== 'notFound' && routeKey !== 'error') {
            routePaths.add(routeKey);
          }

          if (!ts.isObjectLiteralExpression(property.initializer)) {
            continue;
          }

          for (const routeProp of property.initializer.properties) {
            if (!ts.isPropertyAssignment(routeProp)) continue;
            const routePropName = getPropertyNameText(routeProp.name);
            if (routePropName === 'search' && ts.isObjectLiteralExpression(routeProp.initializer)) {
              const fields: Array<[string, string]> = [];
              for (const field of routeProp.initializer.properties) {
                const key = ts.isPropertyAssignment(field) ? getPropertyNameText(field.name) : null;
                if (key)
                  fields.push([key, searchValueType((field as ts.PropertyAssignment).initializer, cached.sourceFile)]);
              }
              search.push([routeKey, fields]);
            }
            if (!routePropName || !ROUTE_COMPONENT_PROPS.has(routePropName)) continue;

            routeComponents.push([routeKey, routeProp]);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(cached.sourceFile);

  // Resolved in source order: a selector that several routes use maps to the last of them
  const selectorMap = new Map<string, string>();
  for (const [routeKey, routeProp] of routeComponents) {
    const selector = await getRouteComponentSelector(routeProp, importBindings, routesFilePath);
    if (selector) {
      selectorMap.set(selector, routeKey);
    }
  }
  if (!foundRoutes) return null;

  // Helpers take a string; a function takes what its parameter's type says
  const customMeta: Array<[string, string]> = [];
  for (const table of await readRouteTableHeads(routesFilePath, resolve, generatedFile)) {
    for (const [key, field] of Object.entries(table.custom)) {
      customMeta.push([key, field.kind === 'function' ? field.valueType : 'string']);
    }
  }
  return { routePaths, selectorMap, customMeta, search };
};

/**
 * Generate hidden .thane type files for every tsconfig project inside `projectRoot`.
 * Files outside the root are never scanned, so building one project cannot write
 * generated types into another.
 */
export const syncProjectTypes = async (projectRoot: string = process.cwd()): Promise<number> => {
  const tsFiles = await collectFilesRecursively(
    projectRoot,
    (fileName) => fileName.endsWith('.ts') && !fileName.endsWith('.d.ts'),
  );
  const generatedRoot = path.join(projectRoot, GENERATED_ROOT_DIR);
  const generatedFiles = (await fs
    .stat(generatedRoot)
    .then(() => true)
    .catch(() => false))
    ? await collectFilesRecursively(generatedRoot, (fileName) => fileName.endsWith('.d.ts'))
    : [];
  const nextGeneratedFiles = new Set<string>();
  const projectConfigPaths = new Set<string>();
  let generatedCount = 0;

  for (const filePath of tsFiles) {
    const projectConfigPath = getProjectConfigPath(filePath, projectRoot);
    if (projectConfigPath) {
      projectConfigPaths.add(projectConfigPath);
    }
  }

  for (const projectConfigPath of projectConfigPaths) {
    const clientTypesPath = getGeneratedClientTypesPath(projectConfigPath);
    nextGeneratedFiles.add(clientTypesPath);
    await writeGeneratedClientTypesFile(clientTypesPath, clientTypesReference(clientTypesPath));
  }

  const resolve = createModuleResolver(projectRoot);
  for (const filePath of tsFiles) {
    const projectConfigPath = getProjectConfigPath(filePath, projectRoot);
    if (!projectConfigPath) {
      continue;
    }

    const outputPath = getGeneratedOutputPath(projectConfigPath, filePath);
    const routeTyping = await collectRouteTyping(filePath, outputPath, resolve);
    if (!routeTyping) {
      continue;
    }

    nextGeneratedFiles.add(outputPath);
    // The table's key: its file, relative to the project that owns it
    const tableKey = path.relative(path.dirname(projectConfigPath), filePath).split(path.sep).join('/');
    await writeGeneratedFile(
      outputPath,
      tableKey,
      routeTyping.routePaths,
      routeTyping.selectorMap,
      routeTyping.customMeta,
      routeTyping.search,
    );
    generatedCount++;
  }

  for (const staleFile of generatedFiles) {
    if (!nextGeneratedFiles.has(staleFile)) {
      await fs.rm(staleFile, { force: true });
    }
  }

  return generatedCount;
};
