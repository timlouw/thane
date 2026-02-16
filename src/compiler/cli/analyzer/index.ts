/**
 * Thane Bundle Analyzer
 *
 * Interactive bundle analysis with treemap, dependency graph,
 * and component tree visualization — powered by Thane's signal system.
 *
 * Usage:
 *   thane analyze                  Analyze dev build
 *   thane analyze --prod           Analyze production build
 *   thane analyze --compare        Compare dev vs prod side-by-side
 *
 * @internal
 */

import path from 'node:path';
import { consoleColors } from '../../utils/index.js';
import type { AnalyzerOptions, AnalyzerReport } from './types.js';
import { runBuildAnalysis, getMetafileOnly } from './analyze.js';
import { extractComponentTree } from './component-graph.js';
import { generateAnalyzerHTML } from './ui-generator.js';
import { startAnalyzerServer } from './server.js';

export type { AnalyzerOptions, AnalyzerReport } from './types.js';
export { runBuildAnalysis } from './analyze.js';
export { extractComponentTree } from './component-graph.js';
export { generateAnalyzerHTML } from './ui-generator.js';
export { startAnalyzerServer } from './server.js';

// ============================================================================
// Main Orchestrator
// ============================================================================

export async function runAnalyzer(options: AnalyzerOptions): Promise<void> {
  console.info(consoleColors.blue, '\n  🔍 Thane Bundle Analyzer\n');

  const report: AnalyzerReport = {
    projectName: path.basename(process.cwd()),
    timestamp: Date.now(),
    builds: {},
    componentTree: [],
  };

  try {
    // ── Run Build Analysis ────────────────────────────────────────────
    if (options.compare) {
      console.info(consoleColors.cyan, '  Analyzing dev build...');
      report.builds.dev = await runBuildAnalysis(options, 'dev');
      console.info(consoleColors.green, '  ✓ Dev: ' + fmtSize(report.builds.dev.totalSize) + ' (' + fmtSize(report.builds.dev.totalGzipSize) + ' gzip) in ' + fmtMs(report.builds.dev.buildTimeMs));

      console.info(consoleColors.cyan, '  Analyzing prod build...');
      report.builds.prod = await runBuildAnalysis(options, 'prod');
      console.info(consoleColors.green, '  ✓ Prod: ' + fmtSize(report.builds.prod.totalSize) + ' (' + fmtSize(report.builds.prod.totalGzipSize) + ' gzip) in ' + fmtMs(report.builds.prod.buildTimeMs));
    } else if (options.isProd) {
      console.info(consoleColors.cyan, '  Analyzing prod build...');
      report.builds.prod = await runBuildAnalysis(options, 'prod');
      console.info(consoleColors.green, '  ✓ Prod: ' + fmtSize(report.builds.prod.totalSize) + ' (' + fmtSize(report.builds.prod.totalGzipSize) + ' gzip) in ' + fmtMs(report.builds.prod.buildTimeMs));
    } else {
      console.info(consoleColors.cyan, '  Analyzing dev build...');
      report.builds.dev = await runBuildAnalysis(options, 'dev');
      console.info(consoleColors.green, '  ✓ Dev: ' + fmtSize(report.builds.dev.totalSize) + ' (' + fmtSize(report.builds.dev.totalGzipSize) + ' gzip) in ' + fmtMs(report.builds.dev.buildTimeMs));
    }

    // ── Extract Component Tree ────────────────────────────────────────
    console.info(consoleColors.cyan, '  Extracting component tree...');
    const metafile = await getMetafileOnly(options);
    report.componentTree = await extractComponentTree(metafile);
    console.info(consoleColors.green, '  ✓ Found ' + report.componentTree.length + ' components');

  } catch (err) {
    console.error(consoleColors.red, '  ✗ Analysis failed: ' + (err instanceof Error ? err.message : String(err)));
    throw err;
  }

  // ── Generate & Serve ──────────────────────────────────────────────
  console.info(consoleColors.cyan, '  Generating interactive report...');
  const html = generateAnalyzerHTML(report);
  console.info(consoleColors.green, '  ✓ Report generated');

  startAnalyzerServer(html, options.port);
}

// ============================================================================
// Format Helpers
// ============================================================================

function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function fmtMs(ms: number): string {
  return ms < 1000 ? ms.toFixed(0) + 'ms' : (ms / 1000).toFixed(2) + 's';
}
