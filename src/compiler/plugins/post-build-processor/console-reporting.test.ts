/**
 * Characterisation of the size report printed after a build.
 *
 * A real build runs with console.info captured. Every line of the report is checked against the
 * sizes of the files on disk: per-file raw size, colour band, gzip and brotli sizes, and the
 * totals. The colours come from `ansi` (empty without colour), so the expected text
 * follows the colour decision of this process; the CLI runs below pin both modes.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runBuild } from '../../cli/build.js';
import { createTempProject, createTestBuildConfig, removeTempProject } from '../../testing/build-project.js';
import { ansi, consoleColors } from '../../utils/index.js';

const APP = `
import { defineComponent, html, mount } from 'thane';

export const App = defineComponent('test-app', () => ({
  template: html\`<div>size report</div>\`,
}));
mount(App);
`;

const sizeColor = (size: number, max: number): string => {
  const ratio = size / max;
  if (ratio < 0.33) return ansi.green;
  if (ratio < 0.66) return ansi.yellow;
  if (ratio < 0.85) return ansi.orange;
  return ansi.red;
};

const kb = (bytes: number): string => (bytes / 1024).toFixed(2);

/** Build with console.info captured; returns every call's arguments and the output folder's files. */
const buildAndCapture = async (useGzip: boolean) => {
  const project = await createTempProject(APP);
  const calls: unknown[][] = [];
  const info = console.info;
  console.info = (...args: unknown[]) => calls.push(args);
  try {
    await runBuild(createTestBuildConfig(project, { useGzip, strictTypeCheck: false }));
  } finally {
    console.info = info;
  }
  const size = (name: string): number | undefined => {
    const file = join(project.outDir, name);
    return existsSync(file) ? statSync(file).size : undefined;
  };
  const files = readdirSync(project.outDir);
  return { project, calls, size, files };
};

const expectReport = async (useGzip: boolean) => {
  const { project, calls, size, files } = await buildAndCapture(useGzip);
  try {
    const { reset } = ansi;
    const fileLines = calls.filter((args) => args.length === 1 && / {2}(\x1b\[[\d;]+m)?Size: /.test(String(args[0])));
    const names = fileLines.map((args) => String(args[0]).slice(ansi.cyan.length).split(`${reset}  `)[0] ?? '');

    // One line per emitted file (the compressed copies are not listed)
    expect([...names].sort()).toEqual(files.filter((f) => !f.endsWith('.gz') && !f.endsWith('.br')).sort());
    expect(names).toContain('index.html');
    expect(names.some((n) => n.endsWith('.js.map'))).toBe(true);

    const raw = names.map((n) => size(n) ?? 0);
    const max = Math.max(...raw);
    const expectedLines = names.map((name, i) => {
      let line = `${ansi.cyan}${name}${reset}  ${sizeColor(raw[i]!, max)}Size: ${kb(raw[i]!)} KB${reset}`;
      const gz = size(name + '.gz');
      const br = size(name + '.br');
      if (useGzip && gz !== undefined) {
        line += ` ${ansi.green}(gzip: ${kb(gz)} KB` + (br !== undefined ? `, br: ${kb(br)} KB)` : ')') + reset;
      }
      return [line];
    });
    expect(fileLines).toEqual(expectedLines);

    // The totals follow the last file line
    const total = raw.reduce((a, b) => a + b, 0);
    const totals: unknown[][] = [
      [consoleColors.green, `=== TOTAL BUNDLE SIZE: ${total.toFixed(2)} B (${kb(total)} KB) ===`],
    ];
    if (useGzip) {
      const gzTotal = names.reduce((sum, n) => sum + (size(n + '.gz') ?? 0), 0);
      const brTotal = names.reduce((sum, n) => sum + (size(n + '.br') ?? 0), 0);
      // The source map is not compressed, so it has no gzip part and adds nothing to the totals
      expect(size(names.find((n) => n.endsWith('.js.map'))! + '.gz')).toBeUndefined();
      expect(gzTotal).toBeGreaterThan(0);
      totals.push(
        [consoleColors.green, `=== TOTAL GZIPPED: ${gzTotal.toFixed(2)} B (${kb(gzTotal)} KB) ===`],
        [consoleColors.green, `=== TOTAL BROTLI: ${brTotal.toFixed(2)} B (${kb(brTotal)} KB) ===`],
      );
    }
    totals.push(['']);
    const start = calls.indexOf(fileLines[fileLines.length - 1]!) + 1;
    expect(calls.slice(start, start + totals.length)).toEqual(totals);
  } finally {
    await removeTempProject(project);
  }
};

describe('Size report', () => {
  test('without compression: one line per file and the total', async () => {
    await expectReport(false);
  });

  test('with useGzip: gzip and brotli sizes per file and in total', async () => {
    await expectReport(true);
  });
});

describe('the CLI output follows NO_COLOR and never prints %s', () => {
  const CLI = join(import.meta.dir, '..', '..', 'cli', 'thane.ts');

  /** `thane build --gzip` in a fresh project with the given colour variables; its whole output. */
  const cliBuild = async (colour: Record<string, string>): Promise<string> => {
    const project = await createTempProject(APP, { 'tsconfig.json': '{ "compilerOptions": { "strict": true } }' });
    try {
      const env: Record<string, string | undefined> = { ...process.env, ...colour };
      if (!('FORCE_COLOR' in colour)) delete env['FORCE_COLOR'];
      const run = Bun.spawnSync([process.execPath, CLI, 'build', '--gzip'], { cwd: project.root, env });
      expect(run.exitCode).toBe(0);
      return run.stdout.toString() + run.stderr.toString();
    } finally {
      await removeTempProject(project);
    }
  };

  test('NO_COLOR=1: no escape codes and no %s', async () => {
    const out = await cliBuild({ NO_COLOR: '1' });
    expect(out).toMatch(/\nindex\.html {2}Size: [\d.]+ KB \(gzip: [\d.]+ KB, br: [\d.]+ KB\)\n/);
    expect(out).not.toContain('\x1b[');
    expect(out).not.toContain('%s');
  }, 60000);

  test('FORCE_COLOR=1: the same lines in colour, and no %s', async () => {
    const out = await cliBuild({ FORCE_COLOR: '1' });
    expect(out).toMatch(/\x1b\[36mindex\.html\x1b\[0m {2}\x1b\[[\d;]+mSize: [\d.]+ KB\x1b\[0m \x1b\[32m\(gzip: /);
    expect(out).not.toContain('%s');
  }, 60000);
});
