/**
 * Hot updates for `thane dev`: what the build records, and what it adds to each module, so that a
 * changed file can be run again in the open page instead of reloading it.
 *
 * - Each project module registers its namespace in the page, under its path from the project root
 *   (`src/card.ts`), and the bindings it reads of each package, which merge into the package's
 *   (`pkg:thane`), in `globalThis.__thaneModules` (hotRegistration). A self-import gives the live bindings.
 *   Only the bindings the modules import are registered, so that a development bundle keeps of a package
 *   what the app uses; a hot update names the bindings it reads, and the page reloads when one is missing.
 * - Each build records which inputs changed since the last one (trackHotInput), what each module imports,
 *   and which modules are component files the page can swap (recordHotModule, isSwappable).
 * - A hot update runs again each changed module and every module that imports one, up to the component
 *   files, which the page swaps in place (hotUpdatePlan). A changed stylesheet runs the modules that import
 *   it. Each is bundled on its own, with every import pointing at the page's modules (HotExternalsPlugin).
 *   When that reaches the entry, the page reloads instead.
 * - In the page, the runtime swaps the components of each file it runs (runtime/hot.ts), and each module's
 *   new exports replace its old ones for the modules run after it.
 */
import path from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'esbuild';
import { applyEdits, constSignalDeclarations, findComponentDeclarations, hotSignalEdits } from '../../utils/index.js';
import { createModuleResolver, type ModuleResolver } from '../../utils/module-graph.js';
import { INTERNAL_RUNTIME_SPECIFIER } from '../../../contracts/index.js';

/** What a `thane dev` build knows for hot updates. Files are absolute paths, as `path.resolve` writes them. */
export interface HotState {
  /** Each input's text as last built */
  sources: Map<string, string>;
  /** The inputs that changed in this build */
  changed: Set<string>;
  /** Each project module's imports at run time: the project's modules and stylesheets */
  imports: Map<string, string[]>;
  /** The modules the page can swap: component files that export nothing else (isSwappable) */
  boundaries: Set<string>;
}

export const createHotState = (): HotState => ({
  sources: new Map(),
  changed: new Set(),
  imports: new Map(),
  boundaries: new Set(),
});

/** Where a hot update's imports point: a project module, by its key, or a package, by its specifier */
export const HOT_MODULE_PREFIX = '__thane_module__:';
export const HOT_PACKAGE_PREFIX = '__thane_package__:';

/** The key a page registers a project module under: its path from the project root */
export const hotModuleKey = (file: string, projectRoot: string): string =>
  path.relative(projectRoot, file).replaceAll('\\', '/');

/** Record `text` as this build's input `file`; a file built before with other text has changed */
export const trackHotInput = (hot: HotState, file: string, text: string): void => {
  const key = path.resolve(file);
  const previous = hot.sources.get(key);
  hot.sources.set(key, text);
  if (previous !== undefined && previous !== text) hot.changed.add(key);
};

/**
 * A component file the page can swap: it declares a component, and exports nothing but components (and
 * types). Anything else it exports may be held by other modules, which then run again with it.
 */
export const isSwappable = (sourceFile: ts.SourceFile): boolean => {
  const components = findComponentDeclarations(sourceFile);
  if (components.length === 0) return false;
  const componentStatements = new Set(components.map((component) => component.statement));
  const hasExport = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  return sourceFile.statements.every((statement) => {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return true;
    if (ts.isExportDeclaration(statement)) return statement.isTypeOnly;
    if (ts.isExportAssignment(statement)) return false;
    if (!hasExport(statement)) return true;
    return (
      ts.isVariableStatement(statement) &&
      componentStatements.has(statement) &&
      statement.declarationList.declarations.every(
        (declaration) => !!declaration.initializer && components.some((c) => c.call === declaration.initializer),
      )
    );
  });
};

/** An import that brings in only types, which is gone at run time */
const isTypeOnlyImport = (statement: ts.ImportDeclaration): boolean => {
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  const bindings = clause.namedBindings;
  return (
    !clause.name &&
    !!bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
};

/** The specifiers a module imports at run time: imports, re-exports and `import('…')`, but not types */
const runtimeSpecifiers = (sourceFile: ts.SourceFile): string[] => {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const typeOnly = ts.isImportDeclaration(node) ? isTypeOnlyImport(node) : node.isTypeOnly;
      if (!typeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
};

/** Record what `file` imports at run time, within the project, and whether the page can swap it */
export const recordHotModule = (
  hot: HotState,
  file: string,
  sourceFile: ts.SourceFile,
  resolveImport: ModuleResolver,
): void => {
  const key = path.resolve(file);
  const imports = new Set<string>();
  for (const specifier of runtimeSpecifiers(sourceFile)) {
    // A stylesheet the module imports is bundled into it, from its folder
    const target =
      specifier.endsWith('.css') && /^[./]/.test(specifier)
        ? path.resolve(path.dirname(key), specifier)
        : resolveImport(specifier, file);
    if (target) imports.add(path.resolve(target));
  }
  hot.imports.set(key, [...imports]);
  if (isSwappable(sourceFile)) hot.boundaries.add(key);
  else hot.boundaries.delete(key);
};

/**
 * The modules a hot update runs again for the files that changed, each after the ones it imports: every
 * changed module, and every module that imports one, up to the component files the page can swap. A changed
 * stylesheet is bundled into the modules that import it, which run again. Null, for the page to reload,
 * when that reaches a module that nothing imports (the entry), or a file no module imports.
 */
export const hotUpdatePlan = (hot: HotState): string[] | null => {
  if (hot.changed.size === 0) return null;
  const importers = new Map<string, string[]>();
  for (const [file, imports] of hot.imports) {
    for (const imported of imports) {
      const by = importers.get(imported);
      if (by) by.push(file);
      else importers.set(imported, [file]);
    }
  }
  const run = new Set<string>();
  const seen = new Set<string>();
  const queue = [...hot.changed];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const isModule = hot.imports.has(file);
    if (isModule) run.add(file);
    // A component file the page swaps holds its importers' components by handle: they need not run again
    if (isModule && hot.boundaries.has(file)) continue;
    const by = importers.get(file);
    if (!by) return null;
    queue.push(...by);
  }
  const order: string[] = [];
  const placed = new Set<string>();
  const place = (file: string): void => {
    if (placed.has(file)) return;
    placed.add(file);
    for (const imported of hot.imports.get(file) ?? []) if (run.has(imported)) place(imported);
    order.push(file);
  };
  for (const file of run) place(file);
  return order;
};

/**
 * A module the compiler leaves as it is (a store, a helper), with each `const name = signal(…)` at its top
 * level kept through hot updates as a component file's are: `__hotSignal(signal(…), 'name', 'src/store.ts')`.
 */
export const keepModuleSignals = (source: string, sourceFile: ts.SourceFile, key: string): string => {
  const declarations = constSignalDeclarations(sourceFile.statements);
  if (declarations.length === 0) return source;
  const edits = declarations.flatMap(({ name, call }) => hotSignalEdits(sourceFile, call, name, key));
  return `import { __hotSignal } from '${INTERNAL_RUNTIME_SPECIFIER}';\n${applyEdits(source, edits)}`;
};

/** Every binding a module may read of a package: its whole namespace (`import * as`, `export *`, `import()`) */
export const WHOLE_PACKAGE = '*';

/**
 * The bindings a module reads of each package at run time, by specifier: the names its imports and re-exports
 * name (`default` for a default import), or WHOLE_PACKAGE. `code` is the module as the compiler emits it, whose
 * imports of the compiler's helpers are read from it too. `dynamic`: an `import()` of a package reads it whole.
 */
export const packageImports = (sourceFile: ts.SourceFile, code: string, dynamic = true): Map<string, Set<string>> => {
  const imports = new Map<string, Set<string>>();
  const add = (specifier: string, names: string[]): void => {
    if (/^[./]/.test(specifier) || names.length === 0) return;
    const known = imports.get(specifier) ?? new Set<string>();
    for (const name of names) known.add(name);
    imports.set(specifier, known);
  };
  const named = (elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>): string[] =>
    elements.filter((element) => !element.isTypeOnly).map((element) => (element.propertyName ?? element.name).text);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!clause || isTypeOnlyImport(node)) return;
      const bindings = clause.namedBindings;
      add(node.moduleSpecifier.text, [
        ...(clause.name ? ['default'] : []),
        ...(bindings && ts.isNamespaceImport(bindings) ? [WHOLE_PACKAGE] : []),
        ...(bindings && ts.isNamedImports(bindings) ? named(bindings.elements) : []),
      ]);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return;
      const clause = node.exportClause;
      add(
        node.moduleSpecifier.text,
        !clause || ts.isNamespaceExport(clause) ? [WHOLE_PACKAGE] : named(clause.elements),
      );
      return;
    }
    if (
      dynamic &&
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      add(node.arguments[0].text, [WHOLE_PACKAGE]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  // The compiler's helpers, and Node's methods for lists, which its emitted imports name
  for (const [, names, specifier] of code.matchAll(
    /^import \{([^}]*)\} from ['"](thane\/runtime(?:\/dom)?)['"];?$/gm,
  )) {
    add(
      specifier!,
      names!
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    );
  }
  return imports;
};

/** A binding's name as an import or a property names it: bare when it can be */
const bindingName = (name: string): string => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

/**
 * `code` (the module as the build compiled it) with the lines that register, in the page, the module's
 * namespace and the bindings it reads of each package, for a hot update to import them from. A package's
 * whole namespace is marked `pkg*:` as well. A package the module only imports with `import()` is not
 * registered (it would be imported up front); a hot update that reads it reloads the page.
 */
export const hotRegistration = (file: string, code: string, sourceFile: ts.SourceFile, projectRoot: string): string => {
  const self = './' + path.basename(file).replace(/\.ts$/, '.js');
  const imports: string[] = [];
  const registrations: string[] = [];
  let count = 0;
  for (const [specifier, names] of packageImports(sourceFile, code, false)) {
    const key = JSON.stringify('pkg:' + specifier);
    const from = JSON.stringify(specifier);
    if (names.has(WHOLE_PACKAGE)) {
      const local = `__thane_hot_${count++}`;
      imports.push(`import * as ${local} from ${from};`);
      registrations.push(`register(${key}, ${local});`, `modules.set(${JSON.stringify('pkg*:' + specifier)}, true);`);
      continue;
    }
    const bindings = [...names].map((name) => [bindingName(name), `__thane_hot_${count++}`] as const);
    imports.push(`import { ${bindings.map(([name, local]) => `${name} as ${local}`).join(', ')} } from ${from};`);
    registrations.push(`register(${key}, { ${bindings.map(([name, local]) => `${name}: ${local}`).join(', ')} });`);
  }
  return [
    code,
    '',
    `import * as __thane_hot_self from ${JSON.stringify(self)};`,
    ...imports,
    '{',
    '  const modules = (globalThis.__thaneModules ??= new Map());',
    '  const register = (key, bindings) => modules.set(key, Object.assign(modules.get(key) ?? {}, bindings));',
    `  modules.set(${JSON.stringify(hotModuleKey(file, projectRoot))}, __thane_hot_self);`,
    ...registrations.map((line) => '  ' + line),
    '}',
    '',
  ].join('\n');
};

/**
 * The esbuild plugin of a hot update: the module and its stylesheets are bundled, and every other
 * import is left to the page: a project module by its key, a package by its specifier. A file the
 * resolver does not know as a module (a JSON file) is bundled too.
 */
export const HotExternalsPlugin = (projectRoot: string): Plugin => ({
  name: 'thane-hot-externals',
  setup(build) {
    const resolveImport = createModuleResolver(projectRoot);
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point' || args.path.endsWith('.css')) return undefined;
      if (/^[./]/.test(args.path) || path.isAbsolute(args.path)) {
        const target = resolveImport(args.path, args.importer);
        return target ? { path: HOT_MODULE_PREFIX + hotModuleKey(target, projectRoot), external: true } : undefined;
      }
      return { path: HOT_PACKAGE_PREFIX + args.path, external: true };
    });
  },
});
