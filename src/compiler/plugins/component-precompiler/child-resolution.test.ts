/**
 * A child component call in a template, `${Kid(…)}`, resolves to the component the file declares or
 * imports under that name, whatever other components the project holds: two components with one
 * export name in different folders stay apart, an import alias works, re-exports and tsconfig `paths`
 * are followed, and a plain function that shares a component's name is not a component call. A component
 * the file does not export is callable in that file, and not through an import.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAndReadJs } from '../../testing/build-project.js';
import { createComponentResolver } from '../../utils/component-resolver.js';
import { sourceCache } from '../../utils/index.js';

const DEV = { strictTypeCheck: false };

const MAIN =
  "import { mount } from 'thane';\nimport { App } from './app.js';\n" +
  "mount(App, { target: document.getElementById('app')! });\n";

/** src/app.ts: a component with the given imports and template content. */
const app = (imports: string, template: string): string =>
  `import { defineComponent } from 'thane';\n${imports}\n` +
  'export const App = defineComponent(() => ({ template: html`<main>' +
  template +
  '</main>` }));\n';

const kid = (selector: string, text: string, name = 'Kid'): string =>
  `import { defineComponent } from 'thane';\n` +
  `export const ${name} = defineComponent('${selector}', () => ({ template: html\`<b>${text}</b>\` }));\n`;

const parent = (name: string, kidPath: string): string =>
  `import { defineComponent } from 'thane';\nimport { Kid } from '${kidPath}';\n` +
  `export const ${name} = defineComponent(() => ({ template: html\`<section>\${Kid({})}</section>\` }));\n`;

const build = (files: Record<string, string>): Promise<string> =>
  buildAndReadJs(MAIN, { extraFiles: files, config: DEV });

describe('child components resolve through the file', () => {
  test('two components with one export name: each parent mounts the one it imports', async () => {
    const js = await build({
      'src/app.ts': app(
        "import { First } from './first.js';\nimport { Second } from './second.js';",
        '${First({})}${Second({})}',
      ),
      'src/a/kid.ts': kid('kid-a', 'A'),
      'src/b/kid.ts': kid('kid-b', 'B'),
      'src/first.ts': parent('First', './a/kid.js'),
      'src/second.ts': parent('Second', './b/kid.js'),
    });
    expect(js).toContain('<kid-a');
    expect(js).toContain('<kid-b');
  });

  test('an import alias names the component', async () => {
    const js = await build({
      'src/app.ts': app("import { Kid as Child } from './kid.js';", '${Child({})}'),
      'src/kid.ts': kid('alias-kid', 'K'),
    });
    expect(js).toContain('<alias-kid');
  });

  test('re-exports are followed: a named re-export and export *', async () => {
    const js = await build({
      'src/app.ts': app("import { Card, Badge } from './ui/index.js';", '${Card({})}${Badge({})}'),
      'src/ui/index.ts': "export { Card } from './card.js';\nexport * from './badge.js';\n",
      'src/ui/card.ts': kid('ui-card', 'C', 'Card'),
      'src/ui/badge.ts': kid('ui-badge', 'B', 'Badge'),
    });
    expect(js).toContain('<ui-card');
    expect(js).toContain('<ui-badge');
  });

  test('a tsconfig paths alias is followed', async () => {
    const js = await build({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          paths: { '@ui/*': ['./src/ui/*'] },
          skipLibCheck: true,
        },
        include: ['src'],
      }),
      'src/app.ts': app("import { Kid } from '@ui/kid.js';", '${Kid({})}'),
      'src/ui/kid.ts': kid('paths-kid', 'P'),
    });
    expect(js).toContain('<paths-kid');
  });

  test('a component the file does not export is mounted in that file, by the name it is declared under', async () => {
    const js = await build({
      'src/app.ts':
        "import { defineComponent } from 'thane';\n" +
        'const Pill = defineComponent(() => ({ template: html`<i>p</i>` }));\n' +
        'export const App = defineComponent(() => ({ template: html`<main>${Pill({})}</main>` }));\n',
    });
    expect(js).toContain('<pill');
    expect(js).toMatch(/__registerComponentLean\("pill", /);
  });

  test('a local function that shares a component name is a plain call', async () => {
    const js = await build({
      'src/app.ts': app('const Label = (s: string): string => s.toUpperCase();', "${Label('x')}"),
      'src/label.ts': kid('x-label', 'L', 'Label'),
    });
    expect(js).not.toContain('x-label');
    expect(js).toContain('toUpperCase');
  });
});

test('an import resolves only to a component the other file exports', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'thane-resolver-')));
  try {
    const kid = join(root, 'kid.ts');
    writeFileSync(
      kid,
      "const Kid = defineComponent('hidden-kid', () => ({}));\n" +
        "export const Shown = defineComponent('shown-kid', () => ({}));\n",
    );
    const appPath = join(root, 'app.ts');
    const appText = "import { Kid, Shown } from './kid.js';\nconst Own = defineComponent(() => ({}));\n";
    writeFileSync(appPath, appText);
    const scope = await createComponentResolver(root, []).componentsInScope(sourceCache.parse(appPath, appText));
    expect([...scope].map(([name, def]) => [name, def.selector, def.exported])).toEqual([
      ['Own', 'own', false],
      ['Shown', 'shown-kid', true],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
