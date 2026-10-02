/**
 * The hot updates of a `thane dev` rebuild: the modules to run again for the files that changed, up to the
 * component files the page swaps (hotUpdatePlan), each bundled on its own, as CommonJS, with its imports left
 * to the page's modules; the page runs them in order and swaps the components (see
 * plugins/component-precompiler/hot-modules.ts). Null means the page reloads: a change reaches the entry,
 * nothing changed, or a bundle failed.
 */
import { build } from 'esbuild';
import type { BuildContext } from '../types.js';
import { ComponentPrecompilerPlugin } from '../plugins/component-precompiler/component-precompiler.js';
import { GlobalCSSBundlerPlugin } from '../plugins/global-css-bundler/global-css-bundler.js';
import { HotExternalsPlugin, hotModuleKey, hotUpdatePlan } from '../plugins/component-precompiler/hot-modules.js';
import { logger } from '../utils/index.js';

/** One module to run again, compiled for the page: its module key and its code */
export interface HotUpdate {
  key: string;
  code: string;
}

export interface HotUpdateOptions {
  buildContext: BuildContext;
  /** The build's constants and browser targets, which the updates are compiled with too */
  define: Record<string, string>;
  target: string[];
}

export const buildHotUpdates = async (options: HotUpdateOptions): Promise<HotUpdate[] | null> => {
  const { buildContext } = options;
  const plan = buildContext.hot ? hotUpdatePlan(buildContext.hot) : null;
  if (!plan) return null;
  try {
    const updates: HotUpdate[] = [];
    for (const file of plan) {
      const result = await build({
        absWorkingDir: process.cwd(),
        entryPoints: [file],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'browser',
        target: options.target,
        define: options.define,
        logLevel: 'silent',
        plugins: [
          ComponentPrecompilerPlugin(buildContext, { hotUpdate: true }),
          GlobalCSSBundlerPlugin(),
          HotExternalsPlugin(buildContext.projectRoot),
        ],
      });
      updates.push({ key: hotModuleKey(file, buildContext.projectRoot), code: result.outputFiles[0]!.text });
    }
    logger.info('hot', `Updated ${updates.map((update) => update.key).join(', ')}`);
    return updates;
  } catch (error) {
    logger.warn('hot', `A hot update failed, so the page reloads: ${error instanceof Error ? error.message : error}`);
    return null;
  }
};
