import ts from 'typescript';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import { syncProjectTypes } from '../router-typegen/router-typegen.js';
import { collectFilesRecursively, logger, PLUGIN_NAME } from '../../utils/index.js';
import { ErrorCode, createError } from '../../errors.js';

const NAME = PLUGIN_NAME.TYPE_CHECK;

export async function runProjectTypeCheck(options?: { strict?: boolean; cwd?: string }): Promise<void> {
  const strict = options?.strict ?? true;
  const currentWorkingDirectory = options?.cwd ?? process.cwd();

  logger.info(NAME, 'Running TypeScript type check...');

  await syncProjectTypes(currentWorkingDirectory);

  const configPath = ts.findConfigFile(currentWorkingDirectory, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    logger.diagnostic(createError('Could not find tsconfig.json', undefined, ErrorCode.FILE_NOT_FOUND));
    return;
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    logger.diagnostic(createError('Error reading tsconfig.json', undefined, ErrorCode.FILE_NOT_FOUND));
    return;
  }

  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const generatedTypesRoot = path.join(path.dirname(configPath), '.thane', 'types');
  const generatedTypeFiles = await collectFilesRecursively(generatedTypesRoot, (fileName) => fileName.endsWith('.d.ts'));
  const rootNames = Array.from(new Set([...parsedConfig.fileNames, ...generatedTypeFiles]));

  const diagnostics = await new Promise<readonly ts.Diagnostic[]>((resolve) => {
    const program = ts.createProgram({
      rootNames,
      options: { ...parsedConfig.options, noEmit: true },
    });
    resolve(ts.getPreEmitDiagnostics(program));
  });

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

export const TSCTypeCheckerPlugin = (options?: { strict?: boolean }): Plugin => {
  let isRunning = false;
  const strict = options?.strict ?? true;

  /** Run TypeScript type-checking asynchronously so esbuild is not blocked. */
  const runTypeCheck = async (): Promise<void> => {
    if (isRunning) return;
    isRunning = true;

    try {
      await runProjectTypeCheck({ strict });
      isRunning = false;
    } catch (error) {
      isRunning = false;
      if (strict && error instanceof Error && error.message.includes('type check failed')) {
        throw error;
      }
      logger.error(NAME, 'Type check error', error);
    }
  };

  return {
    name: NAME,
    setup(build) {
      build.onStart(() => runTypeCheck());
    },
  };
};
