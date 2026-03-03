/**
 * Thane Build Runner
 */

import { build, context, type BuildOptions } from 'esbuild';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { BuildConfig } from './types.js';
import { consoleColors, createBuildContext, BROWSER_TARGETS } from '../utils/index.js';

import { clearAllDebounceTimers } from '../plugins/post-build-processor/file-copy.js';
import { TypeCheckPlugin } from '../plugins/tsc-type-checker/tsc-type-checker.js';
import { RoutesPrecompilerPlugin } from '../plugins/routes-precompiler/routes-precompiler.js';
import { ComponentPrecompilerPlugin } from '../plugins/component-precompiler/component-precompiler.js';
import { ReactiveBindingPlugin } from '../plugins/reactive-binding-compiler/index.js';
import { ThaneLinterPlugin } from '../plugins/thane-linter/thane-linter.js';
import { GlobalCSSBundlerPlugin } from '../plugins/global-css-bundler/global-css-bundler.js';
import { HTMLBootstrapInjectorPlugin } from '../plugins/html-bootstrap-injector/html-bootstrap-injector.js';
import { MinificationPlugin } from '../plugins/minification/minification.js';
import { JsOutputOptimizerPlugin } from '../plugins/js-output-optimizer/js-output-optimizer.js';
import { PostBuildPlugin } from '../plugins/post-build-processor/post-build-processor.js';

export async function runBuild(config: BuildConfig): Promise<void> {
  // Validate that entry files exist before starting the build
  for (const entry of config.entryPoints) {
    const resolved = resolve(entry);
    if (!existsSync(resolved)) {
      const isDefault = entry === './src/main.ts';
      if (isDefault) {
        throw new Error(
          `Default entry file not found: './src/main.ts'. ` +
            `Either create src/main.ts or specify a custom entry with --entry <path>.`,
        );
      }
      throw new Error(`Entry file not found: '${entry}'. Ensure the --entry path is correct.`);
    }
  }

  const startTime = performance.now();
  const environment = config.isProd ? 'prod' : 'dev';

  console.info(consoleColors.blue, `Running ${environment} build...`);

  const buildContext = await createBuildContext();

  const basePlugins = [
    TypeCheckPlugin({ strict: config.strictTypeCheck }),
    ThaneLinterPlugin(),
    RoutesPrecompilerPlugin,
    ComponentPrecompilerPlugin(buildContext),
    ReactiveBindingPlugin,
    GlobalCSSBundlerPlugin({ minify: config.isProd }),
    HTMLBootstrapInjectorPlugin({ entryPoints: config.entryPoints, buildContext }),
  ];

  const postBuildOptions = {
    distDir: config.outDir,
    inputHTMLFilePath: config.inputHTMLFilePath,
    outputHTMLFilePath: config.outputHTMLFilePath,
    entryPoints: config.entryPoints,
    assetsInputDir: config.assetsInputDir,
    assetsOutputDir: config.assetsOutputDir,
    serve: config.serve,
    isProd: config.isProd,
    useGzip: config.useGzip,
    buildContext,
    port: config.port,
    open: config.open,
    host: config.host,
    emptyOutDir: config.emptyOutDir,
    base: config.base,
  };

  const prodPlugins = [
    ...basePlugins,
    MinificationPlugin(buildContext),
    JsOutputOptimizerPlugin,
    PostBuildPlugin(postBuildOptions),
  ];

  const devPlugins = [...basePlugins, PostBuildPlugin(postBuildOptions)];

  // Resolve esbuild targets: user-specified or built-in defaults
  const targets = config.target.length > 0 ? config.target : [...BROWSER_TARGETS];

  // Resolve entry/chunk naming pattern based on hashFileNames
  const entryNames = config.hashFileNames ? '[name]-[hash]' : '[name]';
  const chunkNames = config.hashFileNames ? '[name]-[hash]' : '[name]';

  const baseEsbuildConfig: BuildOptions = {
    entryPoints: config.entryPoints,
    bundle: true,
    platform: 'browser',
    target: targets,
    outdir: config.outDir,
    treeShaking: true,
    logLevel: 'error',
    splitting: config.splitting,
    format: 'esm',
    sourcemap: config.sourcemap,
    metafile: true,
    entryNames,
    chunkNames,
    legalComments: config.legalComments,
    ...(Object.keys(config.define).length > 0 && { define: config.define }),
  };

  const devBuildConfig: BuildOptions = {
    ...baseEsbuildConfig,
    minify: false,
    write: true,
    plugins: devPlugins,
  };

  const prodDrop: ('console' | 'debugger')[] = [];
  if (config.dropConsole) prodDrop.push('console');
  if (config.dropDebugger) prodDrop.push('debugger');

  const prodBuildConfig: BuildOptions = {
    ...baseEsbuildConfig,
    minify: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    ...(prodDrop.length > 0 && { drop: prodDrop }),
    write: false,
    plugins: prodPlugins,
  };

  const buildConfig = config.isProd ? prodBuildConfig : devBuildConfig;

  try {
    if (!config.serve) {
      const result = await build(buildConfig);
      console.info(consoleColors.green, `\n⏱️  Build completed in ${(performance.now() - startTime).toFixed(2)}ms`);

      // Write metafile for bundle analysis when --analyze is enabled
      if (config.analyze && result.metafile) {
        const metafilePath = join(config.outDir, 'metafile.json');
        await writeFile(metafilePath, JSON.stringify(result.metafile, null, 2), 'utf8');
        console.info(consoleColors.blue, `📊 Metafile written to ${metafilePath}`);
      }
    } else {
      const ctx = await context(buildConfig);
      await ctx.watch({});
      console.info(consoleColors.blue, 'Watching for changes...');

      // Graceful shutdown — dispose esbuild watcher on SIGINT/SIGTERM.
      // Use ctx.dispose() without process.exit() so that registered cleanup
      // handlers (beforeExit, close callbacks) run naturally.
      let shuttingDown = false;
      const shutdown = () => {
        if (shuttingDown) return; // guard against duplicate signals
        shuttingDown = true;
        clearAllDebounceTimers();
        ctx.dispose().catch(() => {
          /* ignore dispose errors during shutdown */
        });
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    }
  } catch (err) {
    throw new Error(`Build failed: ${err instanceof Error ? err.message : err}`);
  }
}
