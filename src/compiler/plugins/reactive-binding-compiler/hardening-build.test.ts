/**
 * Compiler fixes, compiled end to end: each
 * shape is built with the real pipeline (development build, so templates are emitted as written)
 * and the emitted template or code is checked. The runtime behaviour of the same fixes is covered
 * by e2e/tests/hardening.spec.ts where a browser is needed.
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs, PROD_BUILD } from '../../testing/build-project.js';

const DEV = { config: { strictTypeCheck: false } };

/** An entry that mounts one component whose setup body is `body`. */
const app = (body: string): string => `
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
${body}
});
mount({ component: App });
`;

/** The component's static template (the `__T(\`…\`)` of `__tpl`). */
const componentTemplate = (js: string): string | undefined => /\b__tpl = __T\(`([^`]*)`\)/.exec(js)?.[1];

/** A template literal's body in the bundle, escapes included. */
const LITERAL = '`((?:\\\\[\\s\\S]|[^`\\\\])*)`';

/** The string a template literal body evaluates to, which is what the runtime hands to innerHTML. */
const cooked = (body: string | undefined): string => new Function(`return \`${body}\`;`)() as string;

describe('template text reads back as the source means it', () => {
  // Written out, the component is:
  //   const v = signal('v\\1 `2` ${3}');
  //   template: html`<div><p>C:\\dir \${notExpr} \`q\`</p><b ${when(on())}>w\\x</b><i>${v()}</i>
  //     <ul>${repeat(items(), (it) => html`<li>r\\s ${it}</li>`, { empty: html`<li>e\\q</li>` })}</ul></div>`
  const body = [
    '  const on = signal(true);',
    "  const items = signal(['a']);",
    "  const v = signal('v\\\\1 `2` ${3}');",
    '  return { template: html`<div><p>C:\\\\dir \\${notExpr} \\`q\\`</p><b ${when(on())}>w\\\\x</b><i>${v()}</i>' +
      '<ul>${repeat(items(), (it) => html`<li>r\\\\s ${it}</li>`, { empty: html`<li>e\\\\q</li>` })}</ul></div>` };',
  ].join('\n');

  test('main, when(), row and empty templates, and an initial value', async () => {
    const js = await buildAndReadJs(app(body), DEV);
    const main = cooked(new RegExp(`\\b__tpl = __T\\(${LITERAL}\\)`).exec(js)?.[1]);
    expect(main).toMatch(
      /^<div><p>C:\\dir \$\{notExpr\} `q`<\/p><!----><b>w\\x<\/b><!----><i><!---->v\\1 `2` \$\{3\}<!----><\/i><ul>/,
    );
    const whenContent = cooked(new RegExp(`__bindIf\\(_ws_b\\d+, _we_b\\d+, on, ${LITERAL}`).exec(js)?.[1]);
    expect(whenContent).toMatch(/^<b>w\\x<\/b>$/);
    expect(cooked(new RegExp(`__tpl_b\\d+ = __T\\(${LITERAL}\\)`).exec(js)?.[1])).toMatch(
      /^<li>r\\s <!----> <!----><\/li>$/,
    );
    expect(cooked(new RegExp(`\\?\\?= __T\\(${LITERAL}\\)`).exec(js)?.[1])).toBe('<li>e\\q</li>');
    // `notExpr` is text, not a binding: nothing reads it
    expect(js).not.toMatch(/[^{]notExpr/);
  });

  test('an escape that is invalid outside a tagged template is shown as written', async () => {
    // html`<p>C:\users \x1 \u12 \u{zz} \08 \9 ok</p>` is valid source (a tagged template may hold
    // invalid escapes), but each of these fails in the untagged literal the template is emitted into
    const source = app(
      '  return { template: html`<p>C:\\users \\x1 \\u12 \\u{zz} \\08 \\9 ok \\u0041 \\x42 \\0</p>` };',
    );
    const js = await buildAndReadJs(source, DEV);
    const main = cooked(new RegExp(`\\b__tpl = __T\\(${LITERAL}\\)`).exec(js)?.[1]);
    expect(main).toBe('<p>C:\\users \\x1 \\u12 \\u{zz} \\08 \\9 ok A B \0</p>');
    // A production build minifies the template before emitting it, through the same escaper
    const prod = await buildAndReadJs(source, { config: { ...PROD_BUILD } });
    expect(prod).toContain('C:\\\\users \\\\x1');
  });
});

describe('whitespace inside verbatim elements', () => {
  const body = [
    '  const on = signal(true);',
    "  const items = signal(['a']);",
    '  return { template: html`<div>\n  <pre>p 1\n    p 2</pre>\n  <p ${when(on())}><textarea>t 1\n  t 2</textarea></p>\n' +
      '  ${when(on(), html`<pre>w 1\n  w 2</pre>`, html`<i>e</i>`)}\n' +
      '  <ul>${repeat(items(), (it) => html`<li><pre>r 1\n  ${it}</pre></li>`, { empty: html`<li><pre>x 1\n  x 2</pre></li>` })}</ul>\n</div>` };',
  ].join('\n');

  for (const mode of ['dev', 'prod'] as const) {
    test(`main, when(), when(), row and empty templates (${mode})`, async () => {
      const js = await buildAndReadJs(app(body), { ...DEV, config: { ...DEV.config, isProd: mode === 'prod' } });
      const literals = [...js.matchAll(new RegExp(LITERAL, 'g'))].map((m) => cooked(m[1]));
      const all = literals.join('\n');
      for (const kept of ['<pre>p 1\n    p 2</pre>', '<textarea>t 1\n  t 2</textarea>', '<pre>x 1\n  x 2</pre>']) {
        expect(all).toContain(kept);
      }
      expect(all).toMatch(/<pre>w 1\n {2}w 2<\/pre>/);
      expect(all).toMatch(/<pre>r 1\n {2}<!----> <!----><\/pre>/);
      // whitespace between other elements still collapses
      expect(all).toContain('<ul>');
      expect(all).not.toMatch(/<\/p>\s+<ul>|<ul>\s+</);
    });
  }
});

describe('quote-aware expression scanning', () => {
  test('rows with braces in strings or two levels deep, and a branch with an escaped backtick', async () => {
    const body = [
      '  const on = signal(true);',
      '  const items = signal([{ on: true, a: 1 }]);',
      '  const fmt = (o: unknown) => JSON.stringify(o);',
      "  return { template: html`<div><ul>${repeat(items(), (it) => html`<li>${it.on ? '}' : '{'}</li>`)}</ul>" +
        '<ol>${repeat(items(), (it) => html`<li>${fmt({ a: { b: it.a } })}</li>`)}</ol>' +
        '${when(on(), html`<i>\\`</i>`, html`<b>{</b>`)}</div>` };',
    ].join('\n');
    const js = await buildAndReadJs(app(body), DEV);
    const rows = [...js.matchAll(new RegExp(`__tpl_b\\d+ = __T\\(${LITERAL}\\)`, 'g'))].map((m) => cooked(m[1]));
    expect(rows).toEqual(['<li></li>', '<li></li>']);
    expect(js).toMatch(/it\.on \? ["']\}["'] : ["']\{["']/);
    expect(js).toContain('fmt({ a: { b: it.a } })');
    const branch = cooked(
      new RegExp(`__bindIfExpr\\(_ws_b\\d+, _wm_b\\d+, \\[on\\], \\(\\) => on\\(\\), ${LITERAL}`).exec(js)?.[1],
    );
    expect(branch).toMatch(/^<i>`<\/i>$/);
    expect(js).not.toMatch(/\bwhenElse\(/);
  });
});

describe('child components in the rows of a list inside a directive', () => {
  // A name of its own: the build context scans the whole working directory, where the hardening app
  // has a `Kid` too
  const kid =
    "import { defineComponent } from 'thane';\nexport const H40Kid = defineComponent<{ label: string }>('x-h40-kid', ({ props }) => ({ template: html`<b>${props.label}</b>` }));\n";
  const withKid = (template: string): string =>
    `import { defineComponent, signal, mount } from 'thane';\nimport { H40Kid } from './kid.js';\n` +
    `export const App = defineComponent('test-app', () => {\n  const on = signal(true);\n  const items = signal([{ id: 1, n: 'a' }]);\n  return { template: html\`${template}\` };\n});\nmount({ component: App });\n`;

  for (const [shape, template] of [
    [
      'a when()',
      '<div ${when(on())}><ul>${repeat(items(), (it) => html`<li>${H40Kid({ label: it.n })}</li>`)}</ul></div>',
    ],
    [
      'a when() branch nested in a when()',
      '<div ${when(on())}>${when(on(), html`<ul>${repeat(items(), (it) => html`<li>${H40Kid({ label: it.n })}</li>`)}</ul>`, html`<p>no</p>`)}</div>',
    ],
  ] as const) {
    test(`inside ${shape}: the row factory mounts the child with the row's item`, async () => {
      const js = await buildAndReadJs(withKid(template), { ...DEV, extraFiles: { 'src/kid.ts': kid } });
      // The mount is in the row factory (the row element `_el` holds the child's host, reached by
      // path) and reads the row's item, which the row's update gives it again
      expect(js).toMatch(
        /const (_cm\d+) = _el\.(?:first|last)ElementChild;[\s\S]*__rc\(H40Kid, \1, \{ label: it\.n \}\)/,
      );
      expect(js).not.toMatch(/querySelector\("#/);
      // and nothing looks for the anchor at component level
      expect(js).not.toMatch(/_gid\("b\d+"\)\.replaceWith/);
    });
  }
});

describe('a row that is a component call with a template literal in its props', () => {
  test('the props are emitted as written', async () => {
    const card =
      "import { defineComponent } from 'thane';\nexport const H44Card = defineComponent<{ label: string }>('x-h44-card', ({ props }) => ({ template: html`<b>${props.label}</b>` }));\n";
    const js = await buildAndReadJs(
      "import { defineComponent, signal, mount } from 'thane';\nimport { H44Card } from './card.js';\n" +
        "export const App = defineComponent('test-app', () => {\n  const rows = signal([{ id: 1, label: 'a' }]);\n" +
        '  return { template: html`<ul>${repeat(rows(), (item) => H44Card({ label: `x${item.label}` }))}</ul>` };\n});\nmount({ component: App });\n',
      { ...DEV, extraFiles: { 'src/card.ts': card } },
    );
    expect(js).toContain('__rc(H44Card, _el, { label: `x${item.label}` })');
    // The update's item is renamed by the bundler, as it shadows the factory's
    expect(js).toMatch(/_cd\.u\(\{ label: `x\$\{item2?\.label\}` \}\)/);
    expect(js).not.toMatch(/item\$|<!--i\d+-->/);
  });
});

describe("when() on a repeat() row's root element", () => {
  const rows = (row: string): string =>
    app(
      "  const on = signal(true);\n  const items = signal([{ id: 1, on: true, n: 'a' }]);\n" +
        `  return { template: html\`<ul>\${repeat(items(), (it) => html\`${row}\`, { key: "id" })}</ul>\` };`,
    );
  const message =
    "THANE008: a repeat() row's root element cannot carry when(); filter the list, or put when() on an inner element.";

  for (const [shape, row] of [
    ['on the row item', '<li ${when(it.on)}>${it.n}</li>'],
    ['on a component signal', '<li class="r" ${when(on())}>${it.n}</li>'],
  ] as const) {
    test(`is a build error, ${shape}`, async () => {
      await expect(buildAndReadJs(rows(row), DEV)).rejects.toThrow(message);
    });
  }

  test('on an inner element it still builds', async () => {
    const js = await buildAndReadJs(rows('<li><b ${when(it.on)}>${it.n}</b></li>'), DEV);
    expect(js).toMatch(/__bindIf/);
  });
});

describe('duplicate attributes', () => {
  test('the first of two is kept: a bound first keeps its binding, a bound second leaves nothing live', async () => {
    const js = await buildAndReadJs(
      app(
        '  const c = signal(true);\n  const d = signal(false);\n' +
          '  return { template: html`<div><input class="k" checked=${c()} checked><button disabled disabled=${d()}>b</button></div>` };',
      ),
      DEV,
    );
    expect(js).toMatch(/\.checked = c\(\)/);
    expect(js).not.toMatch(/\.disabled = /);
    const main = cooked(new RegExp(`\\b__tpl = __T\\(${LITERAL}\\)`).exec(js)?.[1]);
    expect(main).toMatch(/^<div><input class="k" checked><button disabled disabled=\$\{d\(\)\}>b<\/button><\/div>$/);
  });

  test('the duplicate is reported once for every template it is in: component, when() branch and row', async () => {
    const logged: string[] = [];
    const capture = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
    const { info, log, warn } = console;
    console.info = capture;
    console.log = capture;
    console.warn = capture;
    try {
      await buildAndReadJs(
        app(
          '  const on = signal(true);\n  const rows = signal([1]);\n' +
            '  return { template: html`<div><p title="a" title="b">c</p>' +
            '<section ${when(on())}><i lang="a" lang="b">w</i></section>' +
            '${when(on(), html`<b dir="a" dir="b">t</b>`, html`<u>e</u>`)}' +
            '<ul>${repeat(rows(), (r) => html`<li id="a" id="b">${r}</li>`)}</ul></div>` };',
        ),
        DEV,
      );
    } finally {
      console.info = info;
      console.log = log;
      console.warn = warn;
    }
    const duplicates = logged.filter((line) => line.includes('Duplicate attribute'));
    const count = (name: string) => duplicates.filter((line) => line.includes(`"${name}"`)).length;
    expect([count('title'), count('lang'), count('dir'), count('id')]).toEqual([1, 1, 1, 1]);
  });
});

describe('a literal < in template text', () => {
  test('text and bindings after the < keep their places', async () => {
    const js = await buildAndReadJs(
      app(
        '  const x = signal(5);\n  return { template: html`<div><p>1 < 2 ${x()}</p><b>a <= b is ${x() + 1} ok</b></div>` };',
      ),
      DEV,
    );
    expect(componentTemplate(js)).toMatch(
      /^<div><p>1 < 2 <!---->5<!----><\/p><b>a <= b is <!----> <!----> ok<\/b><\/div>$/,
    );
  });
});

describe('whitespace between a tag and an anchor comment', () => {
  // Anchors stand where <template> placeholders stood: the whitespace between a tag and an anchor goes
  // as it does between two tags, so a list's container holds only its rows and its anchor (the
  // reconciler then clears it at once). Whitespace before a text marker is text and stays.
  const body =
    "  const on = signal(true);\n  const t = signal('t');\n  const items = signal(['a']);\n" +
    '  return { template: html`<div>\n  <table><tbody>\n    ${repeat(items(), (it) => html`<tr><td>${it}</td></tr>`)}\n  </tbody></table>\n' +
    '  <span>a</span> <i ${when(on())}>w</i> <b>b</b> ${when(on(), html`<u>y</u>`, html`<s>n</s>`)} text ${t()}\n</div>` };';
  for (const mode of ['dev', 'prod'] as const) {
    test(`a list, a when() and a when() after tags; a text binding after text (${mode})`, async () => {
      const js = await buildAndReadJs(app(body), { ...DEV, config: { ...DEV.config, isProd: mode === 'prod' } });
      // the component template, as emitted (no quote or backslash in it, so the same in both modes)
      expect(js).toContain(
        '<div><table><tbody><!----></tbody></table><span>a</span><!----><i>w</i><!----><b>b</b><!----><u>y</u><!----><!----> text <!---->t<!----></div>',
      );
    });
  }
});
