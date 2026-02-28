import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { runBuild } from './cli/build.js';
import { RUNTIME_HELPER } from '../contracts/index.js';

const makeProject = async (entrySource: string) => {
  const root = await mkdtemp(join(process.cwd(), '.tmp-thane-contract-conformance-'));
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

const collectFiles = async (dir: string, predicate: (path: string) => boolean): Promise<string[]> => {
  const files: string[] = [];

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath)) {
        files.push(fullPath);
      }
    }
  };

  await walk(dir);
  return files;
};

const buildAndReadJs = async (source: string): Promise<string> => {
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

    const jsFiles = await collectFiles(project.outDir, (f) => f.endsWith('.js') && !f.endsWith('.js.map'));
    expect(jsFiles.length).toBeGreaterThan(0);
    const content = await Promise.all(jsFiles.map((f) => readFile(f, 'utf8')));
    return content.join('\n');
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
};

describe('compiler/runtime contract conformance', () => {
  test('generated output imports runtime helpers from internal runtime specifier', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('conformance-app', () => {
  const show = signal(true);
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <section class="root">
        <button @click=\${() => show(!show())}>toggle</button>
        \${when(show(), html\`<p>shown</p>\`)}
        \${whenElse(show(), html\`<p>A</p>\`, html\`<p>B</p>\`)}
        <ul>
          \${repeat(items(), (item) => html\`<li>\${item.label}</li>\`, (item) => item.id)}
        </ul>
      </section>
    \`,
    styles: css\`.root { color: red; }\`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    expect(js).toContain(RUNTIME_HELPER.IF);
    expect(js).toContain(RUNTIME_HELPER.IF_EXPR);
    expect(js).toContain(RUNTIME_HELPER.KEYED_RECONCILER);
    expect(js).toContain(RUNTIME_HELPER.ENABLE_STYLES);
    expect(
      js.includes(RUNTIME_HELPER.REGISTER_COMPONENT) || js.includes(RUNTIME_HELPER.REGISTER_COMPONENT_LEAN),
    ).toBe(true);
  });
});

describe('contracts-first governance guard', () => {
  test('repeat optimization skip reasons are not hard-coded in compiler outside contracts', async () => {
    const root = process.cwd();
    const compilerRoot = join(root, 'src', 'compiler');
    const files = await collectFiles(compilerRoot, (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    const rawSkipReasonLiterals = [
      "'no-bindings'",
      "'signal-bindings'",
      "'nested-repeat'",
      "'nested-conditional'",
      "'mixed-bindings'",
      "'multi-root'",
      "'path-not-found'",
    ];

    const violations: string[] = [];
    for (const filePath of files) {
      const content = await readFile(filePath, 'utf8');
      const hasViolation = rawSkipReasonLiterals.some((literal) => content.includes(literal));
      if (hasViolation) {
        violations.push(relative(root, filePath));
      }
    }

    expect(violations).toEqual([]);
  });
});
