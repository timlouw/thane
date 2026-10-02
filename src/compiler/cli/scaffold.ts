/**
 * `thane init` and `thane generate component`: the files of a new project, and of a new component, in the layout
 * an Angular project has (`name.component.ts` and `name.component.css` side by side). Neither writes over a file
 * that exists.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `user-card` → `UserCard`, the name the component is exported under (its selector is derived from it) */
const pascalCase = (name: string): string =>
  name
    .split('-')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');

/** Lowercase words joined by hyphens: a component's file name, and the selector derived from its export */
const COMPONENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The installed thane's version, for the new project's dependency */
const thaneVersion = (): string => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, '..', '..', '..', 'package.json'), 'utf8')).version as string;
  } catch {
    return '0.0.0';
  }
};

/** Writes `files` under `root`: none may exist yet. Returns the paths written, relative to `root` */
const writeNew = (root: string, files: Record<string, string>): string[] => {
  const existing = Object.keys(files).filter((file) => existsSync(join(root, file)));
  if (existing.length > 0) {
    throw new Error(`[thane] These files exist already, and are left as they are: ${existing.join(', ')}`);
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return Object.keys(files);
};

/** A component's two files, in `dir`: `name.component.ts` and `name.component.css` */
export const componentFiles = (dir: string, name: string): Record<string, string> => {
  if (!COMPONENT_NAME.test(name)) {
    throw new Error(`[thane] A component's name is lowercase words joined by hyphens, like user-card: '${name}'`);
  }
  return {
    [join(dir, `${name}.component.ts`)]: [
      "import { defineComponent, html } from 'thane';",
      `import styles from './${name}.component.css';`,
      '',
      `export const ${pascalCase(name)} = defineComponent(() => ({`,
      `  template: html\`<p>${name} works</p>\`,`,
      '  styles,',
      '}));',
      '',
    ].join('\n'),
    [join(dir, `${name}.component.css`)]: 'p {\n  margin: 0;\n}\n',
  };
};

/**
 * `thane generate component <path>`: a component in a folder of its name, under the current directory:
 * `ui/user-card` writes `ui/user-card/user-card.component.ts` and `.css`.
 */
export const generateComponent = (path: string, cwd: string): string[] => {
  const name = basename(path);
  return writeNew(cwd, componentFiles(path, name));
};

/** `thane init [dir]`: a new project in `dir` (the current directory by default), ready for `bun install` */
export const initProject = (dir: string): string[] => {
  const root = resolve(dir);
  const name =
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-') || 'thane-app';
  return writeNew(root, {
    'package.json':
      JSON.stringify(
        {
          name,
          private: true,
          type: 'module',
          scripts: {
            dev: 'thane dev',
            build: 'thane build --prod',
            serve: 'thane serve --prod',
            typecheck: 'thane typecheck',
          },
          devDependencies: { thane: `^${thaneVersion()}` },
        },
        null,
        2,
      ) + '\n',
    'tsconfig.json': JSON.stringify({ extends: 'thane/tsconfig.json' }, null, 2) + '\n',
    '.gitignore': 'node_modules\ndist\n.thane\n',
    'index.html': [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      `    <title>${name}</title>`,
      '  </head>',
      '  <body></body>',
      '</html>',
      '',
    ].join('\n'),
    'src/main.ts': "import { mount } from 'thane';\nimport { App } from './app/app.component.js';\n\nmount(App);\n",
    // The app component counts its clicks: a signal, a binding and a handler
    [join('src/app', 'app.component.ts')]: [
      "import { defineComponent, html, signal } from 'thane';",
      "import styles from './app.component.css';",
      '',
      'export const App = defineComponent(() => {',
      '  const count = signal(0);',
      '  return {',
      '    template: html`<main>',
      `      <h1>${name}</h1>`,
      '      <button @click=${() => count(count() + 1)}>Clicked ${count()} times</button>',
      '    </main>`,',
      '    styles,',
      '  };',
      '});',
      '',
    ].join('\n'),
    [join('src/app', 'app.component.css')]: 'main {\n  font-family: system-ui, sans-serif;\n  padding: 2rem;\n}\n',
  });
};
