/**
 * Characterisation of the type sync inside a real build: a build of a project with a
 * route table writes the hidden route types and logs the types-sync line once, `thane typecheck`
 * (runProjectTypeCheck) does not log that line, and a sync that cannot write its files fails the build.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBuild } from '../../cli/build.js';
import {
  createTempProject,
  createTestBuildConfig,
  removeTempProject,
  type TempProject,
} from '../../testing/build-project.js';
import { runProjectTypeCheck } from './tsc-type-checker.js';

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    lib: ['ESNext', 'DOM'],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['./src/**/*.ts', './.thane/types/**/*.d.ts'],
});

const ROUTED_APP = [
  "import { defineComponent, html, mount } from 'thane';",
  "import { defineRoutes } from 'thane/router';",
  '',
  "export const Home = defineComponent('home-page', () => ({ template: html`<p>home</p>` }));",
  '',
  'const Routes = defineRoutes({',
  "  '/': { component: Home },",
  '  notFound: { component: Home },',
  '});',
  '',
  'mount(Routes);',
  '',
].join('\n');

const SYNC_LINE = '[types-sync] Generated hidden type file(s) for 1 route table(s)';

const plain = (value: unknown): string => String(value).replace(/\x1b\[[0-9;]*m/g, '');

/** Run `fn` with console.log captured; returns how it settled and the logged lines. */
const captureLog = async (fn: () => Promise<void>) => {
  const log: string[] = [];
  const saved = { log: console.log, info: console.info, error: console.error, warn: console.warn };
  console.log = (...a: unknown[]) => log.push(a.map(plain).join(' '));
  console.info = () => {};
  console.error = () => {};
  console.warn = () => {};
  let outcome = 'resolved';
  try {
    await fn();
  } catch (error) {
    outcome = `rejected: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    Object.assign(console, saved);
  }
  return { outcome, log };
};

let project: TempProject | null = null;

const routedProject = async (): Promise<TempProject> => {
  project = await createTempProject(ROUTED_APP, { 'tsconfig.json': TSCONFIG });
  return project;
};

afterEach(async () => {
  if (project) await removeTempProject(project);
  project = null;
});

describe('type sync in a build', () => {
  test('a build with a route table writes the route types and logs the sync line once', async () => {
    const p = await routedProject();
    const r = await captureLog(() => runBuild(createTestBuildConfig(p)));
    expect(r.outcome).toBe('resolved');
    expect(r.log.filter((line) => line === SYNC_LINE)).toHaveLength(1);
    // One sync, in the type checker's onStart: its line always comes before the check starts
    expect(r.log.indexOf(SYNC_LINE)).toBeLessThan(r.log.indexOf('[type-check] Running TypeScript type check...'));
    expect(existsSync(join(p.root, '.thane', 'types', 'router', 'src', 'main.generated.d.ts'))).toBe(true);
    expect(existsSync(join(p.root, '.thane', 'types', 'client.d.ts'))).toBe(true);
  }, 60000);

  test('thane typecheck (runProjectTypeCheck) syncs without logging the sync line', async () => {
    const p = await routedProject();
    const r = await captureLog(() => runProjectTypeCheck({ strict: true, projectRoot: p.root }));
    expect(r.outcome).toBe('resolved');
    expect(r.log).toEqual(['[type-check] Running TypeScript type check...']);
    expect(existsSync(join(p.root, '.thane', 'types', 'router', 'src', 'main.generated.d.ts'))).toBe(true);
  }, 60000);

  test('a sync that cannot write its files fails the build', async () => {
    const p = await routedProject();
    // A directory where the sync writes the client types file: the write throws
    mkdirSync(join(p.root, '.thane', 'types', 'client.d.ts'), { recursive: true });
    writeFileSync(join(p.root, '.thane', 'types', 'client.d.ts', 'keep'), '');
    const r = await captureLog(() => runBuild(createTestBuildConfig(p)));
    expect(r.outcome).toStartWith('rejected: Build failed');
    expect(r.outcome).toContain('EISDIR');
  }, 60000);
});
