/**
 * Package surface check: packs the package, installs the tarball into a temporary project outside
 * the repository, and checks what an app can import.
 *
 *   bun run check:exports [--no-build] [--keep]
 *
 *  - runtime: each entry's value exports, loaded with Bun, equal the kept list exactly;
 *  - types: a file importing every kept value and type from each entry type-checks, and a file
 *    per removed name or entry fails with "no exported member" / "cannot find module";
 *  - the tarball still ships the CLI binary and client.d.ts (the js-framework-benchmark projects
 *    include `node_modules/thane/client.d.ts` by path).
 *
 * The lists below are the public surface; change them together with the package exports. --no-build skips `bun run build`; --keep leaves the temporary project in place.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const repoRoot = resolve(import.meta.dir, '..');
const args = new Set(process.argv.slice(2));

interface EntrySurface {
  values: string[];
  types: string[];
}

/** What each package entry exports. */
const KEPT: Record<string, EntrySurface> = {
  'thane': {
    values: [
      'batch',
      'computed',
      'css',
      'defineComponent',
      'effect',
      'html',
      'mount',
      'onCleanup',
      'ref',
      'registerGlobalStyles',
      'repeat',
      'signal',
      'unmount',
      'untrack',
      'when',
    ],
    types: [
      'Signal',
      'ReadonlySignal',
      'ComponentContext',
      'ComponentHTMLSelector',
      'Fragment',
      'MountHandle',
      'Ref',
      'RoutePaths',
    ],
  },
  'thane/router': {
    values: [
      'defineRoutes',
      'href',
      'linkTag',
      'metaName',
      'metaProperty',
      'navigate',
      'navigateBack',
      'searchFlag',
      'searchNumber',
      'searchOneOf',
      'searchString',
      'setMeta',
    ],
    types: [
      'AppRouteMeta',
      'CustomMetaField',
      'HeadTag',
      'RouteImage',
      'RouteMeta',
      'SearchParser',
      'SearchSchema',
      'SiteMeta',
    ],
  },
  'thane/runtime': {
    values: [
      '__T',
      '__batchRows',
      '__bindIf',
      '__bindIfExpr',
      '__dc',
      '__rc',
      '__enableComponentStyles',
      '__enableKeyframeScoping',
      '__mf',
      '__nc',
      '__registerComponent',
      '__registerComponentLean',
      '__sig',
      'createKeyedReconciler',
      'mountComponent',
    ],
    types: [],
  },
  // Node's cloneNode and insertBefore, for compiled lists (it reads Node.prototype when it loads)
  'thane/runtime/dom': { values: ['_cloneNode', '_insertBefore'], types: [] },
};

/** Names that an entry exported in 0.2.0 and no longer does: they must stay gone. */
const REMOVED: Record<string, string[]> = {
  'thane': [
    'mountComponent',
    'ComponentRoot',
    'ComponentReturnType',
    'MountOptions',
    'Register',
    'RouteComponentRegister',
    'RegisteredRoutes',
    'Route',
    'RouteComponent',
    'LazyRouteComponent',
    'EagerRouteComponent',
    'RoutesMap',
    'RoutesConfig',
    'RouterConfig',
    'ScrollRestorationConfig',
    'ExtractRouteParams',
    'RouteContextForSelector',
    'UntypedRouteContext',
    'RouteToPath',
  ],
  'thane/router': [
    'matchRoute',
    'startRouter',
    'stopRouter',
    'Register',
    'RouteComponentRegister',
    'RouteToPath',
    'ExtractRouteParams',
    'RoutePaths',
    'RouteParamNames',
    'RouteParamsObject',
    'UntypedRouteContext',
    'RouteContextForSelector',
    'LazyRouteComponent',
    'EagerRouteComponent',
    'RouteComponent',
    'Route',
    'RoutesMap',
    'RoutesConfig',
    'RegisteredRoutes',
    'ScrollRestorationConfig',
    'RouterConfig',
  ],
};

/** Entries that no longer exist. */
const REMOVED_ENTRIES = ['thane/compiler', 'thane/compiler/cli'];

/** Files the tarball must still contain. */
const SHIPPED_FILES = ['dist/compiler/cli/thane.js', 'client.d.ts'];

const failures: string[] = [];
const fail = (message: string) => failures.push(message);

/** Runs this Bun (not whichever one PATH finds first) with `cmdArgs`; throws on a non-zero exit. */
const bun = (cmdArgs: string[], cwd: string) => {
  const r = spawnSync(process.execPath, cmdArgs, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`bun ${cmdArgs.join(' ')} failed in ${cwd}:\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
};

if (!args.has('--no-build')) bun(['run', 'build'], repoRoot);

const project = mkdtempSync(join(tmpdir(), 'thane-exports-'));
try {
  const tarball = join(project, 'thane.tgz');
  bun(['pm', 'pack', '--filename', tarball, '--quiet'], repoRoot);
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify({
      name: 'thane-exports-check',
      private: true,
      type: 'module',
      dependencies: { thane: 'file:./thane.tgz' },
    }),
  );
  bun(['install'], project);
  const installed = join(project, 'node_modules', 'thane');

  for (const file of SHIPPED_FILES) {
    if (!existsSync(join(installed, file))) fail(`the tarball does not contain ${file}`);
  }

  // Runtime: the value exports of each entry, exactly
  const probe = join(project, 'probe-values.ts');
  // thane/runtime/dom reads Node.prototype, which Bun does not have: a stub, loaded before it
  writeFileSync(join(project, 'node-stub.ts'), '(globalThis as { Node?: unknown }).Node ??= class {};\n');
  writeFileSync(
    probe,
    [`import './node-stub.ts';`]
      .concat(Object.keys(KEPT).map((entry, i) => `import * as m${i} from '${entry}';`))
      .concat(
        `console.log(JSON.stringify({ ${Object.keys(KEPT)
          .map((entry, i) => `'${entry}': Object.keys(m${i}).sort()`)
          .join(', ')} }));`,
      )
      .join('\n'),
  );
  const actual = JSON.parse(bun([probe], project)) as Record<string, string[]>;
  for (const [entry, surface] of Object.entries(KEPT)) {
    const expected = [...surface.values].sort();
    const got = actual[entry] ?? [];
    const missing = expected.filter((n) => !got.includes(n));
    const extra = got.filter((n) => !expected.includes(n));
    if (missing.length > 0) fail(`${entry}: runtime exports missing ${missing.join(', ')}`);
    if (extra.length > 0) fail(`${entry}: runtime exports not in the kept list: ${extra.join(', ')}`);
  }
  REMOVED_ENTRIES.forEach((entry, i) => {
    const file = join(project, `probe-removed-${i}.ts`);
    writeFileSync(file, `await import('${entry}');\n`);
    if (spawnSync(process.execPath, [file], { cwd: project, encoding: 'utf8' }).status === 0) {
      fail(`${entry}: still loads at runtime`);
    }
  });

  // Types: every kept name type-checks, every removed name and entry fails
  const src = join(project, 'src');
  mkdirSync(src);
  const kept: string[] = [];
  Object.entries(KEPT).forEach(([entry, surface], i) => {
    if (surface.values.length > 0) kept.push(`import { ${surface.values.join(', ')} } from '${entry}';`);
    if (surface.types.length > 0) kept.push(`import type { ${surface.types.join(', ')} } from '${entry}';`);
    kept.push(`export const values${i} = [${surface.values.join(', ')}];`);
    for (const t of surface.types)
      kept.push(
        `export type T${i}_${t} = ${t}${t === 'Signal' || t === 'ReadonlySignal' ? '<number>' : t === 'ComponentHTMLSelector' ? '<{}>' : ''};`,
      );
  });
  writeFileSync(join(src, 'kept.ts'), kept.join('\n') + '\n');

  const expectedToFail = new Map<string, string>(); // file -> description
  let n = 0;
  for (const [entry, names] of Object.entries(REMOVED)) {
    for (const name of names) {
      const file = join(src, `removed-${n++}.ts`);
      writeFileSync(file, `import { ${name} } from '${entry}';\nexport { ${name} };\n`);
      expectedToFail.set(file, `${name} from ${entry}`);
    }
  }
  for (const entry of REMOVED_ENTRIES) {
    const file = join(src, `removed-${n++}.ts`);
    writeFileSync(file, `export * from '${entry}';\n`);
    expectedToFail.set(file, `the entry ${entry}`);
  }

  // css imports: the one declaration thane/client provides
  writeFileSync(join(src, 'styles.css'), '.a { color: red; }\n');
  writeFileSync(
    join(src, 'client.ts'),
    `/// <reference types="thane/client" />\nimport styles from './styles.css';\nexport const css: string = styles;\n`,
  );

  const rootNames = [join(src, 'kept.ts'), join(src, 'client.ts'), ...expectedToFail.keys()];
  const program = ts.createProgram({
    rootNames,
    options: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
      types: [],
    },
  });
  const byFile = new Map<string, ts.Diagnostic[]>();
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const key = d.file ? resolve(d.file.fileName) : '(global)';
    byFile.set(key, [...(byFile.get(key) ?? []), d]);
  }
  const text = (d: ts.Diagnostic) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  for (const [file, list] of byFile) {
    if (expectedToFail.has(file)) continue;
    for (const d of list) fail(`${file}: ${text(d)}`);
  }
  // 2305 no exported member, 2724 no exported member (did you mean), 2614 / 2459 / 2460 declared
  // locally but not exported, 2307 cannot find module (a removed entry)
  const NOT_EXPORTED = new Set([2305, 2724, 2614, 2459, 2460, 2307]);
  for (const [file, description] of expectedToFail) {
    const list = byFile.get(resolve(file)) ?? [];
    if (!list.some((d) => NOT_EXPORTED.has(d.code))) {
      fail(`${description} still type-checks${list.length ? ` (${list.map(text).join('; ')})` : ''}`);
    }
  }

  const keptCount = Object.values(KEPT).reduce((s, e) => s + e.values.length + e.types.length, 0);
  if (failures.length === 0) {
    console.log(
      `check-exports: ok. ${keptCount} kept names in ${Object.keys(KEPT).length} entries import and type-check; ` +
        `${expectedToFail.size - REMOVED_ENTRIES.length} removed names and ${REMOVED_ENTRIES.length} removed entries fail.`,
    );
  }
} finally {
  if (args.has('--keep')) console.log(`temporary project kept at ${project}`);
  else rmSync(project, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`check-exports: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
