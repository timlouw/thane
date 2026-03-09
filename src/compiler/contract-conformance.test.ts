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

const buildConfig = (project: {
  entryPath: string;
  outDir: string;
  htmlPath: string;
}): {
  entryPoints: string[];
  outDir: string;
  inputHTMLFilePath: string;
  outputHTMLFilePath: string;
  isProd: boolean;
  serve: boolean;
  useGzip: boolean;
  strictTypeCheck: boolean;
  dropConsole: boolean;
  dropDebugger: boolean;
  sourcemap: boolean;
  port: number;
  open: boolean;
  host: string;
  base: string;
  target: string[];
  hashFileNames: boolean;
  define: Record<string, string>;
  envPrefix: string;
  emptyOutDir: boolean;
  splitting: boolean;
  legalComments: 'none';
  analyze: boolean;
} => ({
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
  legalComments: 'none' as const,
  analyze: false,
});

const buildAndReadJs = async (source: string, opts?: { prod?: boolean }): Promise<string> => {
  const project = await makeProject(source);
  try {
    const config = buildConfig(project);
    if (opts?.prod) {
      config.isProd = true;
      config.sourcemap = false;
    }
    await runBuild(config);

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

  test('non-signal prop expressions are compiled into update functions and not left raw in templates', async () => {
    const source = `
import { defineComponent, mount } from 'thane';

export const App = defineComponent<{ title: string; subtitle: string }>('prop-display', ({ props }) => ({
  template: html\`
    <div>
      <h1>\${props.title}</h1>
      <p>\${props.subtitle}</p>
    </div>
  \`,
}));

mount(App, { target: document.body, props: { title: 'Hello', subtitle: 'World' } });
`;

    const js = await buildAndReadJs(source);

    // Non-signal expressions must NOT appear as raw template interpolations
    expect(js).not.toContain('${props.title}');
    expect(js).not.toContain('${props.subtitle}');
    // Template must be a static string with no unresolved expressions
    expect(js).not.toMatch(/__tpl\d+\s*=\s*_T\d+\(`[^`]*\$\{[^`]*`\)/);
    // Should contain update logic referencing props.title and props.subtitle
    expect(js).toContain('props.title');
    expect(js).toContain('props.subtitle');
  });

  test('non-signal attribute expressions are compiled into setAttribute calls', async () => {
    const source = `
import { defineComponent, mount } from 'thane';

export const App = defineComponent<{ url: string; label: string }>('link-card', ({ props }) => ({
  template: html\`
    <a href=\${props.url}>\${props.label}</a>
  \`,
}));

mount(App, { target: document.body, props: { url: '/home', label: 'Go Home' } });
`;

    const js = await buildAndReadJs(source);

    // Raw attribute interpolation must not survive in the template
    expect(js).not.toContain('href=${');
    // Should compile to setAttribute call
    expect(js).toContain('setAttribute');
    expect(js).toContain('props.url');
  });

  test('event handler function calls are wrapped to prevent immediate invocation at bind-time', async () => {
    const source = `
import { defineComponent, mount } from 'thane';

const navigate = (path: string) => { console.log(path); };

export const App = defineComponent('nav-app', () => ({
  template: html\`
    <nav>
      <button @click=\${navigate('/home')}>Home</button>
      <button @click=\${navigate('/about')}>About</button>
    </nav>
  \`,
}));

mount(App);
`;

    const js = await buildAndReadJs(source);

    // The navigate calls must NOT appear as direct arguments to addEventListener
    // They should be wrapped in arrow functions: () => { navigate('/home'); }
    expect(js).not.toMatch(/addEventListener\(\s*["']click["']\s*,\s*navigate\(/);
    // The compiled output should contain the navigate calls inside wrapper functions
    expect(js).toContain('navigate(');
    // Confirm addEventListener is present
    expect(js).toContain('addEventListener');
  });

  test('event handler function calls with modifiers are wrapped correctly', async () => {
    const source = `
import { defineComponent, mount } from 'thane';

const doAction = (id: number) => {};

export const App = defineComponent('modifier-app', () => ({
  template: html\`
    <form>
      <button @click.prevent=\${doAction(42)}>Submit</button>
    </form>
  \`,
}));

mount(App);
`;

    const js = await buildAndReadJs(source);

    // With .prevent modifier, the handler should still not be called immediately
    expect(js).toContain('preventDefault');
    expect(js).toContain('doAction(42)');
    // The function call must not be the direct second argument to addEventListener
    expect(js).not.toMatch(/addEventListener\(\s*["']click["']\s*,\s*doAction\(/);
  });

  test('repeat over computed source generates valid subscription without empty expressions', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('computed-repeat-app', () => {
  const allItems = signal([
    { id: 1, name: 'A', active: true },
    { id: 2, name: 'B', active: false },
    { id: 3, name: 'C', active: true },
  ]);
  const activeItems = () => allItems().filter((i) => i.active);

  return {
    template: html\`
      <ul>
        \${repeat(activeItems(), (item) => html\`<li>\${item.name}</li>\`, html\`<li>none</li>\`, (item) => item.id)}
      </ul>
    \`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    // Must generate valid code — no empty expression assignments like "= ();"
    expect(js).not.toMatch(/=\s*\(\s*\)\s*;/);
    // Must contain the keyed reconciler
    expect(js).toContain(RUNTIME_HELPER.KEYED_RECONCILER);
  });

  test('whenElse nested inside repeat does not produce invalid empty-expression codegen', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('nested-when-repeat-app', () => {
  const groups = signal([
    { id: 1, label: 'X', important: true },
    { id: 2, label: 'Y', important: false },
  ]);

  return {
    template: html\`
      <section>
        <ul>
          \${repeat(
            groups(),
            (group) => html\`
              <li>
                \${whenElse(
                  group.important,
                  html\`<strong>\${group.label}</strong>\`,
                  html\`<em>\${group.label}</em>\`,
                )}
              </li>
            \`,
            html\`<li>empty</li>\`,
            (group) => group.id,
          )}
        </ul>
      </section>
    \`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    // The specific regression: whenElse inside repeat produced ".data = ();" or "= ();"
    expect(js).not.toMatch(/\.data\s*=\s*\(\s*\)\s*;/);
    expect(js).not.toMatch(/=\s*\(\s*\)\s*;/);
    // Must still compile the keyed reconciler and conditional helpers
    expect(js).toContain(RUNTIME_HELPER.KEYED_RECONCILER);
    expect(js).toContain(RUNTIME_HELPER.IF_EXPR);
  });

  test('expression bindings with signals inside when directives emit explicit initial call', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('when-initial-app', () => {
  const product = signal({ cartCount: 2, name: 'Widget' });

  return {
    template: html\`
      <div>
        <span \${when(product().cartCount > 0)}>\${product().cartCount}</span>
      </div>
    \`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    // The regression: expression bindings inside when directives with signal dependencies
    // were subscribed with skipInitial=true but never got an explicit initial _upd() call,
    // leaving the text node blank on first render.
    // The fix ensures the update function is called before the subscribe return.
    expect(js).toContain(RUNTIME_HELPER.IF_EXPR);
    // Verify the initNested calls the updater before returning the subscription.
    // Pattern: "_upd_..._0();\n        return ["  (explicit call before return)
    expect(js).toMatch(/_upd_\w+\(\);\s*return\s*\[/);
    // Must NOT have an initNested that returns subscriptions without the explicit initial call
    // (i.e. "return [\n  product.subscribe" with no _upd call before it)
    const initNestedBodies = js.match(/\(\)\s*=>\s*\{[^}]*nextSibling\.data[^]*?return\s*\[/g) || [];
    for (const body of initNestedBodies) {
      expect(body).toMatch(/_upd_\w+\(\)/);
    }
  });

  test('when directives inside repeat items within whenElse generate __bindIfExpr calls', async () => {
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('when-in-repeat-app', () => {
  const cartCount = signal(2);
  const products = signal([
    { id: 1, title: 'A', price: 10, cartCount: 2, image: '/a.png' },
    { id: 2, title: 'B', price: 20, cartCount: 0, image: '/b.png' },
  ]);
  const cartProducts = () => products().filter((p) => p.cartCount > 0);
  const removeItem = (_id: number) => {};

  return {
    template: html\`
      <div>
        \${whenElse(
          cartCount() === 0,
          html\`<p>Empty cart</p>\`,
          html\`
            <ul>
              \${repeat(
                cartProducts(),
                (product) => html\`
                  <li>
                    <span>\${product.title}</span>
                    <span \${when(product.cartCount > 1)}>\${product.cartCount}</span>
                    <button @click=\${() => removeItem(product.id)}>Remove</button>
                  </li>
                \`,
                null,
                (product) => product.id,
              )}
            </ul>
          \`,
        )}
      </div>
    \`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source);

    // The regression: when directives inside repeat items within a whenElse else block
    // were not generating __bindIfExpr calls at all — the <template> anchors were rendered
    // but never activated, so the conditional content never appeared.
    expect(js).toContain(RUNTIME_HELPER.IF_EXPR);
    // The compiled output must contain __bindIfExpr calls within the repeat render loop
    // (inside the whenElse initNested that hosts the repeat).
    // Count total occurrences — at minimum: the outer whenElse (2) + the inner when (1)
    const ifExprCount = (js.match(new RegExp(RUNTIME_HELPER.IF_EXPR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [])
      .length;
    expect(ifExprCount).toBeGreaterThanOrEqual(3);
  });

  test('injected script tags use absolute paths not relative paths', async () => {
    // Verify the post-build processor generates absolute paths (base-relative, not ./ relative).
    // The regression: src="./main-XXX.js" caused 404 on nested routes like /product-details/1.
    const processorSource = await readFile(
      join(process.cwd(), 'src', 'compiler', 'plugins', 'post-build-processor', 'post-build-processor.ts'),
      'utf8',
    );
    // Must NOT contain the old relative "./" prefix pattern for script src
    expect(processorSource).not.toMatch(/src="\.\//);
    // Must use config.base (or a basePath derived from it) for the script src
    expect(processorSource).toMatch(/basePath/);
    expect(processorSource).toMatch(/config\.base/);
  });

  test('non-router build tree-shakes route context factory', async () => {
    // When routing is NOT used, the fallback route context factory (createFallbackRouteContext)
    // and its window.location / document.title reads should NOT appear in the bundle.
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('treeshake-app', () => {
  const count = signal(0);
  return {
    template: html\`<button @click=\${() => count(count() + 1)}>\${count()}</button>\`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source, { prod: true });

    // Route context factory includes these patterns — none should be present
    expect(js).not.toContain('location.pathname');
    expect(js).not.toContain('location.search');
    expect(js).not.toContain('location.hash');
    expect(js).not.toContain('history.state');
    expect(js).not.toContain('document.title');
    expect(js).not.toContain('searchParams');
  });

  test('non-router build tree-shakes __setRouteContextProvider', async () => {
    // __setRouteContextProvider and the route provider mechanism should be absent
    // when routing is not imported.
    const source = `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('no-route-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  return {
    template: html\`
      <ul>
        \${repeat(items(), (item) => html\`<li>\${item.label}</li>\`, null, (item) => item.id)}
      </ul>
    \`,
  };
});

mount(App);
`;

    const js = await buildAndReadJs(source, { prod: true });

    // The route context provider setter should be tree-shaken
    expect(js).not.toContain('setRouteContextProvider');
    // But the component should still work — verify core runtime is present
    expect(js).toContain('classList');
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
