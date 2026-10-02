/**
 * Hot updates for `thane dev` (hot-modules.ts, cli/hot-updates.ts): which files the page can swap, what each
 * module imports, which modules a change runs again (up to the component files, or a reload), what a module
 * adds to register itself in the page, and the updates, whose imports read from the page's modules.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import {
  createHotState,
  hotRegistration,
  hotUpdatePlan,
  packageImports,
  isSwappable,
  keepModuleSignals,
  recordHotModule,
  trackHotInput,
  type HotState,
} from './hot-modules.js';
import { buildHotUpdates } from '../../cli/hot-updates.js';
import { createBuildContext } from '../../utils/index.js';
import { createModuleResolver } from '../../utils/module-graph.js';

const parse = (text: string): ts.SourceFile =>
  ts.createSourceFile('/p/src/x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

describe('the files the page can swap', () => {
  const cases: [string, string, boolean][] = [
    ['a component file', 'export const Card = defineComponent(() => ({ template: html`` }));', true],
    [
      'components and types',
      'const Row = defineComponent(() => ({}));\nexport const List = defineComponent(() => ({}));\n' +
        'export type Item = { id: number };\nexport interface Props { n: number }\nexport type { Other } from "./other.js";',
      true,
    ],
    [
      'a file that exports a helper too',
      'export const Card = defineComponent(() => ({}));\nexport const f = () => 1;',
      false,
    ],
    ['a file that exports a name later', 'const Card = defineComponent(() => ({}));\nexport { Card };', false],
    ['a file without a component', 'export const count = signal(0);', false],
    ['a function declaration exported', 'export const C = defineComponent(() => ({}));\nexport function f() {}', false],
  ];
  for (const [name, text, swappable] of cases) {
    test(`${name}: ${swappable ? 'swapped' : 'run again with the modules that import it'}`, () =>
      expect(isSwappable(parse(text))).toBe(swappable));
  }

  test('a file changes when it is built again with other text', () => {
    const hot = createHotState();
    trackHotInput(hot, 'a.ts', 'one');
    expect(hot.changed.size).toBe(0);
    trackHotInput(hot, 'a.ts', 'one');
    expect(hot.changed.size).toBe(0);
    trackHotInput(hot, 'a.ts', 'two');
    expect([...hot.changed]).toEqual([resolve('a.ts')]);
  });
});

describe('what a module imports at run time, and the modules a change runs again', () => {
  /** A hot state whose modules import as `graph` says (file → imports), `boundaries` the component files */
  const stateOf = (graph: Record<string, string[]>, boundaries: string[], changed: string[]): HotState => {
    const hot = createHotState();
    for (const [file, imports] of Object.entries(graph)) hot.imports.set(file, imports);
    for (const file of boundaries) hot.boundaries.add(file);
    for (const file of changed) hot.changed.add(file);
    return hot;
  };
  // main → app, boot; app (a component file) → card (one too), store; card → store, card.css; store → format;
  // boot → format
  const GRAPH = {
    main: ['app', 'boot'],
    app: ['card', 'store'],
    card: ['store', 'card.css'],
    store: ['format'],
    format: [],
    boot: ['format'],
  };
  const plan = (changed: string[], graph: Record<string, string[]> = GRAPH) =>
    hotUpdatePlan(stateOf(graph, ['app', 'card'], changed));

  test('a changed component file runs again alone: the components that mount it hold its handle', () => {
    expect(plan(['card'])).toEqual(['card']);
  });

  test('a changed store runs again, then each module that imports it, up to the component files', () => {
    expect(plan(['store'])).toEqual(['store', 'card', 'app']);
  });

  test('a changed stylesheet runs the modules that import it, which bundle it', () => {
    expect(plan(['card.css'])).toEqual(['card']);
  });

  test('a change that reaches the entry, or a file no module imports, reloads the page', () => {
    expect(plan(['format'])).toBeNull();
    expect(plan(['main'])).toBeNull();
    expect(plan(['global.css'])).toBeNull();
    expect(hotUpdatePlan(createHotState())).toBeNull();
  });

  test('each module runs after the ones it imports; modules that import each other run once', () => {
    expect(plan(['store', 'card'])).toEqual(['store', 'card', 'app']);
    const cycle = { main: ['app'], app: ['a'], a: ['b'], b: ['a'] };
    expect(plan(['a'], cycle)).toEqual(['b', 'a', 'app']);
  });

  test('recorded from the source: types are not imports, a stylesheet is one from its folder', () => {
    const hot = createHotState();
    const file = resolve('/p/src/card.ts');
    const text = [
      "import { defineComponent, html } from 'thane';",
      "import type { Item } from './types.js';",
      "import { type Shape } from './shapes.js';",
      "import { store, type Store } from './store.js';",
      "import styles from './card.css';",
      "export type { Other } from './other.js';",
      "export { format } from './format.js';",
      "const lazy = () => import('./lazy.js');",
      'export const Card = defineComponent(() => ({ template: html``, styles }));',
    ].join('\n');
    const resolveImport = (specifier: string) =>
      specifier.startsWith('./') ? `/p/src/${specifier.slice(2, -3)}.ts` : null;
    recordHotModule(hot, file, parse(text), resolveImport);
    expect(hot.imports.get(file)).toEqual(
      ['/p/src/store.ts', '/p/src/card.css', '/p/src/format.ts', '/p/src/lazy.ts'].map((f) => resolve(f)),
    );
    // It exports a helper too: the modules that import it run again with it
    expect(hot.boundaries.has(file)).toBe(false);
    recordHotModule(hot, file, parse(text.replace("export { format } from './format.js';", '')), resolveImport);
    expect(hot.boundaries.has(file)).toBe(true);
  });
});

test("a module the compiler leaves as it is keeps its top-level signals, by the module's key", () => {
  const text = "import { signal } from 'thane';\nexport const clicks = signal(0);\nlet other = signal(1);\n";
  expect(keepModuleSignals(text, parse(text), 'src/store.ts')).toBe(
    "import { __hotSignal } from 'thane/runtime';\nimport { signal } from 'thane';\n" +
      'export const clicks = __hotSignal(signal(0), "clicks", "src/store.ts");\nlet other = signal(1);\n',
  );
  const plain = 'export const step = 1;\n';
  expect(keepModuleSignals(plain, parse(plain), 'src/step.ts')).toBe(plain);
});

describe('the package bindings a module reads, and registers in the page', () => {
  const text = [
    "import { defineComponent, html, type Fragment } from 'thane';",
    "import type { Route } from 'thane/router';",
    "import { navigate as go, isActive } from 'thane/router';",
    "import confetti from 'confetti';",
    "import * as charts from 'charts';",
    "import 'polyfill';",
    "import { clicks } from './store.js';",
    "export * from 'some-package';",
    "export { format, type Format } from 'formats';",
    "const lazy = () => import('lazy-package');",
    '',
  ].join('\n');
  // The compiler's imports of its helpers, as it emits them
  const code =
    "import { __registerComponentLean, __bindIf } from 'thane/runtime'\n" +
    "import { _cloneNode, _insertBefore } from 'thane/runtime/dom'\n" +
    text;
  const read = (dynamic?: boolean) =>
    Object.fromEntries(
      [...packageImports(parse(text), code, dynamic)].map(([specifier, names]) => [specifier, [...names]]),
    );

  test('the names each import and re-export reads, a whole namespace as *, and no types', () => {
    expect(read()).toEqual({
      'thane': ['defineComponent', 'html'],
      'thane/router': ['navigate', 'isActive'],
      'confetti': ['default'],
      'charts': ['*'],
      'some-package': ['*'],
      'formats': ['format'],
      'lazy-package': ['*'],
      'thane/runtime': ['__registerComponentLean', '__bindIf'],
      'thane/runtime/dom': ['_cloneNode', '_insertBefore'],
    });
    // A package imported with import() alone is not registered
    expect(read(false)['lazy-package']).toBeUndefined();
  });

  test("the module registers its namespace, each binding into its package's, and a whole namespace marked", () => {
    const lines = hotRegistration('/p/src/label.ts', code, parse(text), '/p').split('\n');
    expect(lines.slice(lines.indexOf('import * as __thane_hot_self from "./label.js";'))).toEqual([
      'import * as __thane_hot_self from "./label.js";',
      'import { defineComponent as __thane_hot_0, html as __thane_hot_1 } from "thane";',
      'import { navigate as __thane_hot_2, isActive as __thane_hot_3 } from "thane/router";',
      'import { default as __thane_hot_4 } from "confetti";',
      'import * as __thane_hot_5 from "charts";',
      'import * as __thane_hot_6 from "some-package";',
      'import { format as __thane_hot_7 } from "formats";',
      'import { __registerComponentLean as __thane_hot_8, __bindIf as __thane_hot_9 } from "thane/runtime";',
      'import { _cloneNode as __thane_hot_10, _insertBefore as __thane_hot_11 } from "thane/runtime/dom";',
      '{',
      '  const modules = (globalThis.__thaneModules ??= new Map());',
      '  const register = (key, bindings) => modules.set(key, Object.assign(modules.get(key) ?? {}, bindings));',
      '  modules.set("src/label.ts", __thane_hot_self);',
      '  register("pkg:thane", { defineComponent: __thane_hot_0, html: __thane_hot_1 });',
      '  register("pkg:thane/router", { navigate: __thane_hot_2, isActive: __thane_hot_3 });',
      '  register("pkg:confetti", { default: __thane_hot_4 });',
      '  register("pkg:charts", __thane_hot_5);',
      '  modules.set("pkg*:charts", true);',
      '  register("pkg:some-package", __thane_hot_6);',
      '  modules.set("pkg*:some-package", true);',
      '  register("pkg:formats", { format: __thane_hot_7 });',
      '  register("pkg:thane/runtime", { __registerComponentLean: __thane_hot_8, __bindIf: __thane_hot_9 });',
      '  register("pkg:thane/runtime/dom", { _cloneNode: __thane_hot_10, _insertBefore: __thane_hot_11 });',
      '}',
      '',
    ]);
  });

  test('the registrations of two modules merge into a package', () => {
    const run = (registration: string, modules: Map<string, unknown>) => {
      const body = registration.split('\n').filter((line) => !line.startsWith('import'));
      (globalThis as { __thaneModules?: Map<string, unknown> }).__thaneModules = modules;
      try {
        new Function('__thane_hot_self', '__thane_hot_0', '__thane_hot_1', body.join('\n'))({}, 'a', 'b');
      } finally {
        delete (globalThis as { __thaneModules?: unknown }).__thaneModules;
      }
    };
    const modules = new Map<string, unknown>();
    const of = (names: string) => `import { ${names} } from 'thane';\n`;
    run(hotRegistration('/p/src/a.ts', of('signal, computed'), parse(of('signal, computed')), '/p'), modules);
    run(hotRegistration('/p/src/b.ts', of('effect'), parse(of('effect')), '/p'), modules);
    expect(modules.get('pkg:thane')).toEqual({ signal: 'a', computed: 'b', effect: 'a' });
    expect([...modules.keys()]).toEqual(['src/a.ts', 'pkg:thane', 'src/b.ts']);
  });
});

describe('the updates of a change', () => {
  let root = '';
  const FILES: Record<string, string> = {
    'package.json': '{ "name": "hot-fixture", "type": "module" }',
    'src/main.ts': "import { mount } from 'thane';\nimport { HotLabel } from './label.js';\nmount(HotLabel);\n",
    'src/store.ts': "import { signal } from 'thane';\nexport const clicks = signal(0);\n",
    'src/label.css': 'b { color: red; }\n',
    'src/label.ts': [
      "import { defineComponent, html } from 'thane';",
      "import { clicks } from './store.js';",
      "import styles from './label.css';",
      "export const HotLabel = defineComponent('hot-label', () => ({",
      '  template: html`<b>${clicks()}</b>`,',
      '  styles,',
      '}));',
      '',
    ].join('\n'),
  };

  beforeAll(async () => {
    root = await mkdtemp(join(process.cwd(), '.tmp-thane-hot-'));
    for (const [file, text] of Object.entries(FILES)) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), text);
    }
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  /** The updates when `changed` changed, with the modules recorded as a build records them */
  const updatesFor = async (changed: string[]) => {
    const buildContext = await createBuildContext(root);
    const hot = (buildContext.hot = createHotState());
    const resolveImport = createModuleResolver(root);
    for (const [file, text] of Object.entries(FILES)) {
      if (!file.endsWith('.ts')) continue;
      const path = join(root, file);
      recordHotModule(hot, path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), resolveImport);
    }
    for (const file of changed) hot.changed.add(resolve(root, file));
    return buildHotUpdates({ buildContext, define: { __THANE_DEV__: 'true' }, target: ['es2022'] });
  };

  test("a component file's is its compiled code, which imports every other module and package from the page", async () => {
    const [update, ...rest] = (await updatesFor(['src/label.ts']))!;
    expect(rest).toEqual([]);
    expect(update!.key).toBe('src/label.ts');
    expect(update!.code).toContain('require("__thane_module__:src/store.ts")');
    expect(update!.code).toContain('require("__thane_package__:thane/runtime")');
    expect(update!.code).toContain('__registerComponent)("hot-label"');
    // Its stylesheet is part of it
    expect(update!.code).toContain('b { color: red; }');
    expect(update!.code).not.toMatch(/__thaneModules|__thane_hot_self/);
    // The bindings it reads of each package, for the page to check: its source's imports (as every module
    // registers them), and the compiler's
    expect(update!.needs).toEqual({
      'thane': ['defineComponent', 'html'],
      'thane/runtime': ['__registerComponent', '__enableComponentStyles', '__T'],
    });
  });

  test("a store's runs it again, keeping its signals, then the component file that imports it", async () => {
    const updates = (await updatesFor(['src/store.ts']))!;
    expect(updates.map((update) => update.key)).toEqual(['src/store.ts', 'src/label.ts']);
    expect(updates[0]!.code).toMatch(/__hotSignal\)\(\(0, import_thane\d*\.signal\)\(0\), "clicks", "src\/store.ts"\)/);
  });

  test("a stylesheet's runs the component file that imports it", async () => {
    expect((await updatesFor(['src/label.css']))!.map((update) => update.key)).toEqual(['src/label.ts']);
  });

  test('is none when the change reaches the entry, or nothing changed: the page reloads', async () => {
    expect(await updatesFor(['src/label.ts', 'src/main.ts'])).toBeNull();
    expect(await updatesFor([])).toBeNull();
  });
});
