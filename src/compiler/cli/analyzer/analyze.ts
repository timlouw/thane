/**
 * Thane Bundle Analyzer — Build Analysis Engine
 *
 * Runs esbuild builds (dev/prod) with metafile enabled,
 * then extracts size, dependency, and chunk information.
 * @internal
 */

import { build, type BuildOptions, type Metafile, type OutputFile } from 'esbuild';
import path from 'node:path';
import { createBuildContext } from '../../utils/index.js';
import { ComponentPrecompilerPlugin } from '../../plugins/component-precompiler/component-precompiler.js';
import { ReactiveBindingPlugin } from '../../plugins/reactive-binding-compiler/index.js';
import { RoutesPrecompilerPlugin } from '../../plugins/routes-precompiler/routes-precompiler.js';
import { GlobalCSSBundlerPlugin } from '../../plugins/global-css-bundler/global-css-bundler.js';
import { MinificationPlugin } from '../../plugins/minification/minification.js';
import { JsOutputOptimizerPlugin } from '../../plugins/js-output-optimizer/js-output-optimizer.js';
import type {
  AnalyzerOptions,
  BuildAnalysis,
  ChunkAnalysis,
  ModuleAnalysis,
  DependencyEdge,
  ModuleCategory,
} from './types.js';

// ============================================================================
// Helpers
// ============================================================================

const cwd = (): string => process.cwd().replace(/\\/g, '/');

function shortenPath(filePath: string): string {
  const root = cwd();
  return filePath.replace(/\\/g, '/').replace(root + '/', '').replace(root, '');
}

function categorizeModule(filePath: string): ModuleCategory {
  const p = filePath.replace(/\\/g, '/');
  if (p.includes('node_modules')) return 'library';
  if (/signal/i.test(p)) return 'signal';
  if (/\.css$|\.scss$|style/i.test(p)) return 'style';
  if (/route|page/i.test(p)) return 'route';
  if (/component/i.test(p) || /defineComponent/.test(p)) return 'component';
  if (/runtime|thane/i.test(p)) return 'runtime';
  return 'other';
}

function gzipSize(content: Uint8Array | string): number {
  try {
    const buf = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
    return Bun.gzipSync(buf, { level: 9 }).length;
  } catch {
    return 0;
  }
}

// ============================================================================
// Build Runner
// ============================================================================

export async function runBuildAnalysis(
  options: AnalyzerOptions,
  mode: 'dev' | 'prod',
): Promise<BuildAnalysis> {
  const startTime = performance.now();
  const isProd = mode === 'prod';

  const buildContext = await createBuildContext();

  const basePlugins = [
    RoutesPrecompilerPlugin,
    ComponentPrecompilerPlugin(buildContext),
    ReactiveBindingPlugin,
    GlobalCSSBundlerPlugin({ minify: isProd }),
  ];

  const plugins = isProd
    ? [...basePlugins, MinificationPlugin(buildContext), JsOutputOptimizerPlugin]
    : basePlugins;

  const esbuildConfig: BuildOptions = {
    entryPoints: options.entryPoints,
    bundle: true,
    platform: 'browser',
    target: ['es2022', 'chrome94', 'firefox93', 'safari15', 'edge94'],
    outdir: path.join(options.outDir, '__thane_analyze_' + mode),
    treeShaking: true,
    logLevel: 'silent',
    splitting: true,
    format: 'esm',
    sourcemap: false,
    metafile: true,
    write: false,
    entryNames: '[name]-[hash]',
    chunkNames: '[name]-[hash]',
    legalComments: 'none',
    minify: isProd,
    minifyWhitespace: isProd,
    minifyIdentifiers: isProd,
    minifySyntax: isProd,
    plugins,
  };

  if (isProd) {
    (esbuildConfig as any).drop = ['console', 'debugger'];
  }

  const result = await build(esbuildConfig);
  const buildTimeMs = performance.now() - startTime;

  if (!result.metafile) {
    throw new Error('esbuild did not produce a metafile');
  }

  return parseMetafile(result.metafile, result.outputFiles ?? [], mode, buildTimeMs);
}

/**
 * Quick metafile-only build for component graph extraction.
 * No transform plugins — just resolves the import graph.
 */
export async function getMetafileOnly(options: AnalyzerOptions): Promise<Metafile> {
  const result = await build({
    entryPoints: options.entryPoints,
    bundle: true,
    platform: 'browser',
    target: ['es2022'],
    outdir: path.join(options.outDir, '__thane_meta_tmp'),
    treeShaking: true,
    logLevel: 'silent',
    splitting: true,
    format: 'esm',
    sourcemap: false,
    metafile: true,
    write: false,
  });
  return result.metafile!;
}

// ============================================================================
// Metafile Parser
// ============================================================================

function parseMetafile(
  metafile: Metafile,
  outputFiles: OutputFile[],
  mode: 'dev' | 'prod',
  buildTimeMs: number,
): BuildAnalysis {
  // Map output file name → content for size calculations
  const outputMap = new Map<string, OutputFile>();
  for (const f of outputFiles) {
    outputMap.set(path.basename(f.path), f);
  }

  // Build the import / importedBy adjacency lists
  const importsMap = new Map<string, string[]>();
  const importedByMap = new Map<string, string[]>();

  for (const [inputPath, inputInfo] of Object.entries(metafile.inputs)) {
    const short = shortenPath(inputPath);
    const imports = inputInfo.imports
      .map((i) => shortenPath(i.path))
      .filter((p) => !p.includes('node_modules'));

    importsMap.set(short, imports);

    for (const imp of imports) {
      if (!importedByMap.has(imp)) importedByMap.set(imp, []);
      importedByMap.get(imp)!.push(short);
    }
  }

  // Parse chunks (output files)
  const chunks: ChunkAnalysis[] = [];
  let totalSize = 0;
  let totalGzipSize = 0;

  for (const [outputPath, outputInfo] of Object.entries(metafile.outputs)) {
    const fileName = path.basename(outputPath);
    if (!fileName.endsWith('.js') && !fileName.endsWith('.css')) continue;

    const outputFile = outputMap.get(fileName);
    const size = outputFile ? outputFile.contents.length : outputInfo.bytes;
    const gz = outputFile ? gzipSize(outputFile.contents) : 0;

    totalSize += size;
    totalGzipSize += gz;

    const moduleEntries: { path: string; size: number }[] = [];
    if (outputInfo.inputs) {
      for (const [modPath, modInfo] of Object.entries(outputInfo.inputs)) {
        moduleEntries.push({ path: shortenPath(modPath), size: modInfo.bytesInOutput });
      }
    }

    chunks.push({
      name: fileName.replace(/-[A-Z0-9]+\.(js|css)$/i, '.$1'),
      size,
      gzipSize: gz,
      isEntry: !!outputInfo.entryPoint,
      entryPoint: outputInfo.entryPoint ? shortenPath(outputInfo.entryPoint) : undefined,
      modules: moduleEntries.sort((a, b) => b.size - a.size),
    });
  }

  // Parse modules
  const modules: ModuleAnalysis[] = [];

  for (const [inputPath, inputInfo] of Object.entries(metafile.inputs)) {
    const short = shortenPath(inputPath);

    // Find which chunk and size-in-output
    let chunk = '';
    let sizeInOutput = 0;
    for (const c of chunks) {
      const found = c.modules.find((m) => m.path === short);
      if (found) {
        chunk = c.name;
        sizeInOutput = found.size;
        break;
      }
    }

    if (sizeInOutput === 0 && short.includes('node_modules')) continue;

    modules.push({
      path: short,
      size: sizeInOutput,
      originalSize: inputInfo.bytes,
      imports: importsMap.get(short) ?? [],
      importedBy: importedByMap.get(short) ?? [],
      chunk,
      category: categorizeModule(inputPath),
    });
  }

  // Dependency edges (non-node_modules only)
  const dependencies: DependencyEdge[] = [];
  for (const [source, targets] of importsMap) {
    for (const target of targets) {
      dependencies.push({ source, target });
    }
  }

  return {
    mode,
    buildTimeMs,
    totalSize,
    totalGzipSize,
    moduleCount: modules.length,
    chunks: chunks.sort((a, b) => b.size - a.size),
    modules: modules.filter((m) => m.size > 0).sort((a, b) => b.size - a.size),
    dependencies,
  };
}
