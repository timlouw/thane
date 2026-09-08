/**
 * Thane performance benchmark runner.
 *
 *   bun bench/run.ts --label <name> [options]
 *
 * Builds the benchmark app from the current working tree, serves it locally, drives the
 * js-framework-benchmark operations in Chrome, and records the same trace-derived metrics
 * the official runner reports. See README.md in this folder for the workflow and how to
 * read the results.
 */

import { chromium, type Browser, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkById, benchmarks, type Benchmark, type CpuBenchmark, type MemBenchmark } from './benchmarks.ts';
import { loadLabel, renderComparison, type ResultFile, type Summary } from './compare.ts';
import { stats } from './stats.ts';
import { analyseTrace, type CpuResult, type TraceEvent } from './trace.ts';
import { startServer } from './server.ts';

const benchDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchDir, '..');
const buildRoot = join(benchDir, '.build');
const resultsRoot = join(benchDir, 'results');
const tracesRoot = join(benchDir, 'traces');
const cssRoot = join(benchDir, 'css');

const DEFAULT_ITERATIONS = 15; // the official runner's NUM_ITERATIONS_FOR_BENCHMARK_CPU
const QUICK_ITERATIONS = 5;
const TRACE_CATEGORIES = ['blink.user_timing', 'devtools.timeline', 'disabled-by-default-devtools.timeline'];
const CHROME_ARGS = ['--window-size=1000,800', '--js-flags=--expose-gc', '--enable-benchmarking'];
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface Options {
  label: string;
  interleave: string | undefined;
  only: string[];
  iterations: number;
  /** Whether benchmarks add their extra iterations (select row runs 25 times officially). */
  extraIterations: boolean;
  memIterations: number;
  build: boolean;
  port: number;
  chrome: string | undefined;
  headless: boolean;
}

interface BuildInfo {
  label: string;
  commit: string;
  dirty: boolean;
  builtAt: string;
}

const USAGE = `Usage: bun bench/run.ts --label <name> [options]

  --label <name>        Name for this build and its results (default: current)
  --interleave <name>   Also re-measure an existing build, alternating iterations with this one
  --only <ids>          Comma-separated benchmark ids or substrings, e.g. 04,swap,memory
  --iterations <n>      Iterations per CPU benchmark (default ${DEFAULT_ITERATIONS}; select row adds 10)
  --quick               ${QUICK_ITERATIONS} iterations, for a fast signal while iterating
  --no-build            Reuse bench/.build/<label> instead of rebuilding from the working tree
  --chrome <path>       Chrome executable (default: system Chrome, else Playwright's Chromium)
  --headed              Show the browser window
  --port <n>            Port for the local server (default 8787)
  -h, --help            Show this help
`;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    label: 'current',
    interleave: undefined,
    only: [],
    iterations: DEFAULT_ITERATIONS,
    extraIterations: true,
    memIterations: 1,
    build: true,
    port: 8787,
    chrome: undefined,
    headless: true,
  };
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith('-')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--label':
        options.label = value(++i, arg);
        break;
      case '--interleave':
        options.interleave = value(++i, arg);
        break;
      case '--only':
        options.only = value(++i, arg)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--iterations':
        options.iterations = Number(value(++i, arg));
        if (!Number.isInteger(options.iterations) || options.iterations < 1)
          throw new Error('--iterations must be >= 1');
        break;
      case '--quick':
        options.iterations = QUICK_ITERATIONS;
        options.extraIterations = false;
        break;
      case '--no-build':
        options.build = false;
        break;
      case '--chrome':
        options.chrome = value(++i, arg);
        break;
      case '--headed':
        options.headless = false;
        break;
      case '--port':
        options.port = Number(value(++i, arg));
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
      default:
        throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
    }
  }
  for (const label of [options.label, options.interleave]) {
    if (label !== undefined && !LABEL_PATTERN.test(label)) {
      throw new Error(`Label "${label}" may only contain letters, digits, ".", "_" and "-"`);
    }
  }
  if (options.interleave === options.label) throw new Error('--interleave must name a different label');
  return options;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function exec(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`"${command} ${args.join(' ')}" failed with exit code ${result.status}`);
}

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function buildInfoPath(label: string): string {
  return join(buildRoot, label, 'build-info.json');
}

function readBuildInfo(label: string): BuildInfo {
  const path = buildInfoPath(label);
  if (!existsSync(path)) {
    throw new Error(
      `No build for label "${label}" at ${join(buildRoot, label)}. Run without --no-build, or build it first.`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as BuildInfo;
}

function buildVariant(label: string): BuildInfo {
  console.log('\n▶ Compiling the framework (bun run build)');
  exec('bun', ['run', 'build'], repoRoot);

  console.log(`\n▶ Building the benchmark app into bench/.build/${label}`);
  exec(
    'bun',
    [
      './dist/compiler/cli/thane.js',
      'build',
      '--prod',
      '--entry',
      './bench/app/main.ts',
      '--out',
      `./bench/.build/${label}`,
      '--html',
      './bench/app/index.html',
      '--base',
      `/${label}/`,
    ],
    repoRoot,
  );

  const info: BuildInfo = {
    label,
    commit: git(['rev-parse', '--short', 'HEAD']) || 'unknown',
    dirty: git(['status', '--porcelain']).length > 0,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(buildInfoPath(label), JSON.stringify(info, null, 2));
  return info;
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function defaultChromePath(): string | undefined {
  if (process.env['BENCH_CHROME']) return process.env['BENCH_CHROME'];
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/snap/bin/chromium'];
  return candidates.find((p) => existsSync(p));
}

async function launchBrowser(options: Options): Promise<Browser> {
  const executablePath = options.chrome ?? defaultChromePath();
  if (options.chrome && !existsSync(options.chrome)) throw new Error(`Chrome not found at ${options.chrome}`);
  if (!executablePath) {
    console.warn(
      '⚠ No system Chrome found; using the Chromium bundled with Playwright. Only compare against runs on the same browser.',
    );
  }
  const args = [...CHROME_ARGS];
  if (options.headless) args.push('--headless=new');
  // Same launch shape as the official runner: real Chrome with the new headless mode as a flag.
  return chromium.launch({ args, headless: false, ...(executablePath ? { executablePath } : {}) });
}

async function forceGc(page: Page): Promise<void> {
  await page.evaluate("window.gc({type:'major',execution:'sync',flavor:'last-resort'})");
}

async function withPage<T>(browser: Browser, benchmarkId: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  try {
    const result = await fn(page);
    if (errors.length > 0) throw new Error(`page errors during ${benchmarkId}: ${errors.join('; ')}`);
    return result;
  } finally {
    await page.close();
  }
}

async function runCpuIteration(
  browser: Browser,
  bench: CpuBenchmark,
  url: string,
  traceFile: string,
): Promise<CpuResult> {
  await withPage(browser, bench.id, async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await page.goto(url, { waitUntil: 'networkidle' });
    await bench.init(page);
    await forceGc(page);
    if (bench.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: bench.throttle });
    await browser.startTracing(page, { path: traceFile, screenshots: false, categories: TRACE_CATEGORIES });
    await bench.run(page);
    await sleep(40);
    await browser.stopTracing();
    if (bench.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
  const trace = JSON.parse(readFileSync(traceFile, 'utf8')) as { traceEvents: TraceEvent[] };
  return analyseTrace(trace.traceEvents);
}

async function runMemIteration(browser: Browser, bench: MemBenchmark, url: string): Promise<number> {
  return withPage(browser, bench.id, async (page) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await bench.init(page);
    await bench.run(page);
    await forceGc(page);
    await sleep(40);
    const result = (await page.evaluate('performance.measureUserAgentSpecificMemory()')) as { bytes: number };
    return result.bytes / 1024 / 1024;
  });
}

type Samples = Map<string, CpuResult[] | number[]>;

const fmt = (n: number) => n.toFixed(2).padStart(7);

function medianOf(values: number[]): number {
  return stats(values).median;
}

function printMedians(label: string, bench: Benchmark, samples: CpuResult[] | number[]): void {
  if (bench.type === 'cpu') {
    const cpu = samples as CpuResult[];
    console.log(
      `  ${bench.id.padEnd(24)} ${label.padEnd(14)} median of ${cpu.length}:  total ${fmt(medianOf(cpu.map((r) => r.total)))}  script ${fmt(medianOf(cpu.map((r) => r.script)))}  paint ${fmt(medianOf(cpu.map((r) => r.paint)))}`,
    );
  } else {
    const mem = samples as number[];
    console.log(
      `  ${bench.id.padEnd(24)} ${label.padEnd(14)} median of ${mem.length}:  memory ${fmt(medianOf(mem))} MB`,
    );
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function writeResults(label: string, info: BuildInfo, browser: string, samples: Samples): void {
  const dir = join(resultsRoot, label);
  mkdirSync(dir, { recursive: true });
  const summaryPath = join(dir, 'summary.json');
  const now = new Date().toISOString();

  // Merge into an existing summary so `--only` can refresh a subset of benchmarks.
  const previous = existsSync(summaryPath) ? (JSON.parse(readFileSync(summaryPath, 'utf8')) as Summary) : undefined;
  const summary: Summary = {
    label,
    commit: info.commit,
    dirty: info.dirty,
    builtAt: info.builtAt,
    browser,
    updatedAt: now,
    benchmarks: previous?.commit === info.commit && previous.builtAt === info.builtAt ? previous.benchmarks : {},
  };

  for (const [id, values] of samples) {
    const bench = benchmarkById.get(id)!;
    const file: ResultFile = {
      label,
      benchmark: id,
      type: bench.type,
      iterations: values.length,
      commit: info.commit,
      dirty: info.dirty,
      browser,
      measuredAt: now,
      values: {},
    };
    if (bench.type === 'cpu') {
      const cpu = values as CpuResult[];
      file.values = {
        total: stats(cpu.map((r) => round(r.total))),
        script: stats(cpu.map((r) => round(r.script))),
        paint: stats(cpu.map((r) => round(r.paint))),
      };
    } else {
      file.values = { memory: stats((values as number[]).map(round)) };
    }
    const medians = Object.fromEntries(Object.entries(file.values).map(([k, v]) => [k, v.median]));
    summary.benchmarks[id] = { type: bench.type, iterations: values.length, medians, measuredAt: now };
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(file, null, 2));
  }

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nResults written to bench/results/${label}/`);
}

const round = (n: number) => Number(n.toFixed(3));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const selected = benchmarks.filter((b) => options.only.length === 0 || options.only.some((s) => b.id.includes(s)));
  if (selected.length === 0) {
    throw new Error(
      `--only ${options.only.join(',')} matched no benchmarks. Available: ${benchmarks.map((b) => b.id).join(', ')}`,
    );
  }

  const builds = new Map<string, BuildInfo>();
  builds.set(options.label, options.build ? buildVariant(options.label) : readBuildInfo(options.label));
  if (options.interleave) builds.set(options.interleave, readBuildInfo(options.interleave));
  const labels = [...builds.keys()];

  const server = await startServer({ buildRoot, cssRoot, port: options.port });
  const browser = await launchBrowser(options);
  const browserName = `Chrome ${browser.version()}`;
  const shutdown = async () => {
    await browser.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  };
  process.once('SIGINT', () => {
    void shutdown().then(() => process.exit(130));
  });

  console.log(`\n▶ Measuring ${labels.join(' and ')} with ${browserName} on http://127.0.0.1:${server.port}/`);
  const extras = options.extraIterations ? ', select row +10' : '';
  console.log(
    `  ${selected.length} benchmarks, ${options.iterations} iterations each${extras}, memory ${options.memIterations}\n`,
  );

  const samples = new Map<string, Samples>(labels.map((l) => [l, new Map()]));
  const collect = <T extends CpuResult | number>(label: string, id: string, value: T) => {
    const collected = samples.get(label)!;
    let list = collected.get(id);
    if (!list) {
      list = [];
      collected.set(id, list);
    }
    (list as T[]).push(value);
  };
  try {
    for (const bench of selected) {
      const iterations =
        bench.type === 'cpu'
          ? options.iterations + (options.extraIterations ? bench.extraIterations : 0)
          : options.memIterations;
      for (let i = 0; i < iterations; i++) {
        for (const label of labels) {
          const url = `http://127.0.0.1:${server.port}/${label}/index.html`;
          const progress = `  ${bench.id.padEnd(24)} ${label.padEnd(14)} ${String(i + 1).padStart(2)}/${iterations}`;
          if (bench.type === 'cpu') {
            const traceDir = join(tracesRoot, label);
            mkdirSync(traceDir, { recursive: true });
            const r = await runCpuIteration(browser, bench, url, join(traceDir, `${bench.id}_${i}.json`));
            collect(label, bench.id, r);
            console.log(`${progress}  total ${fmt(r.total)}  script ${fmt(r.script)}  paint ${fmt(r.paint)}`);
          } else {
            const mb = await runMemIteration(browser, bench, url);
            collect(label, bench.id, mb);
            console.log(`${progress}  memory ${fmt(mb)} MB`);
          }
        }
      }
      for (const label of labels) printMedians(label, bench, samples.get(label)!.get(bench.id)!);
      console.log('');
    }
  } finally {
    await shutdown();
  }

  for (const label of labels) writeResults(label, builds.get(label)!, browserName, samples.get(label)!);

  if (options.interleave) {
    console.log('');
    console.log(renderComparison([loadLabel(options.interleave), loadLabel(options.label)]));
  } else {
    console.log(`Compare against another label with: bun run bench:compare <baseline> ${options.label}`);
  }
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
