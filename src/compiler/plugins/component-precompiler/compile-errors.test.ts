/**
 * How a component the compiler cannot process is reported: the build fails
 * with the compiler's message, and the logger prints the diagnostic. There used to be a fallback
 * plugin that compiled the file a second time, so the diagnostic was printed twice and the esbuild
 * error carried the label `[plugin: reactive-binding]`.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { runBuild } from '../../cli/build.js';
import {
  createTempProject,
  createTestBuildConfig,
  removeTempProject,
  type TempProject,
} from '../../testing/build-project.js';

const plain = (value: unknown): string => String(value).replace(/\x1b\[[0-9;]*m/g, '');

let project: TempProject | null = null;

afterEach(async () => {
  if (project) await removeTempProject(project);
  project = null;
});

/** Build `source` as src/main.ts; returns the rejection message and every console.error line. */
const buildFailing = async (source: string) => {
  project = await createTempProject(source);
  const errors: string[] = [];
  const saved = { log: console.log, info: console.info, error: console.error, warn: console.warn };
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = (...a: unknown[]) => errors.push(a.map(plain).join(' '));
  let outcome = 'resolved';
  try {
    await runBuild(createTestBuildConfig(project, { strictTypeCheck: false }));
  } catch (error) {
    outcome = error instanceof Error ? error.message : String(error);
  } finally {
    Object.assign(console, saved);
  }
  return { outcome, errors };
};

const COLON_ATTRIBUTE = [
  "import { defineComponent, mount } from 'thane';",
  "export const App = defineComponent('colon-attr', () => ({ template: html`<img :src=${'a.png'}>` }));",
  "mount(App, { target: document.getElementById('app')! });",
  '',
].join('\n');

describe('a component the compiler cannot process', () => {
  test('fails the build with the compiler message, printed once, labelled with the precompiler', async () => {
    const r = await buildFailing(COLON_ATTRIBUTE);
    expect(r.outcome).toStartWith('Build failed: Build failed with 1 error:');
    expect(r.outcome).toContain('[plugin: component-compiler] Error processing ');
    expect(r.outcome).toContain('THANE006: attribute ":src"');
    expect(r.errors.filter((line) => line.includes('THANE006'))).toHaveLength(1);
  }, 60000);
});
