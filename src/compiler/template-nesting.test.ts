import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBuild } from './cli/build.js';

const makeProject = async (entrySource: string) => {
  const root = await mkdtemp(join(process.cwd(), '.tmp-thane-template-nesting-'));
  const srcDir = join(root, 'src');
  const outDir = join(root, 'dist');
  const htmlPath = join(root, 'index.html');
  const entryPath = join(srcDir, 'main.ts');

  await mkdir(srcDir, { recursive: true });
  await writeFile(
    htmlPath,
    '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="app"></div></body></html>',
    'utf8',
  );
  await writeFile(entryPath, entrySource, 'utf8');

  return { root, outDir, htmlPath, entryPath };
};

const listDistJsFiles = async (dir: string): Promise<string[]> => {
  const jsFiles: string[] = [];

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        jsFiles.push(fullPath);
      }
    }
  };

  await walk(dir);
  return jsFiles;
};

test('variable-assigned html template can be injected via ${} into another html template', async () => {
  const source = `
import { defineComponent, mount } from 'thane';

const loading = html\`<div data-testid="loading-piece">Loading...</div>\`;
const shell = html\`<section data-testid="loading-shell">\${loading}</section>\`;

export const FixtureApp = defineComponent('fixture-app', () => ({
  template: html\`<main data-testid="fixture-root">\${shell}</main>\`,
}));

mount(FixtureApp);
`;

  const project = await makeProject(source);
  try {
    await runBuild({
      entryPoints: [project.entryPath],
      outDir: project.outDir,
      inputHTMLFilePath: project.htmlPath,
      outputHTMLFilePath: join(project.outDir, 'index.html'),
      isProd: false,
      serve: false,
      useGzip: false,
      strictTypeCheck: true,
      dropConsole: false,
      dropDebugger: false,
      sourcemap: true,
      port: 4200,
      open: false,
      host: 'localhost',
      base: '/',
      target: [],
      hashFileNames: true,
      define: {},
      envPrefix: 'THANE_',
      emptyOutDir: true,
      splitting: true,
      legalComments: 'none',
      analyze: false,
    });

    const jsFiles = await listDistJsFiles(project.outDir);
    expect(jsFiles.length).toBeGreaterThan(0);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test('directly nested html`` inside another html`` interpolation fails compile (THANE404)', async () => {
  const source = `
import { defineComponent, mount } from 'thane';

export const FixtureApp = defineComponent('fixture-app', () => ({
  template: html\`<main>\${html\`<div data-testid="bad-nested">nested</div>\`}</main>\`,
}));

mount(FixtureApp);
`;

  const project = await makeProject(source);
  try {
    let errorText = '';
    try {
      await runBuild({
        entryPoints: [project.entryPath],
        outDir: project.outDir,
        inputHTMLFilePath: project.htmlPath,
        outputHTMLFilePath: join(project.outDir, 'index.html'),
        isProd: false,
        serve: false,
        useGzip: false,
        strictTypeCheck: true,
        dropConsole: false,
        dropDebugger: false,
        sourcemap: true,
        port: 4200,
        open: false,
        host: 'localhost',
        base: '/',
        target: [],
        hashFileNames: true,
        define: {},
        envPrefix: 'THANE_',
        emptyOutDir: true,
        splitting: true,
        legalComments: 'none',
        analyze: false,
      });
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
    }

    expect(errorText.length).toBeGreaterThan(0);
    expect(errorText.includes('Build failed')).toBe(true);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test('repeat with unsupported optimized shape compiles via safe fallback renderer', async () => {
  const source = `
import { defineComponent, signal, mount } from 'thane';

export const FixtureApp = defineComponent('fixture-app', () => {
  const rows = signal([{ id: 1, label: 'A' }, { id: 2, label: 'B' }]);
  return {
    template: html\`
      <main>
        <ul>
          \${repeat(
            rows(),
            (item) => html\`<li data-testid="row-label">\${item.label}</li><li data-testid="row-id">\${item.id}</li>\`,
            html\`<li data-testid="empty">empty</li>\`,
            (item) => item.id,
          )}
        </ul>
      </main>
    \`,
  };
});

mount(FixtureApp);
`;

  const project = await makeProject(source);
  try {
    await runBuild({
      entryPoints: [project.entryPath],
      outDir: project.outDir,
      inputHTMLFilePath: project.htmlPath,
      outputHTMLFilePath: join(project.outDir, 'index.html'),
      isProd: false,
      serve: false,
      useGzip: false,
      strictTypeCheck: true,
      dropConsole: false,
      dropDebugger: false,
      sourcemap: true,
      port: 4200,
      open: false,
      host: 'localhost',
      base: '/',
      target: [],
      hashFileNames: true,
      define: {},
      envPrefix: 'THANE_',
      emptyOutDir: true,
      splitting: true,
      legalComments: 'none',
      analyze: false,
    });

    const jsFiles = await listDistJsFiles(project.outDir);
    expect(jsFiles.length).toBeGreaterThan(0);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});
