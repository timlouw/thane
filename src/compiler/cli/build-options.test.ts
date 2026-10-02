/**
 * Characterisation of the esbuild options runBuild derives from a BuildConfig.
 *
 * The output snapshot covers dev builds without drops and prod builds with both drops.
 * This file pins the other combinations: drops requested in a dev build (ignored), prod builds
 * that keep console / debugger, and entry and chunk file names with and without hashes.
 * It calls runBuild directly (not buildAndReadJs), so the snapshot preload does not record it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from 'esbuild';
import { AnalyzePlugin, runBuild } from './build.js';
import type { BuildConfig } from './types.js';
import {
  PROD_BUILD,
  buildAndReadJs,
  createTempProject,
  createTestBuildConfig,
  readBuiltJs,
  removeTempProject,
  type TempProject,
} from '../testing/build-project.js';

const ENTRY = `
export function report(value: number) {
  console.log('kept-console', value);
  debugger;
  return value * 2;
}
report(1);
import('./lazy').then((m) => m.lazy());
`;

const LAZY = `export const lazy = () => 'lazy-chunk';\n`;

let project: TempProject;

beforeAll(async () => {
  project = await createTempProject(ENTRY, { 'src/lazy.ts': LAZY });
});

afterAll(async () => {
  await removeTempProject(project);
});

const build = async (overrides: Partial<BuildConfig>) => {
  await runBuild(createTestBuildConfig(project, { strictTypeCheck: false, ...overrides }));
  const js = await readBuiltJs(project.outDir);
  const files = (await readdir(project.outDir)).filter((f) => f.endsWith('.js')).sort();
  return {
    js,
    files: files.map((f) => f.replace(/-[A-Z0-9]{8}\.js$/, '-HASH.js')),
    hasConsole: js.includes('kept-console'),
    hasDebugger: /\bdebugger\b/.test(js),
  };
};

describe('runBuild esbuild options', () => {
  test('dev: drops are not applied even when requested, output is not minified', async () => {
    const out = await build({ dropConsole: true, dropDebugger: true });
    expect(out.hasConsole).toBe(true);
    expect(out.hasDebugger).toBe(true);
    expect(out.js).toContain('function report(value) {\n');
  });

  test('dev: without drops', async () => {
    const out = await build({});
    expect(out.hasConsole).toBe(true);
    expect(out.hasDebugger).toBe(true);
  });

  test('prod: both drops', async () => {
    const out = await build(PROD_BUILD);
    expect(out.hasConsole).toBe(false);
    expect(out.hasDebugger).toBe(false);
    expect(out.js).not.toContain('function report(value)');
    expect(out.js).not.toContain('\n  ');
  });

  test('prod: console kept, debugger dropped', async () => {
    const out = await build({ ...PROD_BUILD, dropConsole: false });
    expect(out.hasConsole).toBe(true);
    expect(out.hasDebugger).toBe(false);
  });

  test('prod: debugger kept, console dropped', async () => {
    const out = await build({ ...PROD_BUILD, dropDebugger: false });
    expect(out.hasConsole).toBe(false);
    expect(out.hasDebugger).toBe(true);
  });

  test('prod: no drops', async () => {
    const out = await build({ ...PROD_BUILD, dropConsole: false, dropDebugger: false });
    expect(out.hasConsole).toBe(true);
    expect(out.hasDebugger).toBe(true);
  });

  test('entry and chunk names carry a hash by default', async () => {
    expect((await build({})).files).toEqual(['lazy-HASH.js', 'main-HASH.js']);
    expect((await build(PROD_BUILD)).files).toEqual(['lazy-HASH.js', 'main-HASH.js']);
  });

  test('entry and chunk names without hashes', async () => {
    expect((await build({ hashFileNames: false })).files).toEqual(['lazy.js', 'main.js']);
    expect((await build({ ...PROD_BUILD, hashFileNames: false })).files).toEqual(['lazy.js', 'main.js']);
  });
});

describe('--analyze', () => {
  const metafileOf = async (outDir: string) =>
    JSON.parse(await readFile(join(outDir, 'metafile.json'), 'utf8')) as { outputs: Record<string, unknown> };

  test('thane build writes metafile.json to the output folder', async () => {
    await runBuild(createTestBuildConfig(project, { strictTypeCheck: false, analyze: true }));
    expect(Object.keys((await metafileOf(project.outDir)).outputs).some((file) => file.endsWith('.js'))).toBe(true);
  });

  test('a watch context, as thane dev and thane serve use, writes it after every rebuild', async () => {
    const outdir = join(project.outDir, '..', 'analyze-watch');
    const ctx = await context({
      entryPoints: [project.entryPath],
      bundle: true,
      outdir,
      write: true,
      metafile: true,
      logLevel: 'silent',
      plugins: [AnalyzePlugin(outdir)],
    });
    try {
      await ctx.rebuild();
      expect(Object.keys((await metafileOf(outdir)).outputs).length).toBeGreaterThan(0);
      await rm(join(outdir, 'metafile.json'));
      await ctx.rebuild();
      expect(Object.keys((await metafileOf(outdir)).outputs).length).toBeGreaterThan(0);
    } finally {
      await ctx.dispose();
    }
  });
});

describe('development checks', () => {
  const APP = "import { signal } from 'thane';\nconst a = signal(0);\na.subscribe((v) => console.log(v));\na(1);\n";

  test('a development build keeps the check for signals that keep setting each other; production leaves it out', async () => {
    const message = '[thane] Signals keep setting each other';
    expect(await buildAndReadJs(APP, { config: { strictTypeCheck: false } })).toContain(message);
    expect(await buildAndReadJs(APP, { config: { strictTypeCheck: false, ...PROD_BUILD } })).not.toContain(message);
  });
});

describe('the router guard step', () => {
  const app = (route: string) => `
import { defineComponent, html, mount } from 'thane';
import { defineRoutes } from 'thane/router';
export const Home = defineComponent('home-page', () => ({ template: html\`<p>home</p>\` }));
const Routes = defineRoutes({ '/': { component: Home }, ${route} notFound: { component: Home } });
mount(Routes);
`;
  // dropConsole: false keeps the loop report, which marks the guard step in the bundle
  const PROD_WITH_CONSOLE = { strictTypeCheck: false, ...PROD_BUILD, dropConsole: false };

  test('a production build leaves it out when no route has canEnter or redirectTo, and keeps it otherwise', async () => {
    const mark = 'Redirect loop';
    expect(await buildAndReadJs(app(''), { config: PROD_WITH_CONSOLE })).not.toContain(mark);
    expect(await buildAndReadJs(app("'/old': { redirectTo: '/' },"), { config: PROD_WITH_CONSOLE })).toContain(mark);
    expect(
      await buildAndReadJs(app("'/me': { component: Home, canEnter: () => '/' },"), { config: PROD_WITH_CONSOLE }),
    ).toContain(mark);
    // A development build always keeps it, so a guard added while thane dev runs works at once
    expect(await buildAndReadJs(app(''), { config: { strictTypeCheck: false } })).toContain(mark);
  });
});

describe('the router link handling', () => {
  const app = (markup: string) => `
import { defineComponent, html, mount } from 'thane';
import { defineRoutes } from 'thane/router';
export const Home = defineComponent('home-page', () => ({ template: html\`${markup}\` }));
const Routes = defineRoutes({ '/': { component: Home }, '/about': { component: Home }, notFound: { component: Home } });
mount(Routes);
`;
  const PROD = { strictTypeCheck: false, ...PROD_BUILD };
  const mark = 'a[href]';

  test('a production build keeps it for a plain link to a path, and leaves it out otherwise', async () => {
    expect(await buildAndReadJs(app('<a href="/about">About</a>'), { config: PROD })).toContain(mark);
    expect(await buildAndReadJs(app('<p>no link</p>'), { config: PROD })).not.toContain(mark);
    expect(
      await buildAndReadJs(app('<a href="/about" @click.prevent=${() => 0}>About</a>'), { config: PROD }),
    ).not.toContain(mark);
    expect(await buildAndReadJs(app('<a href="https://example.com">Elsewhere</a>'), { config: PROD })).not.toContain(
      mark,
    );
    // A development build always keeps it
    expect(await buildAndReadJs(app('<p>no link</p>'), { config: { strictTypeCheck: false } })).toContain(mark);
  });
});
