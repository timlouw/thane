/**
 * Compile-time defects, each fixed and kept as a regression test asserting the correct behaviour. The runtime defects are in e2e/tests/hardening.spec.ts, the signal ones in
 * src/runtime/hardening.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { runBuild } from './cli/build.js';
import {
  buildAndReadJs,
  createTempProject,
  createTestBuildConfig,
  readBuiltJs,
  removeTempProject,
} from './testing/build-project.js';

const DEV = { config: { strictTypeCheck: false } };

const component = (name: string, body: string): string =>
  `import { defineComponent, signal } from 'thane';\nexport const ${name} = defineComponent(() => {\n${body}\n});\n`;

const mainFor = (name: string, file: string): string =>
  `import { mount } from 'thane';\nimport { ${name} } from './${file}.js';\nmount(${name}, { target: document.getElementById('app')! });\n`;

/**
 * Names the bundle reads but never declares, other than browser globals: each one is a
 * `ReferenceError` waiting to happen. The bundle is checked as JavaScript against the ES and DOM libs.
 */
const undeclaredNames = (js: string): string[] => {
  const fileName = '/hardening/bundle.js';
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  const fileExists = host.fileExists;
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === fileName
      ? ts.createSourceFile(name, js, languageVersion, true, ts.ScriptKind.JS)
      : getSourceFile.call(host, name, languageVersion, ...rest);
  host.fileExists = (name) => name === fileName || fileExists.call(host, name);
  const program = ts.createProgram([fileName], options, host);
  return program
    .getSemanticDiagnostics(program.getSourceFile(fileName))
    .filter((d) => d.code === 2304 || d.code === 2552) // Cannot find name 'x' (… Did you mean 'y'?)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n').match(/'([^']+)'/)?.[1] ?? '?');
};

/** The runtime `defineComponent` is called: the component shipped uncompiled. */
const callsRuntimeDefineComponent = (js: string): boolean => /(?<!function\s+)\bdefineComponent\s*\(/.test(js);

describe('compile-time defects', () => {
  test('a doc comment mentioning defineComponent() above the component leaves the component intact', async () => {
    const js = await buildAndReadJs(mainFor('Cmt', 'cmt'), {
      ...DEV,
      extraFiles: {
        'src/cmt.ts':
          "import { defineComponent, signal } from 'thane';\n" +
          '/** Built with defineComponent() like every component. */\n' +
          'export const Cmt = defineComponent(() => {\n' +
          '  const n = signal(1);\n' +
          '  return { template: html`<p class="c1">${n()}</p>` };\n' +
          '});\n',
      },
    });
    expect(undeclaredNames(js)).toEqual([]);
    expect(callsRuntimeDefineComponent(js)).toBe(false);
  });

  test('a component whose path contains "scripts" is compiled', async () => {
    const js = await buildAndReadJs(mainFor('Tr', 'transcripts/tr'), {
      ...DEV,
      extraFiles: {
        'src/transcripts/tr.ts': component(
          'Tr',
          '  const n = signal(2);\n  return { template: html`<p class="c2">${n()}</p>` };',
        ),
      },
    });
    expect(callsRuntimeDefineComponent(js)).toBe(false);
    expect(undeclaredNames(js)).toEqual([]);
  });

  test('a component file importing thane/router before thane builds', async () => {
    const js = await buildAndReadJs(mainFor('Rt', 'rt'), {
      ...DEV,
      extraFiles: {
        'src/rt.ts':
          "import { navigate } from 'thane/router';\n" +
          "import { defineComponent, signal } from 'thane';\n" +
          'export const Rt = defineComponent(() => {\n' +
          '  const n = signal(3);\n' +
          "  const go = () => navigate('/x');\n" +
          '  return { template: html`<p class="c3" @click=${go}>${n()}</p>` };\n' +
          '});\n',
      },
    });
    expect(callsRuntimeDefineComponent(js)).toBe(false);
    expect(undeclaredNames(js)).toEqual([]);
  });

  test('a style binding of a CSS custom property to a bare signal builds and sets the property', async () => {
    const js = await buildAndReadJs(mainFor('Cp', 'cp'), {
      ...DEV,
      extraFiles: {
        'src/cp.ts': component(
          'Cp',
          '  const w = signal(\'10px\');\n  return { template: html`<p class="c4" style="--w: ${w()}">c4</p>` };',
        ),
      },
    });
    expect(js).toMatch(/\.setProperty\(\s*["']--w["']/);
    expect(undeclaredNames(js)).toEqual([]);
  });

  test('braces inside a string inside a template expression build', async () => {
    const js = await buildAndReadJs(mainFor('Br', 'br'), {
      ...DEV,
      extraFiles: {
        'src/br.ts': component(
          'Br',
          "  const on = signal(true);\n  return { template: html`<p class=\"c5\">${on() ? '}' : '{'}</p>` };",
        ),
      },
    });
    expect(js).toMatch(/\?\s*["']\}["']\s*:\s*["']\{["']/);
    expect(undeclaredNames(js)).toEqual([]);
  });

  test('an entry with two mount() calls on different targets defines mount for both', async () => {
    const js = await buildAndReadJs(
      "import { mount } from 'thane';\n" +
        "import { Mo } from './mo.js';\n" +
        "mount(Mo, { target: document.getElementById('app')! });\n" +
        "mount(Mo, { target: document.getElementById('app2')! });\n",
      {
        ...DEV,
        extraFiles: {
          'src/mo.ts':
            'import { defineComponent } from \'thane\';\nexport const Mo = defineComponent(() => ({ template: html`<p class="c6">m</p>` }));\n',
        },
      },
    );
    expect(undeclaredNames(js)).toEqual([]);
  });

  test("importing an .scss file fails with esbuild's no-loader error", async () => {
    await expect(
      buildAndReadJs(mainFor('Sc', 'sc'), {
        ...DEV,
        extraFiles: {
          'src/sc.ts':
            "import { defineComponent } from 'thane';\n" +
            "import styles from './sc.scss';\n" +
            'export const Sc = defineComponent(() => ({ template: html`<p class="c7">s</p>`, styles }));\n',
          'src/sc.scss': '$c: red; .c7 { color: $c; }',
        },
      }),
    ).rejects.toThrow(/No loader is configured for "\.scss" files/);
  });

  test('building from a working directory outside the project gives the same output', async () => {
    // The same project built twice: from the repository (an ancestor of the project), then from a
    // folder that is not an ancestor. Child components must be compiled and the entry script injected
    // either way.
    // Child components resolve through the file's imports, so other components with the same name in
    // the repository (e2e/hardening-app has a `Kid`) cannot lend it their selector.
    const project = await createTempProject(mainFor('Par', 'par'), {
      'src/par.ts':
        "import { defineComponent } from 'thane';\n" +
        "import { CwdKid } from './kid.js';\n" +
        'export const Par = defineComponent(() => ({ template: html`<div class="par">${CwdKid({})}</div>` }));\n',
      'src/kid.ts':
        'import { defineComponent } from \'thane\';\nexport const CwdKid = defineComponent(() => ({ template: html`<b class="kid">kid</b>` }));\n',
    });
    const outside = await mkdtemp(join(tmpdir(), 'thane-cwd-'));
    const previousCwd = process.cwd();
    const build = async () => {
      await runBuild(createTestBuildConfig(project, DEV.config));
      return {
        // esbuild's `// <file>` markers name each module relative to the working directory
        js: (await readBuiltJs(project.outDir)).replace(/^\/\/(# sourceMappingURL=| ).*$/gm, ''),
        html: await readFile(join(project.outDir, 'index.html'), 'utf8'),
      };
    };
    try {
      const inside = await build();
      process.chdir(outside);
      const fromOutside = await build();
      process.chdir(previousCwd);

      expect(inside.html).toMatch(/<script type="module" src="\/main-[A-Z0-9]+\.js"><\/script>/);
      expect(fromOutside.html).toMatch(/<script type="module" src="\/main-[A-Z0-9]+\.js"><\/script>/);
      expect(fromOutside.js).toBe(inside.js);
    } finally {
      process.chdir(previousCwd);
      await removeTempProject(project);
      await rm(outside, { recursive: true, force: true });
    }
  });
});
