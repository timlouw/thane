import ts from 'typescript';
import path from 'node:path';
import type { OnStartResult, Plugin } from 'esbuild';
import { syncProjectTypes } from '../router-typegen/router-typegen.js';
import { collectFilesRecursively, logger, PLUGIN_NAME, sourceCache } from '../../utils/index.js';
import { ErrorCode, createError } from '../../errors.js';
import { TEMPLATE_TYPES_DECLARATION, rewriteTemplates, type RewrittenSource } from './template-types.js';

const NAME = PLUGIN_NAME.TYPE_CHECK;

/**
 * Type-check the project that lives in `projectRoot` (defaults to the current
 * working directory). Only that project's own tsconfig.json is used; parent
 * directories are never consulted, so a build inside a larger repository does
 * not silently type-check the wrong project.
 */
export async function runProjectTypeCheck(options?: {
  strict?: boolean;
  projectRoot?: string | undefined;
}): Promise<void> {
  const projectRoot = path.resolve(options?.projectRoot ?? process.cwd());
  await syncProjectTypes(projectRoot);
  await checkProject(options?.strict ?? true, projectRoot);
}

/** The type check itself, once the generated types are in place. */
async function checkProject(strict: boolean, projectRoot: string): Promise<void> {
  const configPath = path.join(projectRoot, 'tsconfig.json');
  if (!ts.sys.fileExists(configPath)) {
    if (strict) {
      logger.diagnostic(
        createError(`Could not find tsconfig.json in ${projectRoot}`, undefined, ErrorCode.FILE_NOT_FOUND),
      );
    } else {
      logger.verbose(`${NAME}: no tsconfig.json in ${projectRoot}, skipping type check`);
    }
    return;
  }

  logger.info(NAME, 'Running TypeScript type check...');

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    logger.diagnostic(createError('Error reading tsconfig.json', undefined, ErrorCode.FILE_NOT_FOUND));
    return;
  }

  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const generatedTypesRoot = path.join(path.dirname(configPath), '.thane', 'types');
  const generatedTypeFiles = await collectFilesRecursively(generatedTypesRoot, (fileName) =>
    fileName.endsWith('.d.ts'),
  );
  const options: ts.CompilerOptions = { ...parsedConfig.options, noEmit: true };
  const {
    host,
    rootNames: templateTypesRoots,
    mapDiagnostic,
    ownFile,
  } = templateTypedHost(options, generatedTypesRoot);
  const rootNames = Array.from(new Set([...parsedConfig.fileNames, ...generatedTypeFiles, ...templateTypesRoots]));

  const program = ts.createProgram({ rootNames, options, host });
  // The declaration of the template types is the check's own: in a project where `thane` does not resolve, its
  // `Fragment` is `any`, and nothing there is the project's to fix
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName !== ownFile)
    .map(mapDiagnostic);

  if (diagnostics.length === 0) {
    return;
  }

  const formatHost: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (p) => p,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  };
  const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost);

  if (strict) {
    logger.error(NAME, 'Type check failed');
    console.error('---------------------------------------------------------------');
    console.error(formatted);
    console.error('---------------------------------------------------------------');
    throw new Error(`TypeScript type check failed with ${diagnostics.length} error(s)`);
  }

  logger.warn(NAME, 'Type check found issues');
  console.error('---------------------------------------------------------------');
  console.error(formatted);
  console.error('---------------------------------------------------------------');
}

/**
 * The compiler options that change how a file is parsed or bound, as TypeScript's language service lists them
 * when it shares one parse between programs, and `strict`, which sets `alwaysStrict`
 */
const PARSE_OPTIONS = [
  'target',
  'module',
  'moduleResolution',
  'moduleDetection',
  'jsx',
  'jsxImportSource',
  'importHelpers',
  'strict',
  'alwaysStrict',
  'allowUnusedLabels',
  'allowUnreachableCode',
  'noFallthroughCasesInSwitch',
] as const;

/** One key for the options a program parses a file with: a parse is shared only between requests of one key */
const parseKey = (options: ts.CompilerOptions, request: ts.ScriptTarget | ts.CreateSourceFileOptions): string => {
  const { languageVersion, impliedNodeFormat, jsDocParsingMode } =
    typeof request === 'object'
      ? request
      : { languageVersion: request, impliedNodeFormat: undefined, jsDocParsingMode: undefined };
  return JSON.stringify([
    PARSE_OPTIONS.map((name) => options[name]),
    languageVersion,
    impliedNodeFormat,
    jsDocParsingMode,
  ]);
};

/**
 * The parses the type check keeps from one run to the next (`thane dev` checks again on every rebuild), by file:
 * the rewritten project sources, while their text is the same, and the declaration files (the libraries' and
 * the packages'), while they are unchanged on disk. A program given a parse from an earlier one reuses its
 * binding too. Project sources as written are kept in the build's source cache, which the build reads.
 */
const kept = new Map<string, { key: string; version: string; sourceFile: ts.SourceFile }>();
const keptParse = (fileName: string, key: string, version: string, parse: () => ts.SourceFile | undefined) => {
  const known = kept.get(fileName);
  if (known && known.key === key && known.version === version) return known.sourceFile;
  const sourceFile = parse();
  if (sourceFile) kept.set(fileName, { key, version, sourceFile });
  else kept.delete(fileName);
  return sourceFile;
};

/**
 * A compiler host that serves each project source with its template values typed (template-types.ts), the
 * declaration of their types as one more root file (`ownFile`), and the way to map a diagnostic in a rewritten
 * source back to the source as written. A program without the DOM library has no event types, so nothing is
 * rewritten. A project source as written is the build's parse when the options agree (sourceCache), so the
 * build does not parse it again; every other parse is kept for the next check (`kept`).
 */
const templateTypedHost = (
  options: ts.CompilerOptions,
  generatedTypesRoot: string,
): {
  host: ts.CompilerHost;
  rootNames: string[];
  mapDiagnostic: (d: ts.Diagnostic) => ts.Diagnostic;
  ownFile?: string;
} => {
  const host = ts.createCompilerHost(options);
  const hasDom = !options.lib || options.lib.some((lib) => lib.toLowerCase().includes('dom'));
  const declarationFile = path.join(generatedTypesRoot, 'template-types.d.ts').replace(/\\/g, '/');
  const rewritten = new Map<string, { rewrite: RewrittenSource; original: ts.SourceFile }>();
  const getSourceFile = host.getSourceFile;
  const fileExists = host.fileExists;
  if (hasDom) host.fileExists = (fileName) => fileName === declarationFile || fileExists.call(host, fileName);
  host.getSourceFile = (fileName, request, onError, shouldCreateNewSourceFile) => {
    const key = parseKey(options, request);
    if (hasDom && fileName === declarationFile) {
      return keptParse(fileName, key, TEMPLATE_TYPES_DECLARATION, () =>
        ts.createSourceFile(fileName, TEMPLATE_TYPES_DECLARATION, request),
      );
    }
    if (fileName.endsWith('.ts') && !fileName.endsWith('.d.ts') && !fileName.includes('/node_modules/')) {
      const shared = sourceCache.getSync(fileName, key, (text) =>
        ts.createSourceFile(fileName, text, request, true, ts.ScriptKind.TS),
      );
      if (!shared) return getSourceFile.call(host, fileName, request, onError, shouldCreateNewSourceFile);
      const rewrite = hasDom ? rewriteTemplates(fileName, shared.source, shared.sourceFile) : null;
      if (!rewrite) return shared.sourceFile;
      rewritten.set(fileName, { rewrite, original: shared.sourceFile });
      return keptParse(fileName, key, rewrite.text, () => ts.createSourceFile(fileName, rewrite.text, request));
    }
    const modified = ts.sys.getModifiedTime?.(fileName)?.getTime();
    if (modified === undefined) return getSourceFile.call(host, fileName, request, onError, shouldCreateNewSourceFile);
    return keptParse(fileName, key, String(modified), () =>
      getSourceFile.call(host, fileName, request, onError, shouldCreateNewSourceFile),
    );
  };
  if (!hasDom) return { host, rootNames: [], mapDiagnostic: (d) => d };

  /** A diagnostic's file and span, moved from a rewritten source to the source as written. */
  const mapLocation = <
    T extends { file: ts.SourceFile | undefined; start: number | undefined; length: number | undefined },
  >(
    located: T,
  ): T => {
    const entry = located.file && rewritten.get(located.file.fileName);
    if (!entry || located.start === undefined) return located;
    return { ...located, file: entry.original, ...entry.rewrite.toOriginal(located.start, located.length ?? 0) };
  };
  const mapDiagnostic = (diagnostic: ts.Diagnostic): ts.Diagnostic => {
    const mapped = mapLocation(diagnostic);
    return diagnostic.relatedInformation
      ? { ...mapped, relatedInformation: diagnostic.relatedInformation.map(mapLocation) }
      : mapped;
  };
  return { host, rootNames: [declarationFile], mapDiagnostic, ownFile: declarationFile };
};

export const TSCTypeCheckerPlugin = (options?: { strict?: boolean; projectRoot?: string | undefined }): Plugin => {
  const strict = options?.strict ?? true;

  /** Runs in onStart: esbuild waits for it, and never overlaps two builds of one context. */
  const runTypeCheck = async (): Promise<OnStartResult | undefined> => {
    const projectRoot = path.resolve(options?.projectRoot ?? process.cwd());
    // The build's only type sync, before the check reads its files. A sync that fails still fails
    // the build, reported under the sync's name as when it was a plugin of its own.
    let generatedCount: number;
    try {
      generatedCount = await syncProjectTypes(projectRoot);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return { errors: [{ text, pluginName: PLUGIN_NAME.TYPES_SYNC }] };
    }
    if (generatedCount > 0) {
      logger.info(PLUGIN_NAME.TYPES_SYNC, `Generated hidden type file(s) for ${generatedCount} route table(s)`);
    }
    try {
      await checkProject(strict, projectRoot);
    } catch (error) {
      if (strict && error instanceof Error && error.message.includes('type check failed')) {
        throw error;
      }
      logger.error(NAME, 'Type check error', error);
    }
    return undefined;
  };

  return {
    name: NAME,
    setup(build) {
      build.onStart(() => runTypeCheck());
    },
  };
};
