/**
 * Thane Build Runner
 */

import { build, context, type BuildOptions, type Plugin } from 'esbuild';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { BuildConfig } from './types.js';
import {
  consoleColors,
  createBuildContext,
  BROWSER_TARGETS,
  logger,
  projectRootWarning,
  resolveProjectRoot,
} from '../utils/index.js';

import { clearAllDebounceTimers } from '../plugins/post-build-processor/file-copy.js';
import { TSCTypeCheckerPlugin } from '../plugins/tsc-type-checker/tsc-type-checker.js';
import { ComponentPrecompilerPlugin } from '../plugins/component-precompiler/component-precompiler.js';
import { ThaneLinterPlugin } from '../plugins/thane-linter/thane-linter.js';
import { GlobalCSSBundlerPlugin } from '../plugins/global-css-bundler/global-css-bundler.js';
import { MinificationPlugin } from '../plugins/minification/minification.js';
import { PostBuildPlugin } from '../plugins/post-build-processor/post-build-processor.js';
import { routeTablesOf } from '../plugins/router-typegen/route-head.js';
import { createHotState } from '../plugins/component-precompiler/hot-modules.js';
import { buildHotUpdates } from './hot-updates.js';

/** `--analyze`: esbuild's metafile, written to the output folder after every build and rebuild */
export const AnalyzePlugin = (outDir: string): Plugin => ({
  name: 'analyze',
  setup(build) {
    build.onEnd(async (result) => {
      if (!result.metafile) return;
      const metafilePath = join(outDir, 'metafile.json');
      await writeFile(metafilePath, JSON.stringify(result.metafile, null, 2), 'utf8');
      console.info(consoleColors.blue, `📊 Metafile written to ${metafilePath}`);
    });
  },
});

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

  const firstEntry = config.entryPoints[0];
  const projectRoot = config.projectRoot ?? (firstEntry ? resolveProjectRoot(firstEntry) : process.cwd());
  const rootWarning = config.projectRoot ? null : projectRootWarning(projectRoot);
  if (rootWarning) logger.warn('build', rootWarning);
  const buildContext = await createBuildContext(projectRoot);

  // Templates, stylesheets and selectors are minified by the compiler as it emits them (see
  // plugins/minification); esbuild minifies the JavaScript. Nothing edits the emitted files.
  buildContext.minify = config.isProd;
  buildContext.lint = config.lint;
  // `thane dev` swaps a changed component file in the open page instead of reloading it
  if (config.serve && !config.isProd) buildContext.hot = createHotState();

  // The runtime's build constants. A production build leaves out the development checks (a cycle of
  // signals), and the router's head renderer when the routes use no head field but `title`. A
  // development build keeps both, so a head field added while `thane dev` runs works at once.
  const routeTables = config.isProd
    ? await routeTablesOf(config.entryPoints, projectRoot, config.inputHTMLFilePath)
    : undefined;
  const define: Record<string, string> = {
    ...config.define,
    __THANE_DEV__: String(!config.isProd),
    __THANE_HEAD__: String(routeTables?.usesHead ?? true),
    // The router's guard and redirect step, left out when no route has canEnter or redirectTo
    __THANE_GUARDS__: String(routeTables?.usesGuards ?? true),
    // The router's link handling, left out when no template (nor index.html) has a plain <a href>
    __THANE_LINKS__: String(routeTables?.usesLinks ?? true),
    // Typed search values (route.search, and search values in href() and navigate()), left out without a schema
    __THANE_SEARCH__: String(routeTables?.usesSearch ?? true),
  };

  // Resolve esbuild targets: user-specified or built-in defaults
  const targets = config.target.length > 0 ? config.target : [...BROWSER_TARGETS];

  const plugins = [
    TSCTypeCheckerPlugin({ strict: config.strictTypeCheck, projectRoot }),
    ThaneLinterPlugin({ severities: config.lint }),
    ComponentPrecompilerPlugin(buildContext),
    GlobalCSSBundlerPlugin({
      minify: config.isProd,
      selectorMap: () => buildContext.selectorMap,
      hot: buildContext.hot,
    }),
    ...(config.isProd
      ? [
          MinificationPlugin(buildContext, {
            projectRoot,
            htmlPath: config.inputHTMLFilePath,
            outDir: config.outDir,
            entryPoints: config.entryPoints,
          }),
        ]
      : []),
    PostBuildPlugin({
      distDir: config.outDir,
      inputHTMLFilePath: config.inputHTMLFilePath,
      outputHTMLFilePath: config.outputHTMLFilePath,
      entryPoints: config.entryPoints,
      assetsInputDir: config.assetsInputDir,
      assetsOutputDir: config.assetsOutputDir,
      publicInputDir: config.publicInputDir,
      serve: config.serve,
      isProd: config.isProd,
      useGzip: config.useGzip,
      buildContext,
      port: config.port,
      open: config.open,
      host: config.host,
      emptyOutDir: config.emptyOutDir,
      base: config.base,
      hotUpdates: buildContext.hot ? () => buildHotUpdates({ buildContext, define, target: targets }) : undefined,
    }),
    ...(config.analyze ? [AnalyzePlugin(config.outDir)] : []),
  ];

  // Resolve entry/chunk naming pattern based on hashFileNames
  const names = config.hashFileNames ? '[name]-[hash]' : '[name]';

  // Console and debugger statements are dropped in production builds only.
  const prodDrop: ('console' | 'debugger')[] = [];
  if (config.dropConsole) prodDrop.push('console');
  if (config.dropDebugger) prodDrop.push('debugger');

  const buildConfig: BuildOptions = {
    // esbuild's default is the directory it was loaded in; the post-build step resolves the
    // metafile's paths against the current one
    absWorkingDir: process.cwd(),
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
    entryNames: names,
    chunkNames: names,
    legalComments: config.legalComments,
    define,
    // `minify` implies minifyWhitespace, minifyIdentifiers and minifySyntax.
    minify: config.isProd,
    ...(config.isProd && prodDrop.length > 0 && { drop: prodDrop }),
    write: true,
    plugins,
  };

  try {
    if (!config.serve) {
      await build(buildConfig);
      console.info(consoleColors.green, `\n⏱️  Build completed in ${(performance.now() - startTime).toFixed(2)}ms`);
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
