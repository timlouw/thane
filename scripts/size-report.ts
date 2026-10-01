/**
 * Runtime and app size report.
 *
 *   bun run size [--json <file>] [--compare <file>] [--no-build]
 *
 * Three sections, raw size and gzip (level 9):
 *  - dist/runtime: the tsc output per file, unminified (needs `bun run build`, which runs first
 *    unless --no-build is given). Raw is the length in characters here, as in earlier reports
 *    (the files hold some non-ASCII comment characters); elsewhere it is bytes;
 *  - bundles: esbuild bundles of src/runtime feature sets (ESM, es2022, minified, tree-shaken),
 *    that is, what an app that imports that set pays, built as production builds them (`__THANE_DEV__`
 *    false: no development checks). The router rows define `__THANE_HEAD__`, `__THANE_GUARDS__` and
 *    `__THANE_LINKS__` as a production build would: false for an app whose routes set nothing but titles,
 *    have no guards or redirects, and whose templates have no plain link; true for each feature's own row;
 *  - apps: `thane build --prod` of the apps in the snapshot set (total of the emitted .js files).
 *    example-apps/benchmark is left out: it is the same source as bench/app, built from a tarball.
 *    Minified names can differ between two checkouts of the same commit, which moves gzip by a few
 *    bytes: compare app rows only between reports taken in the same checkout.
 *
 * --json <file> writes the table as JSON; --compare <file> adds the change against such a file
 * and marks every row that grew.
 *
 * Gzip sizes depend on the zlib inside the Bun binary (Bun 1.3.4 and 1.4.2 differ by about 3%
 * on the same bytes), so the report records the Bun version and --compare warns when it differs.
 * Compare only reports taken with the same Bun.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { apps, buildApp, buildFramework, repoRoot } from './snapshot/apps.ts';

export interface SizeRow {
  section: 'dist' | 'bundles' | 'apps';
  name: string;
  raw: number;
  gzip: number;
}

export interface SizeReport {
  commit: string;
  dirty: boolean;
  generatedAt: string;
  /** Bun version that computed the gzip sizes. */
  bun: string;
  rows: SizeRow[];
}

const SECTION_TITLES: Record<SizeRow['section'], string> = {
  dist: 'dist/runtime (tsc output, unminified)',
  bundles: 'esbuild minified bundles (esm, es2022, tree-shaken)',
  apps: 'built apps, prod (total .js)',
};

// Feature sets an app can import, with the build constants a production build would define for them.
// Paths are relative to the repository root.
const FEATURE_SETS: Record<string, string | { contents: string; define: Record<string, string> }> = {
  'all of thane (every export kept)': `export * from './src/runtime/index.ts';`,
  'all of thane/runtime (compiler helpers)': `export * from './src/runtime/internal.ts';`,
  'all of thane/router': `export * from './src/runtime/router-exports.ts';`,
  'signal only': `import { signal } from './src/runtime/index.ts'; export const s = signal(1);`,
  'signal+computed+effect+batch': `import { signal, computed, effect, batch } from './src/runtime/index.ts'; export const x = [signal, computed, effect, batch];`,
  'lean component + mount (min app)': `import { mountComponent } from './src/runtime/internal.ts'; import { __registerComponentLean } from './src/runtime/internal.ts'; export const x = [mountComponent, __registerComponentLean];`,
  'full component + styles + dc': `import { mountComponent } from './src/runtime/internal.ts'; import { __registerComponent, __enableComponentStyles, __dc } from './src/runtime/internal.ts'; export const x = [mountComponent, __registerComponent, __enableComponentStyles, __dc];`,
  'styles with keyframes': `import { mountComponent } from './src/runtime/internal.ts'; import { __registerComponent, __enableKeyframeScoping, __dc } from './src/runtime/internal.ts'; export const x = [mountComponent, __registerComponent, __enableKeyframeScoping, __dc];`,
  'when/whenElse + keyed reconciler': `import { __bindIf, __bindIfExpr, createKeyedReconciler } from './src/runtime/internal.ts'; export const x = [__bindIf, __bindIfExpr, createKeyedReconciler];`,
  'router (defineRoutes+navigate+mount)': {
    contents: `import { mount } from './src/runtime/index.ts'; import { defineRoutes, navigate } from './src/runtime/router.ts'; export const x = [mount, defineRoutes, navigate];`,
    define: { __THANE_HEAD__: 'false', __THANE_GUARDS__: 'false', __THANE_LINKS__: 'false', __THANE_SEARCH__: 'false' },
  },
  'router with guards and redirects': {
    contents: `import { mount } from './src/runtime/index.ts'; import { defineRoutes, navigate } from './src/runtime/router.ts'; export const x = [mount, defineRoutes, navigate];`,
    define: { __THANE_HEAD__: 'false', __THANE_GUARDS__: 'true', __THANE_LINKS__: 'false', __THANE_SEARCH__: 'false' },
  },
  'router with link handling': {
    contents: `import { mount } from './src/runtime/index.ts'; import { defineRoutes, navigate } from './src/runtime/router.ts'; export const x = [mount, defineRoutes, navigate];`,
    define: { __THANE_HEAD__: 'false', __THANE_GUARDS__: 'false', __THANE_LINKS__: 'true', __THANE_SEARCH__: 'false' },
  },
  'router with typed search': {
    contents: `import { mount } from './src/runtime/index.ts'; import { defineRoutes, navigate } from './src/runtime/router.ts'; import { searchNumber } from './src/runtime/router-search.ts'; export const x = [mount, defineRoutes, navigate, searchNumber];`,
    define: { __THANE_HEAD__: 'false', __THANE_GUARDS__: 'false', __THANE_LINKS__: 'false', __THANE_SEARCH__: 'true' },
  },
  'router with route heads (+setMeta, metaName)': {
    contents: `import { mount } from './src/runtime/index.ts'; import { defineRoutes, navigate, setMeta } from './src/runtime/router.ts'; import { metaName } from './src/runtime/router-head.ts'; export const x = [mount, defineRoutes, navigate, setMeta, metaName];`,
    define: { __THANE_HEAD__: 'true', __THANE_GUARDS__: 'false', __THANE_LINKS__: 'false', __THANE_SEARCH__: 'false' },
  },
};

const gz = (b: Uint8Array) => gzipSync(b, { level: 9 }).length;

const git = (args: string[]) => {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};

/** Measures every row. Builds the framework first unless `runBuild` is false. */
export async function measureSizes(runBuild = true): Promise<SizeReport> {
  if (runBuild) buildFramework();
  const rows: SizeRow[] = [];

  const distDir = join(repoRoot, 'dist/runtime');
  for (const f of readdirSync(distDir)
    .filter((f) => f.endsWith('.js'))
    .sort()) {
    const b = readFileSync(join(distDir, f));
    rows.push({ section: 'dist', name: f, raw: b.toString('utf8').length, gzip: gz(b) });
  }

  for (const [name, set] of Object.entries(FEATURE_SETS)) {
    const { contents, define } = typeof set === 'string' ? { contents: set, define: {} } : set;
    const r = await build({
      stdin: { contents, resolveDir: repoRoot, loader: 'ts', sourcefile: 'size-entry.ts' },
      // as a production build: no development checks
      define: { __THANE_DEV__: 'false', ...define },
      bundle: true,
      minify: true,
      format: 'esm',
      target: 'es2022',
      write: false,
      treeShaking: true,
      logLevel: 'silent',
    });
    const b = r.outputFiles[0]!.contents;
    rows.push({ section: 'bundles', name, raw: b.length, gzip: gz(b) });
  }

  const tmp = join(repoRoot, '.tmp-size-apps');
  try {
    for (const app of apps.filter((a) => a.name !== 'example-benchmark')) {
      const out = join(tmp, app.name);
      const r = await buildApp(app, 'prod', out);
      if (r.exitCode !== 0) throw new Error(`thane build --prod of ${app.name} failed:\n${r.stderr}`);
      let raw = 0;
      let gzip = 0;
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (p.endsWith('.js')) {
            const b = readFileSync(p);
            raw += b.length;
            gzip += gz(b);
          }
        }
      };
      walk(out);
      rows.push({ section: 'apps', name: app.name, raw, gzip });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  return {
    commit: git(['rev-parse', '--short', 'HEAD']) || 'unknown',
    dirty: git(['status', '--porcelain']).length > 0,
    generatedAt: new Date().toISOString(),
    bun: Bun.version,
    rows,
  };
}

const num = (n: number, w: number) => String(n).padStart(w);
const delta = (n: number, w: number) => (n === 0 ? '0' : n > 0 ? `+${n}` : String(n)).padStart(w);

/** The report as text; with `base`, adds the change per row and marks growth. */
export function renderSizes(report: SizeReport, base?: SizeReport): string {
  const lines: string[] = [
    `size report: commit ${report.commit}${report.dirty ? ' (uncommitted changes)' : ''}, gzip by Bun ${report.bun}`,
  ];
  if (base) {
    lines.push(`compared with: commit ${base.commit}${base.dirty ? ' (uncommitted changes)' : ''}, Bun ${base.bun}`);
    if (base.bun !== report.bun) {
      lines.push(
        `⚠ gzip sizes come from different Bun versions (${base.bun} vs ${report.bun}): gzip deltas are not reliable`,
      );
    }
  }
  let grew = 0;
  for (const section of Object.keys(SECTION_TITLES) as SizeRow['section'][]) {
    lines.push('', `## ${SECTION_TITLES[section]}`);
    for (const row of report.rows.filter((r) => r.section === section)) {
      let line = `${row.name.padEnd(46)} raw ${num(row.raw, 6)}  gzip ${num(row.gzip, 5)}`;
      if (base) {
        const before = base.rows.find((r) => r.section === section && r.name === row.name);
        if (before) {
          const up = row.raw > before.raw || row.gzip > before.gzip;
          if (up) grew++;
          line += `   Δraw ${delta(row.raw - before.raw, 6)}  Δgzip ${delta(row.gzip - before.gzip, 5)}${up ? '  GREW' : ''}`;
        } else {
          line += '   (new row)';
        }
      }
      lines.push(line);
    }
  }
  if (base) {
    for (const r of base.rows.filter((b) => !report.rows.some((x) => x.section === b.section && x.name === b.name))) {
      lines.push(`(row gone: ${r.section} / ${r.name})`);
    }
    lines.push('', grew === 0 ? 'no row grew' : `${grew} row(s) grew`);
  }
  return lines.join('\n');
}

if (import.meta.main) {
  let jsonPath: string | undefined;
  let comparePath: string | undefined;
  let runBuild = true;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') jsonPath = argv[++i];
    else if (arg === '--compare') comparePath = argv[++i];
    else if (arg === '--no-build') runBuild = false;
    else {
      console.error(`Unknown option ${arg}\nUsage: bun run size [--json <file>] [--compare <file>] [--no-build]`);
      process.exit(1);
    }
  }
  const base = comparePath ? (JSON.parse(readFileSync(resolve(comparePath), 'utf8')) as SizeReport) : undefined;
  const report = await measureSizes(runBuild);
  console.log(renderSizes(report, base));
  if (jsonPath) {
    const file = resolve(jsonPath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    console.log(`\nwritten to ${file}`);
  }
}
