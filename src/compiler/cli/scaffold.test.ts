/**
 * `thane init` and `thane generate component`: the files they write, that they never write over a file, and that
 * a project `thane init` creates (whose tsconfig.json extends `thane/tsconfig.json`) type-checks and builds.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { componentFiles, generateComponent, initProject } from './scaffold.js';
import { parseArgs } from './cli-common.js';

const REPO = resolve(import.meta.dir, '..', '..', '..');
const root = mkdtempSync(join(tmpdir(), 'thane-scaffold-'));
let count = 0;
const fresh = (): string => {
  const dir = join(root, `p${count++}`);
  mkdirSync(dir);
  return dir;
};

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('thane generate component', () => {
  test('a component in a folder of its name: name.component.ts and .css, exported in PascalCase', () => {
    const dir = fresh();
    const written = generateComponent('ui/user-card', dir);
    expect(written.map((f) => f.replaceAll('\\', '/'))).toEqual([
      'ui/user-card/user-card.component.ts',
      'ui/user-card/user-card.component.css',
    ]);
    expect(readFileSync(join(dir, 'ui/user-card/user-card.component.ts'), 'utf8')).toBe(
      [
        "import { defineComponent, html } from 'thane';",
        "import styles from './user-card.component.css';",
        '',
        'export const UserCard = defineComponent(() => ({',
        '  template: html`<p>user-card works</p>`,',
        '  styles,',
        '}));',
        '',
      ].join('\n'),
    );
  });

  test('a name that is not lowercase words joined by hyphens is refused', () => {
    expect(() => componentFiles('x', 'UserCard')).toThrow(
      "[thane] A component's name is lowercase words joined by hyphens, like user-card: 'UserCard'",
    );
    expect(() => componentFiles('x', 'user_card')).toThrow('lowercase words joined by hyphens');
  });

  test('nothing is written over a file that exists, and nothing is written at all then', () => {
    const dir = fresh();
    mkdirSync(join(dir, 'card'));
    writeFileSync(join(dir, 'card/card.component.css'), 'mine');
    expect(() => generateComponent('card', dir)).toThrow(
      '[thane] These files exist already, and are left as they are: ',
    );
    expect(readFileSync(join(dir, 'card/card.component.css'), 'utf8')).toBe('mine');
    expect(existsSync(join(dir, 'card/card.component.ts'))).toBe(false);
  });
});

describe('thane init', () => {
  test("a project's files, its name from its folder", () => {
    const dir = join(fresh(), 'My App');
    const written = initProject(dir).map((f) => f.replaceAll('\\', '/'));
    expect(written).toEqual([
      'package.json',
      'tsconfig.json',
      '.gitignore',
      'index.html',
      'src/main.ts',
      'src/app/app.component.ts',
      'src/app/app.component.css',
    ]);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-app');
    expect(pkg.scripts).toEqual({
      dev: 'thane dev',
      build: 'thane build --prod',
      serve: 'thane serve --prod',
      typecheck: 'thane typecheck',
    });
    expect(JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8'))).toEqual({ extends: 'thane/tsconfig.json' });
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toContain('mount(App);');
  });

  test('a folder that holds a file init would write is left alone', () => {
    const dir = fresh();
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(() => initProject(dir)).toThrow('These files exist already, and are left as they are: package.json');
    expect(existsSync(join(dir, 'src'))).toBe(false);
  });

  test('the project type-checks and builds, with the base tsconfig and the editor plugin', () => {
    const dir = join(fresh(), 'app');
    initProject(dir);
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(REPO, join(dir, 'node_modules', 'thane'), 'junction');
    const cli = join(REPO, 'dist', 'compiler', 'cli', 'thane.js');
    const typecheck = spawnSync(process.execPath, [cli, 'typecheck'], { cwd: dir, encoding: 'utf8' });
    expect(typecheck.status).toBe(0);
    const build = spawnSync(process.execPath, [cli, 'build', '--prod'], { cwd: dir, encoding: 'utf8' });
    expect(build.status).toBe(0);
    expect(readFileSync(join(dir, 'dist', 'index.html'), 'utf8')).toContain('<script type="module"');
    // tsc reads the extended config: its plugin, strict options and the project's own src
    const shown = spawnSync(process.execPath, [join(REPO, 'node_modules/typescript/bin/tsc'), '--showConfig'], {
      cwd: dir,
      encoding: 'utf8',
    });
    const config = JSON.parse(shown.stdout);
    expect(config.compilerOptions.plugins).toEqual([{ name: 'thane/ts-plugin' }]);
    expect(config.compilerOptions.strict).toBe(true);
    // ${configDir} is the project's folder
    expect(config.include.map((p: string) => p.replaceAll('\\', '/'))).toEqual([
      `${dir.replaceAll('\\', '/')}/src/**/*.ts`,
      `${dir.replaceAll('\\', '/')}/.thane/types/**/*.d.ts`,
    ]);
  }, 120_000);
});

describe('the CLI reads the words after init and generate', () => {
  test('init takes a folder; generate takes what and where', () => {
    expect(parseArgs(['init', 'my-app']).positionals).toEqual(['my-app']);
    expect(parseArgs(['generate', 'component', 'ui/card']).positionals).toEqual(['component', 'ui/card']);
    expect(parseArgs(['init']).positionals).toBeUndefined();
  });
});
