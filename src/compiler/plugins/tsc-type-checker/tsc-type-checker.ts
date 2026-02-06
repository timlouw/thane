import ts from 'typescript';
import path from 'path';
import type { Plugin } from 'esbuild';
import { logger, PLUGIN_NAME } from '../../utils/index.js';

const NAME = PLUGIN_NAME.TYPE_CHECK;
let isRunning = false;

const runTypeCheck = (): void => {
  if (isRunning) return;
  isRunning = true;

  logger.info(NAME, 'Running TypeScript type check...');

  // Use the TypeScript compiler API instead of spawning a child process
  try {
    const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) {
      logger.error(NAME, 'Could not find tsconfig.json');
      isRunning = false;
      return;
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      logger.error(NAME, 'Error reading tsconfig.json');
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
      logger.error(NAME, 'Type check failed');
      console.error('---------------------------------------------------------------');
      const formatHost: ts.FormatDiagnosticsHost = {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => ts.sys.newLine,
      };
      console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
      console.error('---------------------------------------------------------------');
    }
  } catch (error) {
    isRunning = false;
    logger.error(NAME, 'Type check error', error);
  }
};

export const TypeCheckPlugin: Plugin = {
  name: NAME,
  setup(build) {
    build.onStart(() => runTypeCheck());
  },
};
