import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { runBuild } from './cli/build.js';
import { RUNTIME_HELPER } from '../contracts/index.js';

const makeProject = async (entrySource: string) => {
  const root = await mkdtemp(join(process.cwd(), '.tmp-thane-contract-conformance-'));
  const srcDir = join(root, 'src');
  const outDir = join(root, 'dist');
  const htmlPath = join(root, 'index.html');
  const entryPath = join(srcDir, 'main.ts');

  await mkdir(srcDir, { recursive: true });
  await writeFile(
    htmlPath,
    '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="app"></div></body></html>',
    'utf8',
  );
  await writeFile(entryPath, entrySource, 'utf8');

  return { root, outDir, htmlPath, entryPath };
};

const collectFiles = async (dir: string, predicate: (path: string) => boolean): Promise<string[]> => {
  const files: string[] = [];

  const walk = async (currentDir: string): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath)) {
        files.push(fullPath);
      }
    }
  };

  await walk(dir);
  return files;
};

const buildAndReadJs = async (source: string): Promise<string> => {
  const project = await makeProject(source);
  try {
    await runBuild({
      entryPoints: [project.entryPath],
      outDir: project.outDir,
      inputHTMLFilePath: project.htmlPath,
      outputHTMLFilePath: join(project.outDir, 'index.html'),
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
    });

    const jsFiles = await collectFiles(project.outDir, (f) => f.endsWith('.js') && !f.endsWith('.js.map'));
    expect(jsFiles.length).toBeGreaterThan(0);
    const content = await Promise.all(jsFiles.map((f) => readFile(f, 'utf8')));
    return content.join('\n');
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
};

describe('compiler/runtime contract conformance', () => {
  test('generated output imports runtime helpers from internal runtime specifier', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('conformance-app', () => {
  const show = signal(true);
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <section class="root">
        <button @click=\${() => show(!show())}>toggle</button>
        \${when(show(), html\`<p>shown</p>\`)}
        \${whenElse(show(), html\`<p>A</p>\`, html\`<p>B</p>\`)}
        <ul>
          \${repeat(items(), (item) => html\`<li>\${item.label}</li>\`, (item) => item.id)}
        </ul>
      </section>
    \`,
    styles: css\`.root { color: red; }\`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    expect(js).toContain(RUNTIME_HELPER.IF);
    expect(js).toContain(RUNTIME_HELPER.IF_EXPR);
    expect(js).toContain(RUNTIME_HELPER.KEYED_RECONCILER);
    expect(js).toContain(RUNTIME_HELPER.ENABLE_STYLES);
    expect(js.includes(RUNTIME_HELPER.REGISTER_COMPONENT) || js.includes(RUNTIME_HELPER.REGISTER_COMPONENT_LEAN)).toBe(
      true,
    );
  });

  test('supports broad whenElse/repeat nesting matrix with simple and complex expressions', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('nesting-matrix-app', () => {
  const ready = signal(true);
  const enabled = signal(false);
  const items = signal([{ id: 1, label: 'A', qty: 2 }, { id: 2, label: 'B', qty: 0 }]);
  const alt = signal([{ id: 3, label: 'C', qty: 1 }]);

  return {
    template: html\`
      <section>
        \${whenElse(
          ready(),
          html\`
            <ul data-testid="primary-list">
              \${repeat(
                items(),
                (item, idx) => html\`
                  <li data-testid="row-\${item.id}">
                    <span>\${item.label}-\${idx}</span>
                    <em \${when(item.qty > 0)}>qty-\${item.qty}</em>
                    \${whenElse(item.qty > 0, html\`<b>in-stock</b>\`, html\`<b>out</b>\`)}
                  </li>
                \`,
                html\`<li data-testid="primary-empty">empty-primary</li>\`,
                (item) => item.id,
              )}
            </ul>
          \`,
          html\`
            <ul data-testid="alt-list">
              \${repeat(
                alt(),
                (item) => html\`<li data-testid="alt-row">\${item.label}</li>\`,
                html\`<li data-testid="alt-empty">empty-alt</li>\`,
                (item) => item.id,
              )}
            </ul>
          \`,
        )}

        \${whenElse(
          ready() && (enabled() || items().length > 0),
          html\`<p data-testid="complex-then">complex-then</p>\`,
          html\`<p data-testid="complex-else">complex-else</p>\`,
        )}
      </section>
    \`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    expect(js).toContain(RUNTIME_HELPER.IF);
    expect(js).toContain(RUNTIME_HELPER.IF_EXPR);
  });

  test('supports sub-nesting: whenElse branches each host repeat with nested conditional content', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('sub-nesting-app', () => {
  const show = signal(true);
  const groupA = signal([{ id: 1, v: 'A1' }, { id: 2, v: 'A2' }]);
  const groupB = signal([{ id: 3, v: 'B1' }]);

  return {
    template: html\`
      <div>
        \${whenElse(
          show(),
          html\`
            <section>
              <ul>
                \${repeat(
                  groupA().filter((x) => x.id > 0),
                  (item, i) => html\`
                    \${whenElse(item.id > 1, html\`<li>large-\${item.v}-\${i}</li>\`, html\`<li>small-\${item.v}-\${i}</li>\`)}
                  \`,
                  html\`<li>none-a</li>\`,
                  (item) => item.id,
                )}
              </ul>
            </section>
          \`,
          html\`
            <section>
              <ul>
                \${repeat(groupB().map((x) => x), (item) => html\`<li>\${item.v}</li>\`, html\`<li>none-b</li>\`, (item) => item.id)}
              </ul>
            </section>
          \`,
        )}
      </div>
    \`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    expect(js).toContain(RUNTIME_HELPER.IF_EXPR);
  });

  test('parses cart-shaped whenElse with nested repeat and trailing comma as structural directive', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('cart-shaped-when-else', () => {
  const cartCount = signal(1);
  const products = signal([
    { id: 1, title: 'A', price: 10, cartCount: 1, image: '/a.png' },
    { id: 2, title: 'B', price: 20, cartCount: 2, image: '/b.png' },
  ]);
  const cartProducts = () => products().filter((p) => p.cartCount > 0);
  const removeItem = (_id: number) => {};
  const totalPrice = () => products().reduce((sum, p) => sum + p.price * p.cartCount, 0).toFixed(2);

  return {
    template: html\`
      <div class="cartContainer">
        \${whenElse(
          cartCount() === 0,
          html\`<p>Your cart is empty. Select some items first.</p>\`,
          html\`
            <ul class="cartList">
              \${repeat(
                cartProducts(),
                (product) => html\`
                  <li class="cartItem">
                    <img src=\${product.image} alt=\${product.title} class="cartItemImage" />
                    <div>
                      <h3>\${product.title}</h3>
                      <p>\${product.cartCount > 1 ? 'Unit Price: R' + product.price : ''}</p>
                      <p>Price: R\${(product.price * product.cartCount).toFixed(2)}</p>
                      <button class="removeButton" @click=\${() => removeItem(product.id)}>
                        \${product.cartCount === 1 ? 'Remove from Cart' : 'Remove One Item'}
                      </button>
                      <span class="cartCounter">\${product.cartCount}</span>
                    </div>
                  </li>
                \`,
                null,
                (product) => product.id,
              )}
            </ul>
          \`,
        )}
        <h2>Total Price: R\${totalPrice()}</h2>
      </div>
    \`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    expect(js).toContain(RUNTIME_HELPER.IF_EXPR);
    expect(js).not.toContain('whenElse(');
  });

  test('concise-arrow components with styles use full registration helper', async () => {
    const source = `
import { defineComponent, mount } from 'thane';

export const App = defineComponent('styled-concise', () => ({
  template: html\`<div data-testid="root">hello</div>\`,
  styles: css\`
    [data-testid="root"] { color: rgb(0, 0, 255); }
  \`,
}));

mount(App);
`;

    const js = await buildAndReadJs(source);

    expect(js).toContain(RUNTIME_HELPER.REGISTER_COMPONENT);
    expect(js).not.toContain(RUNTIME_HELPER.REGISTER_COMPONENT_LEAN);
  });

  test('style-free concise-arrow components use lean registration helper only', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('lean-concise', () => {
  const count = signal(0);
  return {
    template: html\`<button @click=\${() => count(count() + 1)}>\${count()}</button>\`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    expect(js).toContain(RUNTIME_HELPER.REGISTER_COMPONENT_LEAN);
    expect(js).not.toContain(RUNTIME_HELPER.REGISTER_COMPONENT + '(');
    expect(js).not.toContain(RUNTIME_HELPER.ENABLE_STYLES);
  });

  test('whenElse branch-root attr/style bindings are materialized in static bootstrap templates without raw interpolations', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('branch-root-attrs-app', () => {
  const show = signal(true);
  const count = signal(1);

  return {
    template: html\`
      <section>
        \${whenElse(
          show(),
          html\`<article class=\${count()} data-testid="branch-then">then-\${count()}</article>\`,
          html\`<article data-shared=\${count()} data-testid="branch-else">else-\${count()}</article>\`,
        )}
      </section>
    \`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    expect(js).not.toContain('class=${');
    expect(js).not.toContain('data-shared=${');
    expect(js).not.toMatch(/_T\d+\(`[^`]*\$\{[^`]*`\)/);
  });
});

describe('contracts-first governance guard', () => {
  test('repeat optimization skip reasons are not hard-coded in compiler outside contracts', async () => {
    const root = process.cwd();
    const compilerRoot = join(root, 'src', 'compiler');
    const files = await collectFiles(compilerRoot, (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    const rawSkipReasonLiterals = [
      "'no-bindings'",
      "'signal-bindings'",
      "'nested-repeat'",
      "'nested-conditional'",
      "'mixed-bindings'",
      "'multi-root'",
      "'path-not-found'",
    ];

    const violations: string[] = [];
    for (const filePath of files) {
      const content = await readFile(filePath, 'utf8');
      const hasViolation = rawSkipReasonLiterals.some((literal) => content.includes(literal));
      if (hasViolation) {
        violations.push(relative(root, filePath));
      }
    }

    expect(violations).toEqual([]);
  });
});
