/// <reference types="node" />

import { expect, test } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appRoot = resolve(repoRoot, 'e2e', 'browser-error-app');
const port = 4318;

const waitFor = async (predicate: () => boolean, timeoutMs: number, intervalMs: number = 100): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
};

test.describe('browser error relay', () => {
  test('dev server forwards browser runtime errors to terminal output', async ({ browserName, page }) => {
    test.skip(browserName !== 'chromium', 'Terminal output assertion is covered once in chromium.');

    const child = spawn(
      'bun',
      [
        './dist/compiler/cli/thane.js',
        'dev',
        '--entry',
        './e2e/browser-error-app/main.ts',
        '--out',
        './dist/e2e-browser-error',
        '--html',
        './e2e/browser-error-app/index.html',
        '--port',
        String(port),
      ],
      {
        cwd: repoRoot,
        stdio: 'pipe',
      },
    );

    let output = '';
    const appendOutput = (chunk: string) => {
      output += chunk;
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);

    try {
      await waitFor(() => output.includes(`Server running at http://localhost:${port}/`), 30_000);
      await page.goto(`http://localhost:${port}/`);
      await expect(page.getByTestId('browser-error-app')).toBeVisible();

      await waitFor(
        () => output.includes('[THANE_BROWSER_ERROR] Uncaught ReferenceError: thane e2e browser relay test error'),
        10_000,
      );

      expect(output).toContain('[THANE_BROWSER_ERROR] Uncaught ReferenceError: thane e2e browser relay test error');
      const sourceMatch = output.match(/source (main-[A-Z0-9]+\.js:\d+:\d+)/u);
      expect(sourceMatch?.[1]).toBeTruthy();
      expect(output).not.toContain(`stack at ${sourceMatch?.[1]}`);
    } finally {
      await stopChild(child);
    }
  });
});

const stopChild = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  child.kill('SIGINT');

  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolvePromise();
    }, 5_000);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
};
