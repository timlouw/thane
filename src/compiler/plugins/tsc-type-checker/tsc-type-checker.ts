import ts from 'typescript';
import path from 'path';
import type { Plugin } from 'esbuild';
import { logger, PLUGIN_NAME } from '../../utils/index.js';
import { ErrorCode, createError } from '../../errors.js';

const NAME = PLUGIN_NAME.TYPE_CHECK;

export const TypeCheckPlugin = (options?: { strict?: boolean }): Plugin => {
  let isRunning = false;
  const strict = options?.strict ?? false;

  const runTypeCheck = (): void => {
    if (isRunning) return;
    isRunning = true;

    logger.info(NAME, 'Running TypeScript type check...');

    try {
      const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
      if (!configPath) {
        logger.diagnostic(createError('Could not find tsconfig.json', undefined, ErrorCode.FILE_NOT_FOUND));
        isRunning = false;
        return;
      }

      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (configFile.error) {
        logger.diagnostic(createError('Error reading tsconfig.json', undefined, ErrorCode.FILE_NOT_FOUND));
        isRunning = false;
        return;
      }

      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      );

      const program = ts.createProgram({
        rootNames: parsedConfig.fileNames,
        options: { ...parsedConfig.options, noEmit: true },
      });

      const diagnostics = ts.getPreEmitDiagnostics(program);

      isRunning = false;

      if (diagnostics.length > 0) {
        const formatHost: ts.FormatDiagnosticsHost = {
          getCanonicalFileName: (path) => path,
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
        } else {
          logger.warn(NAME, 'Type check found issues');
          console.error('---------------------------------------------------------------');
          console.error(formatted);
          console.error('---------------------------------------------------------------');
        }
      }
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
