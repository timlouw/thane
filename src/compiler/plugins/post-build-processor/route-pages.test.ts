/**
 * A production build writes each static route's own index.html with the route's head, for crawlers and
 * link-preview bots that do not run JavaScript, and leaves the head renderer out of an app whose routes
 * set nothing but titles.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBuild } from '../../cli/build.js';
import {
  PROD_BUILD,
  createTempProject,
  createTestBuildConfig,
  readBuiltJs,
  removeTempProject,
} from '../../testing/build-project.js';

const MAIN = `
import { mount } from 'thane';
import Routes from './routes.js';

mount(Routes);
`;

const PAGE = `
import { defineComponent } from 'thane';

export const Page = defineComponent('route-pages-page', () => ({ template: html\`<p>page</p>\` }));
`;

const routes = (entries: string, options = ''): string => `
import { defineRoutes, metaName } from 'thane/router';

export default defineRoutes({
${entries}
  notFound: { component: () => import('./page.js').then((m) => m.Page), meta: { title: 'Missing' } },
}${options});
`;

const route = (path: string, meta: string): string =>
  `  '${path}': { component: () => import('./page.js').then((m) => m.Page), meta: ${meta} },`;

describe('route pages in a production build', () => {
  test("every static route gets its own index.html with its head; / is the root's", async () => {
    const project = await createTempProject(MAIN, {
      'src/routes.ts': routes(
        [
          route('/', "{ description: 'The home page' }"),
          route('/about', "{ title: 'About', author: 'Ada', image: '/og.png' }"),
          route('/users/:id', "{ title: 'User' }"),
        ].join('\n'),
        ", { meta: { siteUrl: 'https://example.com', title: 'Example', titleTemplate: '%s | Example' }, customMeta: { author: metaName('author') } }",
      ),
      'src/page.ts': PAGE,
    });
    try {
      await runBuild(createTestBuildConfig(project, { strictTypeCheck: false, ...PROD_BUILD }));
      const read = (file: string) => readFile(join(project.outDir, file), 'utf8');
      const index = await read('index.html');
      expect(index).toContain('<title>Example</title>');
      expect(index).toContain('<meta name="description" content="The home page">');
      expect(index).toContain('<link rel="canonical" href="https://example.com/">');
      const about = await read('about/index.html');
      expect(about).toContain('<title>About | Example</title>');
      expect(about).toContain('<meta property="og:image" content="https://example.com/og.png">');
      expect(about).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(about).toContain('<meta name="author" content="Ada">');
      // The same page otherwise: the entry script is there
      expect(about).toMatch(/<script type="module" src="\/main-[A-Z0-9]+\.js"><\/script>/);
      // A route with parameters has no page of its own; notFound neither
      expect(existsSync(join(project.outDir, 'users'))).toBe(false);
      // The head renderer is in the bundle
      expect(await readBuiltJs(project.outDir)).toContain('og:site_name');
    } finally {
      await removeTempProject(project);
    }
  }, 30000);

  test('an app whose routes set nothing but titles: the head renderer is left out, the titles are written', async () => {
    const project = await createTempProject(MAIN, {
      'src/routes.ts': routes([route('/', "{ title: 'Home' }"), route('/about', "{ title: 'About' }")].join('\n')),
      'src/page.ts': PAGE,
    });
    try {
      await runBuild(createTestBuildConfig(project, { strictTypeCheck: false, ...PROD_BUILD }));
      expect(await readBuiltJs(project.outDir)).not.toContain('og:site_name');
      expect(await readFile(join(project.outDir, 'about', 'index.html'), 'utf8')).toContain('<title>About</title>');
    } finally {
      await removeTempProject(project);
    }
  }, 30000);

  test('a development build writes no route pages, and keeps the head renderer', async () => {
    const project = await createTempProject(MAIN, {
      'src/routes.ts': routes([route('/', "{ title: 'Home' }"), route('/about', "{ title: 'About' }")].join('\n')),
      'src/page.ts': PAGE,
    });
    try {
      await runBuild(createTestBuildConfig(project, { strictTypeCheck: false }));
      expect(existsSync(join(project.outDir, 'about'))).toBe(false);
      expect(await readBuiltJs(project.outDir)).toContain('og:site_name');
    } finally {
      await removeTempProject(project);
    }
  }, 30000);
});
