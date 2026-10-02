/// <reference types="node" />

import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The app is copied into the ignored build folder, so that the test can change its files
const source = resolve(repoRoot, 'e2e', 'hot-app');
const app = resolve(repoRoot, 'e2e', '.build', 'hot-src');
// E2E_PORT_BASE + 146, next to the browser-error dev server (playwright.config.ts)
const port = (process.env.E2E_PORT_BASE ? Number(process.env.E2E_PORT_BASE) : 4173) + 146;

const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
};

/** Change a file of the copied app, as an editor saves it */
const change = (file: string, from: string, to: string): void => {
  const path = resolve(app, file);
  const text = readFileSync(path, 'utf8');
  if (!text.includes(from)) throw new Error(`${file} does not contain ${from}`);
  writeFileSync(path, text.replace(from, to));
};

const marker = (page: Page) => page.evaluate(() => (window as unknown as { __hotMarker?: string }).__hotMarker);

test.describe('hot updates', () => {
  test('a changed component, store or stylesheet is swapped in the open page with its state; the entry reloads it', async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== 'chromium', 'The dev server is covered once, in chromium.');
    rmSync(app, { recursive: true, force: true });
    cpSync(source, app, { recursive: true });

    const child = spawn(
      'bun',
      [
        './dist/compiler/cli/thane.js',
        'dev',
        '--entry',
        './e2e/.build/hot-src/main.ts',
        '--html',
        './e2e/.build/hot-src/index.html',
        '--out',
        './e2e/.build/hot',
        '--port',
        String(port),
      ],
      { cwd: repoRoot, stdio: 'pipe' },
    );
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (output += chunk));
    child.stderr.on('data', (chunk: string) => (output += chunk));

    try {
      await waitFor(() => output.includes(`Server running at http://localhost:${port}/`), 30_000);
      await page.goto(`http://localhost:${port}/`);
      const label = page.locator('.hot-label-text');
      await expect(label).toHaveText('v1 1');
      await expect(label).toHaveCSS('color', 'rgb(0, 0, 255)');

      // State the swap must keep: a value on the page, a signal the app's store holds, the label's own signal
      // and its file's, and the app's own signal
      await page.evaluate(() => ((window as unknown as { __hotMarker: string }).__hotMarker = 'kept'));
      await page.locator('.hot-click').click();
      await page.locator('.hot-click').click();
      await expect(page.locator('.hot-clicks')).toHaveText('2');
      for (let i = 0; i < 3; i++) await page.locator('.hot-tap').click();
      await page.locator('.hot-open').click();
      const state = async (taps: string, total: string, opened: string, clicks = '2'): Promise<void> => {
        await expect(page.locator('.hot-taps')).toHaveText(taps);
        await expect(page.locator('.hot-total')).toHaveText(total);
        await expect(page.locator('.hot-opened')).toHaveText(opened);
        await expect(page.locator('.hot-clicks')).toHaveText(clicks);
      };
      await state('3', '3', '1');

      // The component's file changes: its instance is mounted again with the new code and styles, from its state
      change('label.ts', 'v1 ${props.n}', 'v2 ${props.n}');
      await expect(label).toHaveText('v2 1', { timeout: 15_000 });
      await state('3', '3', '1');
      change('label.ts', 'rgb(0, 0, 255)', 'rgb(255, 0, 0)');
      await expect(label).toHaveCSS('color', 'rgb(255, 0, 0)', { timeout: 15_000 });
      expect(await marker(page)).toBe('kept');
      await state('3', '3', '1');
      await page.locator('.hot-tap').click();
      await state('4', '4', '1');
      expect(output).toContain('Updated .build/hot-src/label.ts');

      // The parent's file changes: it is mounted again from its state, and the label it mounts from the label's
      change('app.ts', '>a1<', '>a2<');
      await expect(page.locator('.hot-title')).toHaveText('a2', { timeout: 15_000 });
      await state('4', '4', '1');
      await expect(label).toHaveText('v2 1');
      expect(await marker(page)).toBe('kept');
      await page.locator('.hot-click').click();
      await expect(page.locator('.hot-clicks')).toHaveText('3');

      // The store changes: it runs again, keeping its signals' values, and so does the component file that
      // imports it, which reads the new step
      change('store.ts', 'step = 1', 'step = 5');
      await expect
        .poll(() => output, { timeout: 15_000 })
        .toContain('Updated .build/hot-src/store.ts, .build/hot-src/app.ts');
      await state('4', '4', '1', '3');
      await page.locator('.hot-click').click();
      await state('4', '4', '1', '8');
      expect(await marker(page)).toBe('kept');

      // The app's stylesheet file changes: the app's sheet is replaced, and the app keeps its state
      await expect(page.locator('.hot-title')).toHaveCSS('color', 'rgb(0, 128, 0)');
      change('app.css', 'rgb(0, 128, 0)', 'rgb(128, 0, 128)');
      await expect(page.locator('.hot-title')).toHaveCSS('color', 'rgb(128, 0, 128)', { timeout: 15_000 });
      await state('4', '4', '1', '8');
      expect(await marker(page)).toBe('kept');

      // The entry changes: the page reloads, and starts from the new code
      change('main.ts', "'hot 1'", "'hot 2'");
      await expect(page).toHaveTitle('hot 2', { timeout: 15_000 });
      expect(await marker(page)).toBeUndefined();
      await expect(label).toHaveText('v2 1');
      await state('0', '0', '0', '0');
      await expect(page.locator('.hot-title')).toHaveText('a2');
    } finally {
      await stopChild(child);
      rmSync(app, { recursive: true, force: true });
    }
  });
});

const stopChild = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.killed || child.exitCode !== null) return;
  await new Promise<void>((resolvePromise) => {
    child.once('exit', () => resolvePromise());
    child.kill();
  });
};
