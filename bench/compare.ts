/**
 * Compares saved benchmark results.
 *
 *   bun bench/compare.ts <label> <label> [<label>...] [--metric script,total,paint,memory] [--all]
 *
 * The first label is the baseline; every other label is reported relative to it.
 * See README.md in this folder for how to read the output.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geometricMean, mannWhitneyP, type Stats } from './stats.ts';

export type Metric = 'script' | 'total' | 'paint' | 'memory';
const ALL_METRICS: Metric[] = ['script', 'total', 'paint', 'memory'];
const DEFAULT_METRICS: Metric[] = ['script', 'total', 'memory'];

const METRIC_TITLES: Record<Metric, string> = {
  script: 'script time (ms) — JavaScript executed for the operation',
  total: 'total time (ms) — click to the frame that shows the result',
  paint: 'paint time (ms) — style, layout and paint inside that window',
  memory: 'memory (MB) — heap after the operation and a forced GC',
};

export interface ResultFile {
  label: string;
  benchmark: string;
  type: 'cpu' | 'memory';
  iterations: number;
  commit: string;
  dirty: boolean;
  browser: string;
  measuredAt: string;
  values: Partial<Record<Metric, Stats>>;
}

export interface Summary {
  label: string;
  commit: string;
  dirty: boolean;
  builtAt: string;
  browser: string;
  updatedAt: string;
  benchmarks: Record<
    string,
    { type: 'cpu' | 'memory'; iterations: number; medians: Partial<Record<Metric, number>>; measuredAt: string }
  >;
}

export interface LoadedLabel {
  label: string;
  summary: Summary;
  results: Map<string, ResultFile>;
}

export const resultsRoot = join(dirname(fileURLToPath(import.meta.url)), 'results');

export function loadLabel(label: string): LoadedLabel {
  const dir = join(resultsRoot, label);
  const summaryPath = join(dir, 'summary.json');
  if (!existsSync(summaryPath)) {
    throw new Error(`No results for label "${label}" (expected ${summaryPath}). Run: bun run bench --label ${label}`);
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Summary;
  const results = new Map<string, ResultFile>();
  for (const file of readdirSync(dir)) {
    if (file === 'summary.json' || !file.endsWith('.json')) continue;
    const result = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ResultFile;
    results.set(result.benchmark, result);
  }
  return { label, summary, results };
}

const pad = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length));
const padStart = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s);

function verdict(ratio: number, p: number): string {
  if (p >= 0.05) return 'same';
  return ratio < 1 ? 'faster' : 'slower';
}

export function renderComparison(loaded: LoadedLabel[], metrics: Metric[] = DEFAULT_METRICS): string {
  if (loaded.length < 2) throw new Error('renderComparison needs at least two labels');
  const base = loaded[0]!;
  const others = loaded.slice(1);
  const lines: string[] = [];

  const meta = loaded.map((l) => {
    const dirty = l.summary.dirty ? ' (uncommitted changes)' : '';
    return `  ${pad(l.label, 16)} commit ${l.summary.commit}${dirty}, ${l.summary.browser}, built ${l.summary.builtAt}`;
  });
  lines.push('labels:', ...meta, '');

  const browsers = new Set(loaded.map((l) => l.summary.browser));
  if (browsers.size > 1) {
    lines.push('  ⚠ these labels were measured on different browsers; ratios are not reliable', '');
  }

  const VALUE_W = 11;
  const RATIO_W = 16;
  const NAME_W = 24;

  for (const metric of metrics) {
    const ids = [...base.results.keys()].filter((id) => base.results.get(id)!.values[metric]).sort();
    if (ids.length === 0) continue;

    lines.push(METRIC_TITLES[metric]);
    const header =
      pad('benchmark', NAME_W) +
      loaded.map((l) => padStart(l.label.slice(0, VALUE_W - 1), VALUE_W)).join('') +
      others.map(() => padStart(`vs ${base.label}`.slice(0, RATIO_W - 1), RATIO_W)).join('');
    lines.push(header);
    lines.push('-'.repeat(header.length));

    const ratios = new Map<string, number[]>(others.map((l) => [l.label, []]));
    for (const id of ids) {
      const baseStats = base.results.get(id)!.values[metric]!;
      let row = pad(id, NAME_W);
      for (const l of loaded) {
        const s = l.results.get(id)?.values[metric];
        row += padStart(s ? s.median.toFixed(2) : '-', VALUE_W);
      }
      for (const l of others) {
        const s = l.results.get(id)?.values[metric];
        if (!s) {
          row += padStart('-', RATIO_W);
          continue;
        }
        const ratio = s.median / baseStats.median;
        ratios.get(l.label)!.push(ratio);
        const p = mannWhitneyP(baseStats.values, s.values);
        row += padStart(`${ratio.toFixed(2)}x ${verdict(ratio, p)}`, RATIO_W);
      }
      lines.push(row);
    }

    if (others.length > 0) {
      let row = pad('geometric mean', NAME_W) + ' '.repeat(VALUE_W * loaded.length);
      for (const l of others) {
        const r = ratios.get(l.label)!;
        row += padStart(r.length ? `${geometricMean(r).toFixed(3)}x` : '-', RATIO_W);
      }
      lines.push(row);
    }
    lines.push('');
  }

  lines.push('ratio < 1 is an improvement. "faster"/"slower" means p < 0.05 on a Mann-Whitney U test over the');
  lines.push('raw iterations; "same" means the difference is within run-to-run noise. Medians are shown.');
  return lines.join('\n');
}

function parseArgs(argv: string[]): { labels: string[]; metrics: Metric[] } {
  const labels: string[] = [];
  let metrics = DEFAULT_METRICS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--metric' || arg === '--metrics') {
      const raw = argv[++i];
      if (!raw) throw new Error('--metric needs a value');
      metrics = raw.split(',').map((m) => {
        if (!ALL_METRICS.includes(m as Metric))
          throw new Error(`Unknown metric "${m}". Use: ${ALL_METRICS.join(', ')}`);
        return m as Metric;
      });
    } else if (arg === '--all') {
      metrics = ALL_METRICS;
    } else if (arg === '-h' || arg === '--help') {
      console.log(
        'Usage: bun bench/compare.ts <baseline-label> <label> [<label>...] [--metric script,total,paint,memory] [--all]',
      );
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option ${arg}`);
    } else {
      labels.push(arg);
    }
  }
  if (labels.length < 2) {
    throw new Error('Give at least two labels, the baseline first. Example: bun run bench:compare baseline guard');
  }
  return { labels, metrics };
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    const { labels, metrics } = parseArgs(process.argv.slice(2));
    console.log(renderComparison(labels.map(loadLabel), metrics));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
