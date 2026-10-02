import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBuild } from '../../cli/build.js';
import { createTempProject, createTestBuildConfig, removeTempProject } from '../../testing/build-project.js';

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    lib: ['ESNext', 'DOM'],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['./src/**/*.ts', './.thane/types/**/*.d.ts'],
});

const MAIN = `
import { mount } from 'thane';
import Routes from './routes.js';

mount(Routes);
`;

// Lazy loaders with an inferred return type: the page types flow into the type of Routes
const ROUTES = `
import { defineRoutes } from 'thane/router';

const Routes = defineRoutes({
  '/': { component: () => import('./pages/home.js').then((m) => m.HomePage) },
  '/about': { component: () => import('./pages/about.js').then((m) => m.AboutPage) },
  notFound: { component: () => import('./pages/home.js').then((m) => m.HomePage) },
});

export default Routes;
`;

const page = (exportName: string, target: string): string => `
import { defineComponent, html } from 'thane';
import { navigate } from 'thane/router';

export const ${exportName} = defineComponent(() => ({
  template: html\`<a href="${target}" @click.prevent=\${navigate('${target}')}>go</a>\`,
}));
`;

const buildRoutedProject = async (homeTarget: string): Promise<string> => {
  const project = await createTempProject(MAIN, {
    'tsconfig.json': TSCONFIG,
    'src/routes.ts': ROUTES,
    'src/pages/home.ts': page('HomePage', homeTarget),
    'src/pages/about.ts': page('AboutPage', '/'),
  });
  try {
    await runBuild(createTestBuildConfig(project));
    return await readFile(join(project.root, '.thane', 'types', 'router', 'src', 'routes.generated.d.ts'), 'utf8');
  } finally {
    await removeTempProject(project);
  }
};

describe('Generated route types', () => {
  test('a lazy page that calls navigate() in its template type-checks without annotations', async () => {
    const generated = await buildRoutedProject('/about');
    // The paths are written out as literals: importing the type of Routes would make every
    // page that calls navigate() depend on its own type through the route table.
    expect(generated).toContain("routePaths: '/' | '/about';");
    expect(generated).not.toContain('import type Routes');
  });

  test('navigate() still rejects a path that is not in the route table', async () => {
    await expect(buildRoutedProject('/missing')).rejects.toThrow();
  });
});

// Route heads: the fields a route and setMeta() accept, checked by the build's strict type check
const META_ROUTES = (homeMeta: string) => `
import { defineRoutes, metaName } from 'thane/router';

const Routes = defineRoutes(
  {
    '/': { component: () => import('./pages/home.js').then((m) => m.HomePage), meta: ${homeMeta} },
    '/about': { component: () => import('./pages/about.js').then((m) => m.AboutPage), meta: { title: 'About' } },
    notFound: { component: () => import('./pages/home.js').then((m) => m.HomePage) },
  },
  {
    meta: { siteUrl: 'https://example.com', titleTemplate: '%s | Example' },
    customMeta: { author: metaName('author'), hreflang: (langs: Record<string, string>) => [] },
  },
);

export default Routes;
`;

const metaPage = (exportName: string, setMetaArgument: string): string => `
import { defineComponent, html } from 'thane';
import { navigate, setMeta } from 'thane/router';

export const ${exportName} = defineComponent(() => {
  setMeta(${setMetaArgument});
  return { template: html\`<a href="/about" @click.prevent=\${navigate('/about')}>go</a>\` };
});
`;

const buildMetaProject = async (homeMeta: string, setMetaArgument: string): Promise<string> => {
  const project = await createTempProject(MAIN, {
    'tsconfig.json': TSCONFIG,
    'src/routes.ts': META_ROUTES(homeMeta),
    'src/pages/home.ts': metaPage('HomePage', setMetaArgument),
    'src/pages/about.ts': page('AboutPage', '/'),
  });
  try {
    await runBuild(createTestBuildConfig(project));
    return await readFile(join(project.root, '.thane', 'types', 'router', 'src', 'routes.generated.d.ts'), 'utf8');
  } finally {
    await removeTempProject(project);
  }
};

describe('Route head types', () => {
  test("routes and a page's setMeta() take the built-in fields and the app's own, typed", async () => {
    const generated = await buildMetaProject(
      "{ description: 'Home', author: 'Ada', hreflang: { af: '/af/' } }",
      "{ title: 'Later', author: 'Grace', hreflang: { en: '/' } }",
    );
    // Written out like the paths, so a page that calls setMeta() does not depend on its own type
    expect(generated).toContain("customMeta: { 'author'?: string; 'hreflang'?: Record<string, string>; };");
  });

  test('a route with a field that does not exist is a type error', async () => {
    await expect(buildMetaProject("{ descripton: 'typo' }", "{ title: 'x' }")).rejects.toThrow();
  });

  test('a custom field with a value of the wrong type is a type error', async () => {
    await expect(buildMetaProject('{ author: 42 }', "{ title: 'x' }")).rejects.toThrow();
  });

  test('setMeta() with a field that does not exist is a type error', async () => {
    await expect(buildMetaProject("{ title: 'x' }", "{ autor: 'typo' }")).rejects.toThrow();
  });
});

// Two apps under one tsconfig: each route table is its own entry, and the paths add up
describe('Two route tables in one project', () => {
  const appFiles = (name: string, target: string): Record<string, string> => ({
    [`src/${name}/page.ts`]: [
      "import { defineComponent, html } from 'thane';",
      "import { navigate } from 'thane/router';",
      '',
      `export const ${name.toUpperCase()}Page = defineComponent('${name}-page', ({ route }) => {`,
      '  const pattern: string = route!.pattern;',
      `  return { template: html\`<a @click=\${navigate('${target}')}>\${pattern}</a>\` };`,
      '});',
      '',
    ].join('\n'),
    [`src/${name}/routes.ts`]: [
      "import { defineRoutes } from 'thane/router';",
      `import { ${name.toUpperCase()}Page } from './page.js';`,
      '',
      `export default defineRoutes({ '/${name}': { component: ${name.toUpperCase()}Page }, notFound: { component: ${name.toUpperCase()}Page } });`,
      '',
    ].join('\n'),
  });

  const buildTwoApps = async (targetOfB: string): Promise<string[]> => {
    const project = await createTempProject('export {};\n', {
      'tsconfig.json': TSCONFIG,
      ...appFiles('a', '/a'),
      ...appFiles('b', targetOfB),
    });
    try {
      await runBuild(createTestBuildConfig(project));
      const read = (name: string) =>
        readFile(join(project.root, '.thane', 'types', 'router', 'src', name, 'routes.generated.d.ts'), 'utf8');
      return [await read('a'), await read('b')];
    } finally {
      await removeTempProject(project);
    }
  };

  test('each table is keyed by its file, and each app may navigate to its own paths', async () => {
    const [a, b] = await buildTwoApps('/b');
    expect(a).toContain("'src/a/routes.ts': {");
    expect(a).toContain("routePaths: '/a';");
    expect(b).toContain("'src/b/routes.ts': {");
    expect(b).toContain("'b-page': 'notFound';");
  });

  test('a path in neither table is still a type error', async () => {
    await expect(buildTwoApps('/c')).rejects.toThrow();
  });
});

describe('The error route', () => {
  test("is not a path to navigate to, and its page's route has the error, typed", async () => {
    const project = await createTempProject(MAIN, {
      'tsconfig.json': TSCONFIG,
      'src/routes.ts': [
        "import { defineRoutes } from 'thane/router';",
        "import { HomePage } from './pages/home.js';",
        "import { ErrorPage } from './pages/error.js';",
        '',
        "const Routes = defineRoutes({ '/': { component: HomePage }, notFound: { component: HomePage }, error: { component: ErrorPage } });",
        'export default Routes;',
        '',
      ].join('\n'),
      'src/pages/home.ts': page('HomePage', '/'),
      'src/pages/error.ts': [
        "import { defineComponent, html } from 'thane';",
        '',
        "export const ErrorPage = defineComponent('error-page', ({ route }) => {",
        '  const message = route!.error instanceof Error ? route!.error.message : String(route!.error);',
        "  const pattern: 'error' = route!.pattern;",
        '  return { template: html`<p>${pattern}: ${message}</p>` };',
        '});',
        '',
      ].join('\n'),
    });
    try {
      await runBuild(createTestBuildConfig(project));
      const generated = await readFile(
        join(project.root, '.thane', 'types', 'router', 'src', 'routes.generated.d.ts'),
        'utf8',
      );
      expect(generated).toContain("routePaths: '/';");
      expect(generated).toContain("'error-page': 'error';");
    } finally {
      await removeTempProject(project);
    }
  });
});

describe('Typed search values', () => {
  const buildWithSearch = async (use: string): Promise<string> => {
    const project = await createTempProject(MAIN, {
      'tsconfig.json': TSCONFIG,
      'src/routes.ts': [
        "import { defineRoutes, searchFlag, searchNumber, searchOneOf, searchString } from 'thane/router';",
        "import { ProductsPage } from './pages/products.js';",
        "import { HomePage } from './pages/home.js';",
        '',
        'const Routes = defineRoutes({',
        "  '/products': {",
        '    component: ProductsPage,',
        "    search: { page: searchNumber(1), q: searchString(), sale: searchFlag(), sort: searchOneOf(['price', 'name'], 'name'), tags: (raw): string[] => raw?.split(',') ?? [] },",
        '  },',
        '  notFound: { component: HomePage },',
        '});',
        'export default Routes;',
        '',
      ].join('\n'),
      'src/pages/home.ts': page('HomePage', '/products'),
      'src/pages/products.ts': [
        "import { defineComponent, html } from 'thane';",
        "import { navigate } from 'thane/router';",
        '',
        "export const ProductsPage = defineComponent('products-page', ({ route }) => {",
        '  const search = route!.search;',
        '  const page: number = search.page;',
        "  const sort: 'price' | 'name' = search.sort;",
        '  const q: string | undefined = search.q;',
        '  const tags: string[] = search.tags;',
        '  const sale: boolean = search.sale;',
        `  ${use}`,
        '  return { template: html`<p>${page} ${sort} ${q} ${tags.length} ${sale}</p>` };',
        '});',
        '',
      ].join('\n'),
    });
    try {
      await runBuild(createTestBuildConfig(project));
      return await readFile(join(project.root, '.thane', 'types', 'router', 'src', 'routes.generated.d.ts'), 'utf8');
    } finally {
      await removeTempProject(project);
    }
  };

  test('a page reads route.search typed from the schema, and navigate() takes the declared values', async () => {
    const generated = await buildWithSearch(
      "const go = () => navigate('/products', { page: 2, sort: 'price', sale: true });\n  void go;",
    );
    expect(generated).toContain(
      "'/products': { 'page': number; 'q': string | undefined; 'sale': boolean; 'sort': 'price' | 'name'; 'tags': string[]; };",
    );
  });

  test('a search value the schema does not declare, or of the wrong type, is a type error', async () => {
    await expect(buildWithSearch("const go = () => navigate('/products', { pg: 2 });\n  void go;")).rejects.toThrow();
    await expect(
      buildWithSearch("const go = () => navigate('/products', { sort: 'size' });\n  void go;"),
    ).rejects.toThrow();
  });

  test('a path with a query or a hash is a route path', async () => {
    await buildWithSearch("const go = () => { navigate('/products?page=2'); navigate('/products#top'); };\n  void go;");
  });
});
