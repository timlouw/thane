/**
 * Fragments: html`` consts of the component or the module, inlined wherever a template goes. A fragment
 * named as a whenElse() branch or a repeat() empty template is its markup (it was its name, as text), a
 * fragment can be used twice, and a child component in a fragment used twice is mounted twice.
 *
 * A fragment another module exports is written out where it is used when it has no `${}`, and is otherwise
 * mounted from the value its module compiles it into.
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

const DEV = { strictTypeCheck: false };

const KID =
  "import { defineComponent } from 'thane';\n" +
  "export const FragKid = defineComponent<{ n: number }>('frag-kid', ({ props }) => ({ template: html`<em>${props.n}</em>` }));\n";

/** A component whose setup declares `declarations` and returns `template`, built in development mode */
const build = (declarations: string, template: string): Promise<string> =>
  buildAndReadJs(
    [
      "import { defineComponent, signal, mount, html, whenElse, repeat } from 'thane';",
      "import { FragKid } from './kid.js';",
      'const spinner = html`<span class="spin"></span>`;',
      "export const App = defineComponent('frag-app', () => {",
      '  const loading = signal(true);',
      '  const rows = signal([1, 2]);',
      `  ${declarations}`,
      `  return { template: html\`${template}\` };`,
      '});',
      'mount({ component: App });',
    ].join('\n'),
    { extraFiles: { 'src/kid.ts': KID }, config: DEV },
  ).then((js) => js.slice(js.indexOf('src/main.ts')));

const componentTemplate = (js: string): string => js.match(/__tpl\d* = __T\(`([^`]*)`\)/)?.[1] ?? '';

describe('fragments are inlined wherever a template goes', () => {
  test('a whenElse() branch named by a fragment is its markup', async () => {
    const js = await build(
      'const done = html`<p class="done">${loading()}</p>`;',
      '<div>${whenElse(loading(), spinner, done)}</div>',
    );
    expect(js).toContain('__bindIfExpr(_ws_b0, _wm_b0, [loading], () => loading(), `<span class="spin"></span>`');
    expect(js).toContain('`<p class="done"><!---->true<!----></p>`');
    expect(js).not.toMatch(/`spinner`|`done`/);
  });

  test('a repeat() empty template named by a fragment is its markup', async () => {
    const js = await build(
      'const empty = html`<li class="none">none</li>`;',
      '<ul>${repeat(rows(), (r) => html`<li>${r} ${spinner}</li>`, empty)}</ul>',
    );
    expect(js).toContain('__T(`<li class="none">none</li>`)');
    // The module's fragment, inside a row
    expect(js).toContain('<li><!----> <!----> <span class="spin"></span></li>');
  });

  test('a fragment used twice is inlined twice', async () => {
    const js = await build('', '<div>${spinner}${spinner}</div>');
    expect(componentTemplate(js)).toBe('<div><span class="spin"></span><span class="spin"></span></div>');
  });

  test('a child component in a fragment used twice is mounted in each place', async () => {
    const js = await build('const kid = html`<i>${FragKid({ n: 1 })}</i>`;', '<div>${kid}<b>x</b>${kid}</div>');
    expect(componentTemplate(js)).toBe('<div><i><frag-kid></frag-kid></i><b>x</b><i><frag-kid></frag-kid></i></div>');
    expect(js.match(/FragKid\.__f\(/g)).toHaveLength(2);
  });

  test('a fragment is inlined where a template uses it, and empty as a value: nothing reads a Fragment', async () => {
    const js = await build('const kept = html`<u>k</u>`;\n  console.log(kept);', '<div>${spinner}${kept}</div>');
    // Emptied, the module's fragment is dropped by esbuild
    expect(js).not.toContain('spinner');
    expect(js).toContain('const kept = ``;');
    expect(js).toContain('<div><span class="spin"></span><u>k</u></div>');
  });

  test('an html template written as a whole ${} is inlined, and its fragments with it', async () => {
    const js = await build('', '<div>${html`<p>${spinner}${loading()}</p>`}</div>');
    expect(componentTemplate(js)).toBe('<div><p><span class="spin"></span><!---->true<!----></p></div>');
  });
});

/** src/pieces.ts: exported fragments, a static one and ones with bindings, a child component and a list */
const PIECES = [
  "import { html, signal, repeat } from 'thane';",
  "import { FragKid } from './kid.js';",
  "export const theme = signal('dark');",
  "const label = () => 'Total';",
  'export const Spinner = html`<span class="spin"></span>`;',
  'export const Badge = html`<b class=${theme()}>${label()}</b>${FragKid({ n: 2 })}`;',
  "export const Tags = html`<ul>${repeat(['a', 'b'], (t) => html`<li>${t}</li>`)}</ul>`;",
  'export const Unused = html`<i class="unused">${theme()}</i>`;',
  '',
].join('\n');

/** A component that imports the pieces, built in development mode (or the production bundle) */
const buildWithPieces = (
  imports: string,
  template: string,
  mode: 'dev' | 'prod' = 'dev',
  extraFiles: Record<string, string> = {},
): Promise<string> =>
  buildAndReadJs(
    [
      "import { defineComponent, signal, mount, html, whenElse, repeat } from 'thane';",
      imports,
      "export const App = defineComponent('frag-app', () => {",
      '  const loading = signal(true);',
      '  const rows = signal([1, 2]);',
      `  return { template: html\`${template}\` };`,
      '});',
      'mount({ component: App });',
    ].join('\n'),
    {
      extraFiles: { 'src/pieces.ts': PIECES, 'src/kid.ts': KID, ...extraFiles },
      config: { ...DEV, isProd: mode === 'prod' },
    },
  ).then((js) => (mode === 'dev' ? js.slice(js.indexOf('// .tmp-thane')) : js));

describe('fragments shared across files', () => {
  test('a fragment without ${} is written out where it is used', async () => {
    const js = await buildWithPieces(
      "import { Spinner } from './pieces.js';",
      '<div>${Spinner}${whenElse(loading(), Spinner, html``)}</div>',
    );
    expect(componentTemplate(js.slice(js.indexOf('src/main.ts')))).toBe(
      '<div><span class="spin"></span><!----><span class="spin"></span><!----><!----></div>',
    );
    expect(js).not.toContain('__mf(');
  });

  test('a fragment with bindings is compiled into a value, and mounted where it is used', async () => {
    const js = await buildWithPieces(
      "import { Badge } from './pieces.js';",
      '<div>${Badge}${whenElse(loading(), Badge, html``)}<ol>${repeat(rows(), (r) => html`<li>${r}${Badge}</li>`)}</ol></div>',
    );
    // Its module: the static template, marked pure, and the binding function, which places the copy
    // after reaching its nodes and before binding them
    expect(js).toMatch(
      /var (__frag\d+) = \/\* @__PURE__ \*\/ __T\(`<b class="dark"><!----> <!----><\/b><frag-kid><\/frag-kid>`\);\nvar Badge = \{ t: \1, b: \(_ctx, _ns\) => \{/,
    );
    const badge = js.slice(js.indexOf('var Badge'), js.indexOf('src/main.ts'));
    expect(badge.indexOf('_ns[0].firstChild.nextSibling')).toBeLessThan(badge.indexOf('_ctx.place();'));
    expect(badge.indexOf('_ctx.place();')).toBeLessThan(badge.indexOf('theme.subscribe('));
    expect(badge).toContain('__dc(FragKid.__f(_ns[1], { n: 2 }))');
    // The importer: at the top level, in a branch and in each row
    expect(js.match(/__mf\(_cma\d+, Badge\)/g)).toHaveLength(3);
  });

  test('a fragment with a list is mounted, its list with it', async () => {
    const js = await buildWithPieces("import { Tags } from './pieces.js';", '<section>${Tags}</section>');
    expect(js).toMatch(
      /var Tags = \{ t: __frag\d+, b: \(_ctx, _ns\) => \{\n\s+const _subs = \[\];\n\s+const _a_b\d+ = _ns\[0\]\.lastChild;\n\s+_ctx\.place\(\);/,
    );
    expect(js).toContain('__mf(');
  });

  test('a fragment imported through a re-export is found', async () => {
    const js = await buildWithPieces("import { Badge } from './ui.js';", '<div>${Badge}</div>', 'dev', {
      'src/ui.ts': "export * from './pieces.js';\n",
    });
    expect(js).toMatch(/__mf\(_cma\d+, Badge\)/);
  });

  test('a production bundle ships only the fragments a template uses', async () => {
    const js = await buildWithPieces(
      "import { Badge, Spinner } from './pieces.js';",
      '<div>${Spinner}${Badge}</div>',
      'prod',
    );
    expect(js).toContain('<b class="dark"><!----> <!----></b>');
    expect(js).not.toMatch(/class="unused"|<ul><!----><\/ul>|<li><\/li>/);
    // The static fragment is only in the component's template
    expect(js.match(/<span class="spin"><\/span>/g)).toHaveLength(1);
  });
});
