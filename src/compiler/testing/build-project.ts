/**
 * Helpers for build-through compiler tests: create a throwaway project inside
 * the repository, run the real build pipeline on it and read the emitted JS.
 *
 * Projects are created under the repository root rather than the OS temp dir
 * because `import ... from 'thane'` in the fixtures resolves through package
 * self-referencing, which only works inside the package directory.
 *
 * This folder is excluded from the published build (see tsconfig.build.json).
 */

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBuild } from '../cli/build.js';
import type { BuildConfig } from '../cli/types.js';

export interface TempProject {
  root: string;
  srcDir: string;
  outDir: string;
  htmlPath: string;
  entryPath: string;
}

const INDEX_HTML = '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="app"></div></body></html>';

/** Create a project with index.html, src/main.ts and any extra files (paths relative to the project root). */
export const createTempProject = async (
  entrySource: string,
  extraFiles: Record<string, string> = {},
): Promise<TempProject> => {
  const root = await mkdtemp(join(process.cwd(), '.tmp-thane-'));
  const srcDir = join(root, 'src');
  const outDir = join(root, 'dist');
  const htmlPath = join(root, 'index.html');
  const entryPath = join(srcDir, 'main.ts');

  await mkdir(srcDir, { recursive: true });
  await writeFile(htmlPath, INDEX_HTML, 'utf8');
  await writeFile(entryPath, entrySource, 'utf8');

  for (const [relativePath, contents] of Object.entries(extraFiles)) {
    const fullPath = join(root, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, contents, 'utf8');
  }

  return { root, srcDir, outDir, htmlPath, entryPath };
};

export const removeTempProject = (project: TempProject): Promise<void> =>
  rm(project.root, { recursive: true, force: true });

/** Development build config for a temp project; override any field per test. */
export const createTestBuildConfig = (project: TempProject, overrides: Partial<BuildConfig> = {}): BuildConfig => ({
  entryPoints: [project.entryPath],
  outDir: project.outDir,
  inputHTMLFilePath: project.htmlPath,
  outputHTMLFilePath: join(project.outDir, 'index.html'),
  projectRoot: project.root,
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
  ...overrides,
});

/** Production build: minified output with console/debugger calls stripped. */
export const PROD_BUILD: Partial<BuildConfig> = {
  isProd: true,
  dropConsole: true,
  dropDebugger: true,
  sourcemap: false,
  strictTypeCheck: false,
};

/** Emitted JavaScript files under an output directory (source maps excluded). */
export const listBuiltJsFiles = async (dir: string): Promise<string[]> => {
  const files: string[] = [];
  const walk = async (currentDir: string): Promise<void> => {
    for (const entry of await readdir(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
    }
  };
  await walk(dir);
  return files;
};

/** Concatenated contents of every emitted JavaScript file. */
export const readBuiltJs = async (outDir: string): Promise<string> => {
  const files = await listBuiltJsFiles(outDir);
  if (files.length === 0) throw new Error(`No JavaScript output found in ${outDir}`);
  const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  return contents.join('\n');
};

/** Build a one-off project from source and return its emitted JavaScript. */
export const buildAndReadJs = async (
  entrySource: string,
  options: { extraFiles?: Record<string, string>; config?: Partial<BuildConfig> } = {},
): Promise<string> => {
  const project = await createTempProject(entrySource, options.extraFiles);
  try {
    await runBuild(createTestBuildConfig(project, options.config));
    return await readBuiltJs(project.outDir);
  } finally {
    await removeTempProject(project);
  }
};
