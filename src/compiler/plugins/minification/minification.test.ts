import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildAndReadJs,
  createTempProject,
  createTestBuildConfig,
  PROD_BUILD,
  readBuiltJs,
  removeTempProject,
} from '../../testing/build-project.js';
import { runBuild } from '../../cli/build.js';

const prod = (source: string, extraFiles: Record<string, string> = {}): Promise<string> =>
  buildAndReadJs(source, { extraFiles, config: PROD_BUILD });

/** Production build that also returns the emitted index.html. */
const prodWithHtml = async (
  source: string,
  extraFiles: Record<string, string>,
): Promise<{ js: string; html: string }> => {
  const project = await createTempProject(source, extraFiles);
  try {
    await runBuild(createTestBuildConfig(project, PROD_BUILD));
    return { js: await readBuiltJs(project.outDir), html: await readFile(join(project.outDir, 'index.html'), 'utf8') };
  } finally {
    await removeTempProject(project);
  }
};

const FAKE_LIB: Record<string, string> = {
  'node_modules/fake-lib/package.json': JSON.stringify({
    name: 'fake-lib',
    version: '1.0.0',
    type: 'module',
    main: 'index.js',
  }),
  // Template literals that look like CSS and like HTML, a regex holding a quote and a backtick,
  // and a string that happens to spell one of the application's selectors
  'node_modules/fake-lib/index.js': [
    'export const quote = /["`]/;',
    'export const banner = () => `a:   b;   c:   d   { x:   y }`;',
    'export const markup = () => `<div>   <span>  spaced  </span>   </div>`;',
    "export const channel = () => 'child-card';",
    '',
  ].join('\n'),
  'node_modules/fake-lib/theme.css': '.theme-box {\n  padding: 2px;\n}\n',
};

describe('Production minification', () => {
  test('a chunk built only from node_modules is left exactly as esbuild emitted it', async () => {
    const js = await prod(
      `
import { defineComponent, mount } from 'thane';

export const App = defineComponent('test-app', () => ({
  template: html\`<div>x</div>\`,
}));
mount(App);
void import('fake-lib').then((lib) => {
  document.title = lib.banner() + String(lib.quote);
});
`,
      FAKE_LIB,
    );
    expect(js).toContain('a:   b;   c:   d   { x:   y }');
  });

  test('library code bundled into the same file as the application is left as esbuild emitted it', async () => {
    const js = await buildAndReadJs(
      `
import { defineComponent, mount } from 'thane';
import { banner, markup, quote } from 'fake-lib';

export const App = defineComponent('test-app', () => {
  document.title = banner() + markup() + String(quote);
  return { template: html\`<div>
    <p>hi</p>
  </div>\` };
});
mount(App);
`,
      { extraFiles: FAKE_LIB, config: { ...PROD_BUILD, splitting: false } },
    );
    expect(js).toContain('a:   b;   c:   d   { x:   y }');
    expect(js).toContain('<div>   <span>  spaced  </span>   </div>');
    expect(js).toContain('<div><p>hi</p></div>');
  });

  test('template literals that are not HTML or CSS keep their whitespace and line breaks', async () => {
    const js = await prod(`
import { defineComponent, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const code = document.title;
  document.title = ['one', 'two'].join('\\n') + \`Error:   \${code};   retry:   later\`;
  return { template: html\`<div>x</div>\` };
});
mount(App);
`);
    // esbuild prints "\\n" as a template literal holding a real line break
    expect(js).toMatch(/\.join\((?:`\n`|"\\n")\)/);
    expect(js).toMatch(/Error: {3}\$\{\w+\}; {3}retry: {3}later/);
  });

  test('a regex literal holding quotes and backticks changes nothing around it', async () => {
    const js = await prod(`
import { defineComponent, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const splitter = /["\`]/;
  document.title = document.title.split(splitter).join('') + \`keep   this:   as is\`;
  return { template: html\`<div>
    <p>hi</p>
  </div>\` };
});
mount(App);
`);
    expect(js).toContain('keep   this:   as is');
    expect(js).toContain('<div><p>hi</p></div>');
  });

  test('component HTML and CSS are minified', async () => {
    const js = await prod(`
import { defineComponent, mount } from 'thane';

export const App = defineComponent('test-app', () => ({
  template: html\`
    <section>
      <h1>Title</h1>
      <p>Body   text</p>
    </section>
  \`,
  styles: css\`
    .card {
      padding: 1rem;
      color: red;
    }
  \`,
}));
mount(App);
`);
    expect(js).toContain('<section><h1>Title</h1><p>Body text</p></section>');
    expect(js).toContain('.card{padding:1rem;color:red}');
  });

  test('a one-line template and stylesheet are minified like any other', async () => {
    const js = await prod(`
import { defineComponent, mount } from 'thane';

export const App = defineComponent('test-app', () => ({
  template: html\`<section>   <h1>Title</h1>   </section>\`,
  styles: css\`.card { padding: 1rem; }\`,
}));
mount(App);
`);
    // Whitespace on one line between tags is one space; with a line break in it, it would go
    expect(js).toContain('<section> <h1>Title</h1> </section>');
    expect(js).toContain('.card{padding:1rem}');
  });
});

describe('Stylesheets', () => {
  test('substitutions and escapes in a css template survive minification', async () => {
    const js = await prod(`
import { defineComponent, mount } from 'thane';

const gap = '}  {  ;';
export const App = defineComponent('test-app', () => ({
  template: html\`<div>x</div>\`,
  styles: css\`
    .quote::before {
      content: "\\\\201C";
      margin: \${gap.length}px   \${gap.length > 3 ? '1px' : '2px'};
    }
  \`,
}));
mount(App);
`);
    expect(js).toContain('content:"\\\\201C"');
    expect(js).toMatch(/margin:\$\{[^}]+\}px \$\{/);
  });

  test('a module that only holds css templates is compiled', async () => {
    const js = await prod(
      `
import { defineComponent, mount } from 'thane';
import { shared } from './shared.js';

export const App = defineComponent('test-app', () => ({
  template: html\`<div>x</div>\`,
  styles: shared,
}));
mount(App);
`,
      { 'src/shared.ts': 'export const shared = css`\n  .shared-rule {\n    color:   red;\n  }\n`;\n' },
    );
    expect(js).toContain('.shared-rule{color:red}');
    expect(js).not.toMatch(/\bcss`/);
  });

  test('a development build leaves stylesheets and selectors as written', async () => {
    const js = await buildAndReadJs(`
import { defineComponent, mount } from 'thane';

export const TestApp = defineComponent(() => ({
  template: html\`<div>
    <p>hi</p>
  </div>\`,
  styles: css\`.test-app {
    color: red;
  }\`,
}));
mount(TestApp);
`);
    expect(js).toContain('test-app');
    expect(js).toMatch(/\.test-app \{\s+color: red;\s+\}/);
  });
});

describe('Selector minification', () => {
  const CHILD = `
import { defineComponent } from 'thane';

export const ChildCard = defineComponent(() => ({
  template: html\`<b>child</b>\`,
  styles: css\`:host { display: block; }\`,
}));
`;

  // The child's host element is in the parent's template, so host creation is the template's tag
  test('component selectors are renamed consistently in registration, host creation and CSS', async () => {
    const js = await prod(
      `
import { defineComponent, mount } from 'thane';
import { ChildCard } from './child.js';

export const ParentPage = defineComponent(() => ({
  template: html\`<div>\${ChildCard({})}</div>\`,
  styles: css\`.child-card { margin: 1px; }\`,
}));
mount(ParentPage);
`,
      { 'src/child.ts': CHILD },
    );
    expect(js).not.toContain('child-card');
    expect(js).not.toContain('parent-page');
    const host = js.match(/<([a-z]+-[a-z]+)><\/\1>/)?.[1];
    expect(host).toBeDefined();
    // the parent's stylesheet addresses the child's host class under its new name
    expect(js).toContain(`.${host!}{margin:1px}`);
  });

  test('a selector that also appears inside other strings is left alone', async () => {
    const js = await prod(
      `
import { defineComponent, mount } from 'thane';
import { ChildCard } from './child.js';

export const ParentPage = defineComponent(() => {
  document.title = '/child-card/details';
  return { template: html\`<div>\${ChildCard({})}</div>\` };
});
mount(ParentPage);
`,
      { 'src/child.ts': CHILD },
    );
    expect(js).toContain('<child-card></child-card>');
    expect(js).toContain('/child-card/details');
    expect(js).not.toContain('parent-page');
  });

  test('a library string that spells a selector is not rewritten along with it', async () => {
    const js = await prod(
      `
import { defineComponent, mount } from 'thane';
import { channel } from 'fake-lib';
import { ChildCard } from './child.js';

export const ParentPage = defineComponent(() => {
  document.title = channel();
  return { template: html\`<div>\${ChildCard({})}</div>\` };
});
mount(ParentPage);
`,
      { 'src/child.ts': CHILD, ...FAKE_LIB },
    );
    // the component is renamed; the library's own 'child-card' string is not the component
    expect(js).not.toContain('<child-card>');
    expect(js).toMatch(/<([a-z]+-[a-z]+)><\/\1>/);
    expect(js).toContain('"child-card"');
  });

  test('host classes are renamed in an imported stylesheet, and never in one from a package', async () => {
    const js = await prod(
      `
import { defineComponent, mount } from 'thane';
import pageStyles from './page.css';
import theme from 'fake-lib/theme.css';
import { ChildCard } from './child.js';

export const ParentPage = defineComponent(() => ({
  template: html\`<div>\${ChildCard({})}</div>\`,
  styles: pageStyles + theme,
}));
mount(ParentPage);
`,
      { 'src/child.ts': CHILD, 'src/page.css': '.child-card {\n  margin: 1px;\n}\n', ...FAKE_LIB },
    );
    const host = js.match(/<([a-z]+-[a-z]+)><\/\1>/)?.[1];
    expect(host).toBeDefined();
    expect(host).not.toBe('child-card');
    expect(js).toContain(`.${host!}{margin:1px}`);
    expect(js).toContain('.theme-box{padding:2px}');
  });

  test('a selector that a static stylesheet addresses keeps its name everywhere', async () => {
    const js = await prod(
      `
import { defineComponent, mount } from 'thane';
import { ChildCard } from './child.js';

export const ParentPage = defineComponent(() => ({
  template: html\`<div>\${ChildCard({})}</div>\`,
}));
mount(ParentPage);
`,
      { 'src/child.ts': CHILD, 'src/assets/site.css': '.child-card { outline: 1px solid; }' },
    );
    expect(js).toContain('<child-card></child-card>');
  });

  test('the root tag in index.html follows the rename, the rest of the document does not', async () => {
    const { js, html } = await prodWithHtml(
      `
import { defineComponent, mount } from 'thane';

export const AppRoot = defineComponent(() => ({
  template: html\`<div>x</div>\`,
}));
mount(AppRoot);
`,
      {
        'index.html':
          '<!doctype html><html><head><meta charset="UTF-8"><title>Shop</title><script>\n// boot note\nwindow.booted = true;\n</script></head><body><app-root></app-root></body></html>',
      },
    );
    expect(js).not.toContain('app-root');
    expect(html).not.toContain('app-root');
    expect(html).toMatch(/<([a-z]+-[a-z]+)><\/\1>/);
    expect(html).toContain('<script>\n// boot note\nwindow.booted = true;\n</script>');
  });
});

describe('Selector plan', () => {
  // The selectors planned are the components the entry points reach: another component anywhere under
  // the project (a second app, a test fixture) used to take a short name, and shift everyone else's
  const main =
    "import { mount } from 'thane';\nimport { App } from './app.js';\nmount(App, { target: document.getElementById('app')! });\n";
  const component = (name: string, selector: string, template: string, imports = '') =>
    `import { defineComponent } from 'thane';\n${imports}export const ${name} = defineComponent('${selector}', () => ({ template: html\`${template}\`, styles: css\`:host { display: block; }\` }));\n`;
  const app = {
    'src/app.ts': component('App', 'zz-app', '<main>${Kid({})}</main>', "import { Kid } from './kid.js';\n"),
    'src/kid.ts': component('Kid', 'zz-kid', '<b>kid</b>'),
  };

  test('a component the entry does not reach changes no selector name', async () => {
    const alone = await prod(main, app);
    const withOthers = await prod(main, {
      ...app,
      'src/other/a.ts': component('A', 'aa-first', '<i>a</i>'),
      'src/other/b.ts': component('B', 'ab-second', '<i>b</i>'),
    });
    expect(alone).not.toContain('zz-kid');
    expect(withOthers).toBe(alone);
  });
});
