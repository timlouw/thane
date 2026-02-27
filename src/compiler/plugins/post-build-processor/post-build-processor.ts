/**
 * Post-Build Processor — orchestrates file copying, compression, HTML templating,
 * dev server, live reload, and console reporting after esbuild completes.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Metafile, Plugin } from 'esbuild';
import { sourceCache, PLUGIN_NAME, consoleColors, logger } from '../../utils/index.js';
import type { BuildContext } from '../../types.js';

import {
  recursivelyCopyAssetsIntoDist,
  watchAndRecursivelyCopyAssetsIntoDist,
  watchFileForChanges,
} from './file-copy.js';
import { gzipDistFiles } from './compression.js';
import { DevServer } from './dev-server.js';
import { printAllFileSizes, printTotalSizes } from './console-reporting.js';
import { minifySelectorsInHTML } from '../minification/minification.js';
import { minifyHTML } from '../minification/template-minifier.js';

const NAME = PLUGIN_NAME.POST_BUILD;

export interface PostBuildOptions {
  distDir: string;
  inputHTMLFilePath: string;
  outputHTMLFilePath: string;
  assetsInputDir?: string | undefined;
  assetsOutputDir?: string | undefined;
  serve?: boolean | undefined;
  isProd?: boolean | undefined;
  useGzip?: boolean | undefined;
  buildContext?: BuildContext | undefined;
  port?: number | undefined;
  open?: boolean | undefined;
  host?: string | undefined;
  emptyOutDir?: boolean | undefined;
  base?: string | undefined;
}

export const PostBuildPlugin = (options: PostBuildOptions): Plugin => {
  const config = options;
  let totalBundleSizeInBytes = 0;
  let fileSizeLog: { fileName: string; sizeInBytes: number }[] = [];

  const devServer = new DevServer({
    distDir: config.distDir,
    isProd: config.isProd,
    useGzip: config.useGzip,
    port: config.port,
    open: config.open,
    host: config.host,
  });

  let watchersStarted = false;
  let cachedHashedFileNames: Record<string, string> = {};

  /**
   * Re-process the HTML template and notify live reload clients.
   * Used by file watchers when index.html or assets change.
   */
  const reprocessAndReloadHTML = async (): Promise<void> => {
    const { inputHTMLFilePath, outputHTMLFilePath, serve } = config;
    const placeholders: Record<string, string | undefined> = {
      MAIN_JS_FILE_PLACEHOLDER: cachedHashedFileNames['main'],
      ROUTER_JS_FILE_PLACEHOLDER: cachedHashedFileNames['router'],
      INDEX_JS_FILE_PLACEHOLDER: cachedHashedFileNames['index'],
    };
    let data = await fs.promises.readFile(inputHTMLFilePath, 'utf8');
    for (const [placeholder, fileName] of Object.entries(placeholders)) {
      if (fileName) {
        data = data.replace(placeholder, fileName);
      }
    }
    let updatedData = data;
    if (config.buildContext) {
      updatedData = minifySelectorsInHTML(updatedData, config.buildContext);
    }
    if (serve) {
      updatedData = DevServer.injectLiveReloadScript(updatedData);
    }
    await fs.promises.writeFile(outputHTMLFilePath, updatedData, 'utf8');
    devServer.notifyLiveReloadClients();
  };

  const copyIndexHTMLIntoDistAndStartServer = async (
    hashedFileNames: Record<string, string | undefined>,
  ): Promise<void> => {
    const { inputHTMLFilePath, outputHTMLFilePath, isProd, serve, useGzip, distDir } = config;
    const placeholders: Record<string, string | undefined> = {
      MAIN_JS_FILE_PLACEHOLDER: hashedFileNames['main'],
      ROUTER_JS_FILE_PLACEHOLDER: hashedFileNames['router'],
      INDEX_JS_FILE_PLACEHOLDER: hashedFileNames['index'],
    };
    let data = await fs.promises.readFile(inputHTMLFilePath, 'utf8');
    for (const [placeholder, fileName] of Object.entries(placeholders)) {
      if (fileName) {
        data = data.replace(placeholder, fileName);
      }
    }
    let updatedData = data;
    if (config.buildContext) {
      updatedData = minifySelectorsInHTML(updatedData, config.buildContext);
    }
    if (isProd) {
      updatedData = minifyHTML(updatedData);
    }
    if (serve) {
      updatedData = DevServer.injectLiveReloadScript(updatedData);
    }

    await fs.promises.writeFile(outputHTMLFilePath, updatedData, 'utf8');

    const sizeInBytes = Buffer.byteLength(updatedData, 'utf8');
    totalBundleSizeInBytes += sizeInBytes;
    fileSizeLog.push({ fileName: 'index.html', sizeInBytes });

    if (useGzip) {
      await gzipDistFiles(distDir, isProd);
    }
    await printAllFileSizes(fileSizeLog, distDir, useGzip);
    await printTotalSizes(totalBundleSizeInBytes, fileSizeLog, distDir, useGzip);

    fileSizeLog.length = 0;

    if (serve && !devServer.isStarted) {
      devServer.start();
    } else if (serve && !isProd) {
      devServer.notifyLiveReloadClients();
    }
  };

  const processMetafileAndUpdateHTML = async (metafile: Metafile): Promise<void> => {
    const { distDir } = config;
    const outputs = metafile.outputs;
    const hashedFileNames: Record<string, string> = {
      main: '',
      router: '',
      index: '',
    };
    for (const [outputPath, info] of Object.entries(outputs)) {
      const fileName = path.basename(outputPath);
      const fullPath = path.join(distDir, fileName);
      let sizeInBytes = info.bytes;
      try {
        const stats = await fs.promises.stat(fullPath);
        sizeInBytes = stats.size;
      } catch (statErr) {
        logger.verbose(`Could not stat ${fullPath}, using metafile size: ${(statErr as Error).message}`);
      }

      totalBundleSizeInBytes += sizeInBytes;
      fileSizeLog.push({ fileName, sizeInBytes });
      if (info.entryPoint) {
        if (info.entryPoint.includes('main.ts') || info.entryPoint.includes('main-')) {
          hashedFileNames['main'] = fileName;
        } else if (info.entryPoint.includes('router.ts')) {
          hashedFileNames['router'] = fileName;
        } else if (info.entryPoint.includes('index.ts')) {
          hashedFileNames['index'] = fileName;
        }
      }
    }

    cachedHashedFileNames = { ...hashedFileNames };
    await copyIndexHTMLIntoDistAndStartServer(hashedFileNames);
  };

  return {
    name: NAME,
    setup(build) {
      const { distDir } = config;

      build.onStart(async () => {
        sourceCache.clear();

        if (config.emptyOutDir !== false && fs.existsSync(distDir)) {
          await fs.promises.rm(distDir, { recursive: true });
        }
        await fs.promises.mkdir(distDir, { recursive: true });
      });

      build.onEnd(async (result) => {
        totalBundleSizeInBytes = 0;

        const { assetsInputDir, assetsOutputDir, serve, inputHTMLFilePath } = config;
        if (assetsInputDir && assetsOutputDir) {
          if (serve && !watchersStarted) {
            watchAndRecursivelyCopyAssetsIntoDist(assetsInputDir, assetsOutputDir, () => {
              devServer.notifyLiveReloadClients();
            });
          } else {
            await recursivelyCopyAssetsIntoDist(assetsInputDir, assetsOutputDir);
          }
        }

        if (result.metafile) {
          await processMetafileAndUpdateHTML(result.metafile);
        }

        if (serve && !watchersStarted) {
          watchFileForChanges(inputHTMLFilePath, () => {
            console.info(consoleColors.blue, 'index.html changed, reloading...');
            void reprocessAndReloadHTML();
          });
          watchersStarted = true;
        }
      });
    },
  };
};
