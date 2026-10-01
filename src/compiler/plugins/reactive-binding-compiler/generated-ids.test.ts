/**
 * No id the compiler generates reaches the emitted HTML or the DOM. Compiled code reaches every
 * node it binds by path, so no template carries a generated id (`id="b3"`), a placeholder element
 * (`<template id="b3">`), an id in a comment (`<!--b3-->`, `<!--i3-->`, `<!--b3.-->`) or a
 * compile-time mark (`data-thane-ref`). Every e2e app is built here in development and production and
 * its output scanned; lookup-shapes.test.ts scans its template shapes the same way, and the DOM is
 * scanned in a browser by e2e/tests/hardening.spec.ts.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runBuild } from '../../cli/build.js';
import { createTestBuildConfig, readBuiltJs, PROD_BUILD } from '../../testing/build-project.js';

/** What a generated id looks like in emitted output. */
const GENERATED_ID = /\bid="[bi]\d+"|<template id=|<!--[bi]\d|data-thane-ref/g;

const repo = resolve(import.meta.dir, '../../../..');
const apps = ['contract', 'router', 'cart', 'hardening', 'browser-error'];

describe('no generated id in any emitted template', () => {
  for (const app of apps) {
    for (const mode of ['development', 'production'] as const) {
      test(`e2e ${app} app (${mode})`, async () => {
        const root = await mkdtemp(join(process.cwd(), '.tmp-thane-ids-'));
        try {
          const outDir = join(root, 'dist');
          await runBuild(
            createTestBuildConfig(
              {
                root: join(repo, 'e2e', `${app}-app`),
                srcDir: join(repo, 'e2e', `${app}-app`),
                outDir,
                htmlPath: join(repo, 'e2e', `${app}-app`, 'index.html'),
                entryPath: join(repo, 'e2e', `${app}-app`, 'main.ts'),
              },
              mode === 'production' ? PROD_BUILD : { strictTypeCheck: false },
            ),
          );
          const js = await readBuiltJs(outDir);
          // the app's templates were compiled (the template helper is there) and none holds an id
          expect(js).toContain('createElement("template")');
          expect(js.match(GENERATED_ID) ?? []).toEqual([]);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }, 60_000);
    }
  }
});
