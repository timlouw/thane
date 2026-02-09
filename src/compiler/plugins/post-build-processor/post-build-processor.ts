/**
 * Post-Build Processor Plugin
 * 
 * Orchestrates file copying, compression, HTML templating, HTTP server,
 * live reload, and console reporting after esbuild completes.
 * 
 * Split into sub-modules:
 * - file-copy.ts        — Asset copying and watcher with debouncing
 * - compression.ts      — Gzip / Brotli compression
 * - dev-server.ts       — HTTP dev server with live reload
 * - console-reporting.ts — File size reporting
 */

import fs from 'fs';
import path from 'path';
import type { Metafile, Plugin } from 'esbuild';
import { sourceCache, PLUGIN_NAME } from '../../utils/index.js';
import type { BuildContext } from '../../types.js';

import { recursivelyCopyAssetsIntoDist, watchAndRecursivelyCopyAssetsIntoDist } from './file-copy.js';
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
}

export const PostBuildPlugin = (options: PostBuildOptions): Plugin => {
  const config = options;
  let totalBundleSizeInBytes = 0;
  let fileSizeLog: { fileName: string; sizeInBytes: number }[] = [];

  const devServer = new DevServer({
    distDir: config.distDir,
    isProd: config.isProd,
    useGzip: config.useGzip,
  });

  const copyIndexHTMLIntoDistAndStartServer = async (hashedFileNames: Record<string, string | undefined>): Promise<void> => {
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
    if (serve && !isProd) {
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
      } catch {
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

    await copyIndexHTMLIntoDistAndStartServer(hashedFileNames);
  };

  return {
    name: NAME,
    setup(build) {
      const { distDir } = config;
      
      build.onStart(async () => {
        sourceCache.clear();

        if (fs.existsSync(distDir)) {
          await fs.promises.rm(distDir, { recursive: true });
        }
        await fs.promises.mkdir(distDir, { recursive: true });
      });

      build.onEnd(async (result) => {
        totalBundleSizeInBytes = 0;

        const { assetsInputDir, assetsOutputDir, serve } = config;
        if (assetsInputDir && assetsOutputDir) {
          if (serve) {
            watchAndRecursivelyCopyAssetsIntoDist(assetsInputDir, assetsOutputDir);
          } else {
            await recursivelyCopyAssetsIntoDist(assetsInputDir, assetsOutputDir);
          }
        }

        if (result.metafile) {
          await processMetafileAndUpdateHTML(result.metafile);
        }
      });
    },
  };
};
