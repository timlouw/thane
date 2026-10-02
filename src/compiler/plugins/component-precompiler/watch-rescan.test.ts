/**
 * Watch mode (`thane dev`) finds a component file added after the build started: each rebuild scans
 * again, so a child component call to the new component is compiled as one.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { context } from 'esbuild';
import { createBuildContext } from '../../utils/file-utils.js';
import { ComponentPrecompilerPlugin } from './component-precompiler.js';

let root = '';
const originalCwd = process.cwd();

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'thane-watch-rescan-')));
  mkdirSync(join(root, 'src'));
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(root, { recursive: true, force: true });
});

const app = (body: string, imports = ''): string =>
  `import { defineComponent, html, mount } from 'thane';\n${imports}\nexport const App = defineComponent('x-app', () => ({ template: html\`<div>${body}</div>\` }));\nmount(App);\n`;

test('a rebuild compiles a call to a component whose file was added after the first build', async () => {
  writeFileSync(join(root, 'src', 'main.ts'), app('<p>no card yet</p>'));
  process.chdir(root);
  try {
    const buildContext = await createBuildContext(root);
    const ctx = await context({
      entryPoints: [join(root, 'src', 'main.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      external: ['thane', 'thane/*'],
      logLevel: 'silent',
      plugins: [ComponentPrecompilerPlugin(buildContext)],
    });
    try {
      const first = await ctx.rebuild();
      expect(first.outputFiles![0]!.text).toContain('no card yet');

      writeFileSync(
        join(root, 'src', 'card.ts'),
        "import { defineComponent, html } from 'thane';\nexport const Card = defineComponent('x-card', () => ({ template: html`<p>card</p>` }));\n",
      );
      writeFileSync(join(root, 'src', 'main.ts'), app('${Card({})}', "import { Card } from './card.js';"));
      const second = (await ctx.rebuild()).outputFiles![0]!.text;

      expect(second).toContain('<x-card></x-card>');
      expect(second).toContain('Card.__f(');
      expect(buildContext.componentsBySelector.has('x-card')).toBe(true);
    } finally {
      await ctx.dispose();
    }
  } finally {
    process.chdir(originalCwd);
  }
});
