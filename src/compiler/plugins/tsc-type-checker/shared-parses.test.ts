/**
 * The type check and the build parse each project source once: the type check's parse of a source as written
 * is the one the build then reads (sourceCache), and a check run again (each `thane dev` rebuild) reuses every
 * parse of a file that has not changed, the rewritten component files' too. A changed file is parsed again,
 * and its errors are reported where they are in the source as written.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProjectTypeCheck } from './tsc-type-checker.js';
import { logger, sourceCache } from '../../utils/index.js';

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true },
  include: ['./src/**/*.ts'],
});

let root = '';
let store = '';
let card = '';
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'thane-shared-parses-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'tsconfig.json'), TSCONFIG);
  store = join(root, 'src', 'store.ts');
  card = join(root, 'src', 'card.ts');
  writeFileSync(store, 'export const count = (n: number): number => n + 1;\n');
  // A component file: its templates are typed, so the check reads it rewritten
  writeFileSync(
    card,
    [
      "import { count } from './store.js';",
      'declare const html: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;',
      'export const view = html`<p>${count(1)}</p>`;',
      '',
    ].join('\n'),
  );
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The type check's errors, as their lines read */
const check = async (): Promise<string[]> => {
  const errors: string[] = [];
  const saved = { error: console.error, warn: logger.warn, info: logger.info };
  console.error = (...args: unknown[]) => errors.push(args.join(' ').replace(/\x1b\[[0-9;]*m/g, ''));
  logger.warn = () => {};
  logger.info = () => {};
  try {
    await runProjectTypeCheck({ strict: false, projectRoot: root });
  } finally {
    Object.assign(console, { error: saved.error });
    Object.assign(logger, { warn: saved.warn, info: saved.info });
  }
  return errors;
};
const parseOf = async (file: string) => (await sourceCache.get(file))!.sourceFile;

describe("the type check's parses", () => {
  test('are the ones the build reads, and a check run again keeps them while the files are unchanged', async () => {
    expect(await check()).toEqual([]);
    const [storeParse, cardParse] = [await parseOf(store), await parseOf(card)];
    // The type check parsed them with the project's target, which the build's own parse never does
    expect(storeParse.languageVersion).toBe(9); // ES2022
    expect(cardParse.languageVersion).toBe(9);
    expect(await check()).toEqual([]);
    expect(await parseOf(store)).toBe(storeParse);
    expect(await parseOf(card)).toBe(cardParse);
  });

  test('a changed file is parsed again, and its error is reported in the source as written', async () => {
    const before = await parseOf(card);
    writeFileSync(
      card,
      [
        "import { count } from './store.js';",
        'declare const html: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;',
        "export const view = html`<p>${count('one')}</p>`;",
        '',
      ].join('\n'),
    );
    // A later modification time, even where the file system's clock is coarse
    const later = new Date(Date.now() + 5000);
    utimesSync(card, later, later);
    const errors = (await check()).join('\n');
    // At 'one' in the line as written, which the error's excerpt shows as written too
    expect(errors).toContain('card.ts:3:37');
    expect(errors).toContain("3 export const view = html`<p>${count('one')}</p>`;");
    expect(errors).toContain("Argument of type 'string' is not assignable to parameter of type 'number'.");
    expect(await parseOf(card)).not.toBe(before);
    // The unchanged file keeps its parse
    expect((await parseOf(store)).text).toBe('export const count = (n: number): number => n + 1;\n');
  });
});
