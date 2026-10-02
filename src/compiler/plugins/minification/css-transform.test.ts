import { describe, expect, spyOn, test } from 'bun:test';
import ts from 'typescript';
import { buildAndReadJs } from '../../testing/build-project.js';
import {
  compileCssTemplate,
  countCssClass,
  declaresOwnCssTag,
  isCssTaggedTemplate,
  renameCssClasses,
  transformCss,
} from './css-transform.js';
import { minifyCSS, minifyHTML } from './template-minifier.js';
import { SelectorMap } from './selector-minifier.js';
import { scopeCssRules } from '../../../runtime/component.js';

const mapOf = (...selectors: string[]): SelectorMap => {
  const map = new SelectorMap();
  for (const selector of selectors) map.register(selector);
  return map;
};

/** Compile the first css`` template of a source text. */
const compile = (source: string, options: Parameters<typeof compileCssTemplate>[2]): string => {
  const sourceFile = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found: ts.TaggedTemplateExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (isCssTaggedTemplate(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error('no css template in the fixture');
  return compileCssTemplate(found, sourceFile, options);
};

describe('minifyCSS', () => {
  test('removes comments, line breaks and the spaces CSS never needs', () => {
    expect(minifyCSS('/* note */\n.a ,\n.b > .c {\n  color : red ;\n  margin: 0 auto;\n}\n')).toBe(
      '.a,.b>.c{color :red;margin:0 auto}',
    );
  });

  test('keeps the spaces calc() needs around + and -', () => {
    expect(minifyCSS('.a { width: calc(100% - 2 * (1px + 2px)); }')).toBe('.a{width:calc(100% - 2 * (1px + 2px))}');
  });

  test('keeps the descendant combinator in front of a pseudo-class', () => {
    expect(minifyCSS('.a :hover { color: red; }')).toBe('.a :hover{color:red}');
    expect(minifyCSS('.a:hover { color: red; }')).toBe('.a:hover{color:red}');
  });

  test('copies quoted strings verbatim', () => {
    expect(minifyCSS('.a::before { content: "a  {  b }  /* c */"; }')).toBe('.a::before{content:"a  {  b }  /* c */"}');
    expect(minifyCSS(".a { font-family: 'My  Font' , serif; }")).toBe(".a{font-family:'My  Font',serif}");
  });

  test('keeps media query conditions intact', () => {
    expect(minifyCSS('@media (min-width: 600px) and (max-width: 900px) { .a { color: red; } }')).toBe(
      '@media (min-width:600px) and (max-width:900px){.a{color:red}}',
    );
  });
});

describe('minifyHTML', () => {
  test('collapses whitespace between elements and inside text', () => {
    expect(minifyHTML('\n  <div>\n    <p>Body   text</p>\n  </div>\n')).toBe('<div><p>Body text</p></div>');
  });

  test('carries preformatted text through exactly as written', () => {
    expect(minifyHTML('<div>\n  <pre>line 1\n    line 2</pre>\n  <p>a   b</p>\n</div>')).toBe(
      '<div> <pre>line 1\n    line 2</pre> <p>a b</p></div>',
    );
    const form = '<textarea>\n  keep\n</textarea>';
    expect(minifyHTML(form)).toBe(form);
  });

  test('never reads an inline script or stylesheet as HTML', () => {
    const script = '<script>\n  // a comment ends at the line break\n  start();\n</script>';
    const style = '<style>\n  .a > .b { width: calc(1px + 2px); }\n</style>';
    const page = `<head>\n  ${script}\n  ${style}\n</head>`;
    const minified = minifyHTML(page);
    expect(minified).toContain(script);
    expect(minified).toContain(style);
  });

  test('keeps binding markers and drops ordinary comments', () => {
    const minified = minifyHTML('<div>\n  <!--b12--> <!---->\n  <!-- dev note -->\n</div>');
    expect(minified).toContain('<!--b12--> <!---->');
    expect(minified).not.toContain('dev note');
  });
});

describe('CSS class renaming', () => {
  test('renames class selectors and nothing else', () => {
    const css = [
      '.my-card { color: red; }',
      '.my-card.active > .my-card-title { }',
      'my-card { }',
      '#my-card { }',
      '[data-x="my-card"] { }',
      '.other::after { content: ".my-card"; }',
      '.bg { background: url(/img/photo.my-card.png); }',
      '.bg2 { background: url("/img/.my-card"); }',
      '/* .my-card in a comment */',
    ].join('\n');
    const renamed = renameCssClasses(css, (name) => (name === 'my-card' ? 'a-a' : undefined));
    expect(renamed).toBe(
      [
        '.a-a { color: red; }',
        '.a-a.active > .my-card-title { }',
        'my-card { }',
        '#my-card { }',
        '[data-x="my-card"] { }',
        '.other::after { content: ".my-card"; }',
        '.bg { background: url(/img/photo.my-card.png); }',
        '.bg2 { background: url("/img/.my-card"); }',
        '/* .my-card in a comment */',
      ].join('\n'),
    );
    expect(countCssClass(css, 'my-card')).toBe(2);
  });

  test('a class name continued by a substitution is not that class', () => {
    expect(countCssClass('.my-card${size} { }', 'my-card')).toBe(0);
    expect(countCssClass('.my-card ${rest}', 'my-card')).toBe(1);
  });

  test('transformCss returns the text untouched when there is nothing to do', () => {
    const css = '.a {\n  color: red;\n}\n';
    expect(transformCss(css, {})).toBe(css);
    expect(transformCss(css, { minify: false, selectorMap: new SelectorMap() })).toBe(css);
  });
});

describe('compileCssTemplate', () => {
  test('a development build only drops the tag', () => {
    expect(compile('const s = css`\n  .a { color: red; }\n`;', {})).toBe('`\n  .a { color: red; }\n`');
  });

  test('substitutions are carried over untouched, whatever they contain', () => {
    const source =
      "const s = css`\n  .a {\n    color: ${dark ? '}  {  ;' : `x   ${y}   z`};\n    margin: ${a} ${b};\n  }\n`;";
    expect(compile(source, { minify: true })).toBe("`.a{color:${dark ? '}  {  ;' : `x   ${y}   z`};margin:${a} ${b}}`");
  });

  test('escape sequences stay exactly as written', () => {
    const source = 'const s = css`.a::before { content: "\\\\201C"; }`;';
    expect(source).toContain('"\\\\201C"');
    expect(compile(source, { minify: true })).toBe('`.a::before{content:"\\\\201C"}`');
  });

  test('host classes are renamed around substitutions', () => {
    const source = 'const s = css`.my-card { color: ${c}; } .my-card${suffix} { } .x { content: ".my-card"; }`;';
    expect(compile(source, { selectorMap: mapOf('my-card') })).toBe(
      '`.a-a { color: ${c}; } .my-card${suffix} { } .x { content: ".my-card"; }`',
    );
  });

  test('a css template nested in a substitution is compiled too', () => {
    const source = 'const s = css`.a { } ${on ? css`.b {  color: red;  }` : ""}`;';
    expect(compile(source, { minify: true })).toBe('`.a{}${on ? `.b{color:red}` : ""}`');
  });
});

describe('(ii): :host-context(X) becomes X &', () => {
  test('in every build, before the runtime scoper sees it', () => {
    const css = ':host-context(.dark) .title { color: red; }';
    expect(transformCss(css, {})).toBe('.dark & .title { color: red; }');
    expect(transformCss(css, { minify: true })).toBe('.dark & .title{color:red}');
    expect(scopeCssRules(transformCss(css, {}), '.my-card')).toBe('.dark .my-card .title{ color: red; }');
  });

  test('in one member of a selector list, on its own, and with a pseudo-class after it', () => {
    expect(transformCss('.a, :host-context(body.dark) .b { }', {})).toBe('.a, body.dark & .b { }');
    expect(transformCss(':host-context(.dark) { }', {})).toBe('.dark & { }');
    expect(transformCss(':host-context(.dark):hover .a { }', {})).toBe('.dark &:hover .a { }');
    expect(transformCss('@media (min-width: 1px) { :host-context(.x) .a { } :host-context(.y) .b { } }', {})).toBe(
      '@media (min-width: 1px) { .x & .a { } .y & .b { } }',
    );
  });

  test('the argument ends at its matching parenthesis, skipping strings', () => {
    expect(transformCss(':host-context(:not([data-x=")"])) .a { }', {})).toBe(':not([data-x=")"]) & .a { }');
  });

  test('strings are left alone, and so is an unclosed argument (comments go)', () => {
    const untouched = [
      '.a::before { content: ":host-context(.x)"; }',
      ".a { background: url(':host-context(.x)'); }",
      ':host-context(.x .a { }',
    ];
    for (const css of untouched) expect(transformCss(css, {})).toBe(css);
  });

  test('a css template: the argument may be a substitution', () => {
    expect(compile('const s = css`:host-context(${theme}) .a { color: ${c}; }`;', {})).toBe(
      '`${theme} & .a { color: ${c}; }`',
    );
  });
});

describe('(iii): comments go in a development build too', () => {
  const css = ".a {\n  /* it's a note */\n  color: blue;\n}\n.b { color: red; }\n";

  test('each comment becomes a space, and the runtime scoper then scopes every rule', () => {
    expect(transformCss(css, {})).toBe('.a {\n   \n  color: blue;\n}\n.b { color: red; }\n');
    // with the comment left in, the scoper returns the stylesheet unscoped
    expect(scopeCssRules(css, '.sel')).toBe(css);
    expect(scopeCssRules(transformCss(css, {}), '.sel')).toBe(
      '.sel .a{\n   \n  color: blue;\n}.sel .b{ color: red; }\n',
    );
  });

  test('comment openers inside strings and unquoted url() values stay', () => {
    const untouched = ['.a::before { content: "/* x */"; }', '.a { background: url(/img/*.png); } .b { }'];
    for (const text of untouched) expect(transformCss(text, {})).toBe(text);
  });

  test('every comment goes, whatever it holds', () => {
    expect(transformCss('/* :host-context(.x) */ .a { } /* a */ /* b */', {})).toBe('  .a { }    ');
    expect(transformCss('.a { } /* unclosed', {})).toBe('.a { }  ');
  });

  test('a production build is unchanged: the minifier drops them', () => {
    expect(transformCss(css, { minify: true })).toBe(minifyCSS(css));
  });
});

describe('statement at-rules never reach the runtime scoper', () => {
  /** transformCss with console.warn captured. */
  const transform = (css: string, options: Parameters<typeof transformCss>[1] = {}) => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      return { css: transformCss(css, options), warnings: warn.mock.calls.map((c) => c.join(' ')) };
    } finally {
      warn.mockRestore();
    }
  };

  test('@layer statements become empty @layer blocks, in the order declared', () => {
    expect(transform('@layer base; .a { color: red; }').css).toBe('@layer base{} .a { color: red; }');
    expect(transform('@layer reset, base,\n  theme.dark;\n.a { }').css).toBe(
      '@layer reset{}@layer base{}@layer theme.dark{}\n.a { }',
    );
    expect(transform('@layer base; .a { color: red; }', { minify: true }).css).toBe('@layer base{}.a{color:red}');
    // the runtime scoper then scopes the rule after it
    expect(scopeCssRules(transform('@layer base; .a { color: red; }').css, '.sel')).toBe(
      '@layer base{}.sel .a{ color: red; }',
    );
  });

  test('@charset goes silently; @import goes with a warning naming the file and the rule', () => {
    expect(transform('@charset "UTF-8";\n.a { }')).toEqual({ css: '\n.a { }', warnings: [] });
    const { css, warnings } = transform('@import url("x.css") layer(base) supports(display: grid);\n.a { }', {
      file: 'src/card.css',
    });
    expect(css).toBe('\n.a { }');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'src/card.css: @import url("x.css") layer(base) supports(display: grid); was removed. Thane applies every ' +
        'stylesheet as a constructed stylesheet, and browsers ignore @import there: load that file with a ' +
        '<link> in index.html instead.',
    );
    expect(transform("@import 'y.css'; .a { }").css).toBe(' .a { }');
  });

  test('inside a block, in any case of the name', () => {
    expect(transform('@media (min-width: 1px) { @layer a; .b { } }').css).toBe(
      '@media (min-width: 1px) { @layer a{} .b { } }',
    );
    expect(transform('@LAYER a; .b { }').css).toBe('@layer a{} .b { }');
  });

  test('@namespace stays, followed by an empty block, so the rule after it is scoped', () => {
    const css = '@namespace svg url(http://www.w3.org/2000/svg); svg|rect { fill: red; } .a { }';
    expect(transform(css).css).toBe('@namespace svg url(http://www.w3.org/2000/svg);{} svg|rect { fill: red; } .a { }');
    expect(transform(css, { minify: true }).css).toBe(
      '@namespace svg url(http://www.w3.org/2000/svg);{}svg|rect{fill:red}.a{}',
    );
    expect(scopeCssRules(transform(css).css, '.sel')).toBe(
      '@namespace svg url(http://www.w3.org/2000/svg);{}.sel svg|rect{ fill: red; }.sel .a{ }',
    );
  });

  test('blocks, strings and look-alike names are left alone', () => {
    const untouched = [
      '@layer base { .a { } }',
      '.a::before { content: "@import x; @layer y;"; }',
      '@layer-x a; .b { }',
      '@importer a; .b { }',
      '@layer a',
    ];
    for (const css of untouched) expect(transform(css)).toEqual({ css, warnings: [] });
  });

  test('a css template: the layer name may be a substitution', () => {
    expect(compile('const s = css`@layer ${name}; .a { color: ${c}; }`;', {})).toBe(
      '`@layer ${name}{} .a { color: ${c}; }`',
    );
  });

  test('build-through: css`` and an imported .css file both come out scoped after @layer', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    let js = '';
    let warnings: string[] = [];
    try {
      js = await buildAndReadJs(
        "import { mount } from 'thane';\nimport { Lt } from './lt.js';\nimport { Lf } from './lf.js';\n" +
          "mount(Lt, { target: document.getElementById('app')! });\n" +
          "mount(Lf, { target: document.getElementById('app')! });\n",
        {
          config: { strictTypeCheck: false },
          extraFiles: {
            'src/lt.ts':
              "import { defineComponent } from 'thane';\n" +
              'export const Lt = defineComponent(() => ({ template: html`<p class="a">t</p>`, ' +
              'styles: css`@layer base; @import url(x.css); .a { color: red; }` }));\n',
            'src/lf.ts':
              "import { defineComponent } from 'thane';\nimport styles from './lf.css';\n" +
              'export const Lf = defineComponent(() => ({ template: html`<p class="b">f</p>`, styles }));\n',
            'src/lf.css': '@charset "UTF-8";\n@layer base, theme;\n.b { color: blue; }\n',
          },
        },
      );
    } finally {
      warnings = warn.mock.calls.map((c) => c.join(' '));
      warn.mockRestore();
    }
    const fromTemplate = /`(@layer base\{\}[^`]*)`/.exec(js)?.[1];
    const fromFile = /"(\\n@layer base\{\}[^"]*)"/.exec(js)?.[1];
    expect(fromTemplate).toBe('@layer base{}  .a { color: red; }');
    expect(JSON.parse(`"${fromFile}"`)).toBe('\n@layer base{}@layer theme{}\n.b { color: blue; }\n');
    expect(scopeCssRules(fromTemplate!, '.lt')).toBe('@layer base{}.lt .a{ color: red; }');
    expect(scopeCssRules(JSON.parse(`"${fromFile}"`), '.lf')).toBe(
      '\n@layer base{}@layer theme{}.lf .b{ color: blue; }\n',
    );
    expect(warnings.filter((w) => w.includes('@import'))).toHaveLength(1);
    expect(warnings.find((w) => w.includes('@import'))).toMatch(/lt\.ts: @import url\(x\.css\); was removed/);
  });
});

describe('declaresOwnCssTag', () => {
  const parse = (source: string): ts.SourceFile =>
    ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, false);

  test('the global tag and the import from thane belong to Thane', () => {
    expect(declaresOwnCssTag(parse('export const s = css`.a{}`;'))).toBe(false);
    expect(declaresOwnCssTag(parse("import { css } from 'thane';\nexport const s = css`.a{}`;"))).toBe(false);
  });

  test('a css tag from anywhere else is not', () => {
    expect(declaresOwnCssTag(parse("import { css } from 'some-lib';"))).toBe(true);
    expect(declaresOwnCssTag(parse("import { styled as css } from 'some-lib';"))).toBe(true);
    expect(declaresOwnCssTag(parse("import css from 'some-lib';"))).toBe(true);
    expect(declaresOwnCssTag(parse('const css = (s: TemplateStringsArray) => s.join("");'))).toBe(true);
    expect(declaresOwnCssTag(parse('function css() {}'))).toBe(true);
  });
});
