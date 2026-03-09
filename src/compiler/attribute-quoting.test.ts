import { describe, expect, test } from 'bun:test';
import {
  processHtmlTemplateWithConditionals,
  replaceExpressionsWithValues,
} from './plugins/reactive-binding-compiler/template-processing.js';

/**
 * Regression tests for unquoted attribute value quoting.
 *
 * Root cause: when the compiler replaces ${signal()} or ${expression} in
 * attribute values with empty strings or bare values, it can produce unquoted
 * attribute syntax like `title=` or `src=`.  The HTML5 parser then treats
 * subsequent content (including the next attribute) as the value of the
 * previous attribute, effectively swallowing it.
 *
 * Fix: detect when a ${...} expression is a bare (unquoted) attribute value
 * (preceded by `=`) and wrap the replacement in double quotes.
 */

// ─── helpers ────────────────────────────────────────────────────────────
const process = (template: string, inits = new Map<string, string | number | boolean>()) =>
  processHtmlTemplateWithConditionals(template, inits, 0);

/**
 * Asserts that `html` does NOT contain any bare `attrName=` (unquoted empty
 * attribute value) that would cause the browser to swallow the next token.
 * Specifically, all `=` signs that are part of attribute assignments should be
 * followed by either `"` (quoted value) or an alphanumeric/comment/hash/slash
 * that won't eat the next attribute.
 */
const assertNoUnquotedEmptyAttrs = (html: string) => {
  // Looking for patterns like: word= followed by space or > or /
  // This means an attribute has an empty unquoted value.
  const unquotedEmpty = html.match(/\w+=(?:\s|>|\/)/g);
  if (unquotedEmpty) {
    throw new Error(
      `Found unquoted empty attribute value(s) in compiled HTML: ${unquotedEmpty.join(', ')}\nFull HTML: ${html}`,
    );
  }
};

// ─── Core: static class after dynamic attr ──────────────────────────────

describe('unquoted attribute value quoting', () => {
  test('static class after dynamic expression attr is preserved', () => {
    const { processedContent } = process('<h5 title=${product().title} class="productTitle">${product().title}</h5>');
    expect(processedContent).toContain('class="productTitle"');
    expect(processedContent).toContain('title=""');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('static class after bare signal attr is preserved', () => {
    const { processedContent } = process('<h5 title=${title()} class="productTitle">${title()}</h5>');
    expect(processedContent).toContain('class="productTitle"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('static class after bare signal attr with initial value is preserved', () => {
    const inits = new Map<string, string | number | boolean>([['title', 'Hello World']]);
    const { processedContent } = process('<h5 title=${title()} class="productTitle">${title()}</h5>', inits);
    expect(processedContent).toContain('class="productTitle"');
    expect(processedContent).toContain('title="Hello World"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('multiple sequential dynamic attrs followed by static attr', () => {
    const { processedContent } = process('<img src=${url()} alt=${desc()} class="photo" />');
    expect(processedContent).toContain('class="photo"');
    expect(processedContent).toContain('src=""');
    expect(processedContent).toContain('alt=""');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('multiple sequential expression attrs followed by static attr', () => {
    const { processedContent } = process('<img src=${product().image} alt=${product().title} class="photo" />');
    expect(processedContent).toContain('class="photo"');
    expect(processedContent).toContain('src=""');
    expect(processedContent).toContain('alt=""');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('static class BEFORE dynamic attr is unaffected', () => {
    const { processedContent } = process('<h5 class="productTitle" title=${title()}>${title()}</h5>');
    expect(processedContent).toContain('class="productTitle"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('static data attribute after dynamic attr', () => {
    const { processedContent } = process('<div title=${label()} data-testid="widget">${label()}</div>');
    expect(processedContent).toContain('data-testid="widget"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('multiple static attrs after a dynamic attr', () => {
    const { processedContent } = process('<input value=${val()} class="input" type="text" placeholder="Enter..." />');
    expect(processedContent).toContain('class="input"');
    expect(processedContent).toContain('type="text"');
    expect(processedContent).toContain('placeholder="Enter..."');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('dynamic attr at the end (no following attr to swallow)', () => {
    const { processedContent } = process('<span class="label" title=${tip()}>${tip()}</span>');
    expect(processedContent).toContain('class="label"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('expression binding with initial value quotes correctly', () => {
    const inits = new Map<string, string | number | boolean>([['count', 5]]);
    const { processedContent } = process('<div data-count=${count()} class="counter">${count()}</div>', inits);
    expect(processedContent).toContain('data-count="5"');
    expect(processedContent).toContain('class="counter"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('boolean initial value is quoted', () => {
    const inits = new Map<string, string | number | boolean>([['active', true]]);
    const { processedContent } = process('<div data-active=${active()} class="item">${active()}</div>', inits);
    expect(processedContent).toContain('data-active="true"');
    expect(processedContent).toContain('class="item"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('void element (img) src and alt are quoted', () => {
    const { processedContent } = process('<img src=${src()} alt=${alt()} />');
    expect(processedContent).toContain('src=""');
    expect(processedContent).toContain('alt=""');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('void element (input) with dynamic value', () => {
    const { processedContent } = process('<input type="text" value=${val()} class="field" />');
    expect(processedContent).toContain('type="text"');
    expect(processedContent).toContain('class="field"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('dynamic class expression followed by static attr', () => {
    const { processedContent } = process(
      '<button class=${isActive() ? "active" : "inactive"} data-role="toggle">${isActive()}</button>',
    );
    expect(processedContent).toContain('data-role="toggle"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('all attrs dynamic - no unquoted empties', () => {
    const { processedContent } = process('<a href=${url()} title=${desc()} class=${cls()}>${desc()}</a>');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('quoted attr mixed with dynamic - static preserved', () => {
    const { processedContent } = process(
      '<div id="fixed" role=${role()} class="widget" aria-label=${label()}>${label()}</div>',
    );
    expect(processedContent).toContain('id="fixed"');
    expect(processedContent).toContain('class="widget"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('initial value with special HTML characters is quoted', () => {
    const inits = new Map<string, string | number | boolean>([['name', 'A & B "quoted"']]);
    const { processedContent } = process('<span title=${name()} class="tag">${name()}</span>', inits);
    expect(processedContent).toContain('class="tag"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('numeric initial value is quoted', () => {
    const inits = new Map<string, string | number | boolean>([['width', 100]]);
    const { processedContent } = process('<div data-width=${width()} class="sized">${width()}</div>', inits);
    expect(processedContent).toContain('data-width="100"');
    expect(processedContent).toContain('class="sized"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('no regression: already-quoted attr values stay correct', () => {
    // Attrs with quoted values should pass through normally
    const { processedContent } = process('<div class="container" id="main">Hello</div>');
    expect(processedContent).toContain('class="container"');
    expect(processedContent).toContain('id="main"');
  });

  test('no regression: text bindings in element content are unchanged', () => {
    const inits = new Map<string, string | number | boolean>([['count', 42]]);
    const { processedContent } = process('<p>Count: ${count()}</p>', inits);
    // Text binding should have comment markers, not be wrapped in quotes
    expect(processedContent).toContain('42');
    expect(processedContent).not.toContain('"42"');
  });
});

// ─── replaceExpressionsWithValues ────────────────────────────────────────

describe('replaceExpressionsWithValues quoting', () => {
  test('replaces unquoted attr expression with quoted value', () => {
    const inits = new Map<string, string | number | boolean>([['name', 'hello']]);
    const result = replaceExpressionsWithValues('<div title=${name()}></div>', inits);
    expect(result).toContain('title="hello"');
  });

  test('does not double-quote already-positioned text content', () => {
    const inits = new Map<string, string | number | boolean>([['name', 'hello']]);
    const result = replaceExpressionsWithValues('<div>${name()}</div>', inits);
    // In text content position (after >), should NOT be wrapped in quotes
    expect(result).toContain('>hello<');
  });

  test('replaces unquoted attr with empty quoted value', () => {
    const inits = new Map<string, string | number | boolean>();
    const result = replaceExpressionsWithValues('<div title=${name()}></div>', inits);
    expect(result).toContain('title=""');
  });
});

// ─── when-directive contexts ────────────────────────────────────────────

describe('unquoted attrs inside when-directive elements', () => {
  test('conditional element with dynamic attr followed by static class', () => {
    const { processedContent } = process(
      '<div><span ${when(visible())} title=${tip()} class="tooltip">${tip()}</span></div>',
    );
    // The when-directive element is extracted to a separate template,
    // but its attributes should still be properly quoted
    expect(processedContent).not.toMatch(/title=\s/);
  });
});

// ─── Attribute, directive, and text binding ordering ────────────────────

describe('attribute ordering and completeness', () => {
  /**
   * Extracts the attribute key-value pairs from the FIRST tag found in `html`.
   * Returns them in document order as [name, value] tuples (value is null for
   * boolean attributes).
   */
  const extractAttrs = (html: string): Array<[string, string | null]> => {
    const tagMatch = html.match(/<\w+([^>]*)>/);
    if (!tagMatch) return [];
    const attrStr = tagMatch[1]!;
    const attrs: Array<[string, string | null]> = [];
    const re = /([\w-]+)(?:="([^"]*)")?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrStr)) !== null) {
      attrs.push([m[1]!, m[2] ?? null]);
    }
    return attrs;
  };

  /** Returns just the attribute names from the first tag. */
  const attrNames = (html: string) => extractAttrs(html).map(([name]) => name);

  // ── static + dynamic attr interleaving ───────────────────────────

  test('static-dynamic-static: all attrs present in original order', () => {
    const { processedContent } = process('<div class="card" title=${label()} data-testid="item">${label()}</div>');
    const names = attrNames(processedContent);
    // id is injected first by the compiler
    expect(names[0]).toBe('id');
    expect(names).toContain('class');
    expect(names).toContain('title');
    expect(names).toContain('data-testid');
    // relative order preserved: class before title before data-testid
    expect(names.indexOf('class')).toBeLessThan(names.indexOf('title'));
    expect(names.indexOf('title')).toBeLessThan(names.indexOf('data-testid'));
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('dynamic-static-dynamic-static: four attrs interleaved', () => {
    const { processedContent } = process('<span href=${url()} class="link" title=${tip()} data-x="y">${tip()}</span>');
    const names = attrNames(processedContent);
    expect(names).toContain('href');
    expect(names).toContain('class');
    expect(names).toContain('title');
    expect(names).toContain('data-x');
    expect(names.indexOf('href')).toBeLessThan(names.indexOf('class'));
    expect(names.indexOf('class')).toBeLessThan(names.indexOf('title'));
    expect(names.indexOf('title')).toBeLessThan(names.indexOf('data-x'));
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('three consecutive dynamic attrs preserve all', () => {
    const { processedContent } = process('<img src=${src()} alt=${alt()} title=${tip()} />');
    const names = attrNames(processedContent);
    expect(names).toContain('src');
    expect(names).toContain('alt');
    expect(names).toContain('title');
    expect(names.indexOf('src')).toBeLessThan(names.indexOf('alt'));
    expect(names.indexOf('alt')).toBeLessThan(names.indexOf('title'));
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  // ── event bindings are stripped but attrs around them survive ─────

  test('event attr between static attrs is stripped, neighbours preserved', () => {
    const { processedContent } = process('<button class="btn" @click=${handler} data-role="submit">Go</button>');
    const names = attrNames(processedContent);
    expect(names).toContain('class');
    expect(names).toContain('data-role');
    expect(names).not.toContain('@click');
    expect(processedContent).not.toContain('@click');
    expect(names.indexOf('class')).toBeLessThan(names.indexOf('data-role'));
  });

  test('event attr between dynamic and static attrs: both neighbours survive', () => {
    const { processedContent } = process(
      '<button title=${label()} @click=${handler} class="primary">${label()}</button>',
    );
    const names = attrNames(processedContent);
    expect(names).toContain('title');
    expect(names).toContain('class');
    expect(names).not.toContain('@click');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('multiple events stripped, surrounding static attrs intact', () => {
    const { processedContent } = process(
      '<div class="area" @mouseenter=${onEnter} data-tip="hi" @mouseleave=${onLeave} role="tooltip">text</div>',
    );
    const names = attrNames(processedContent);
    expect(names).toContain('class');
    expect(names).toContain('data-tip');
    expect(names).toContain('role');
    expect(processedContent).not.toContain('@mouseenter');
    expect(processedContent).not.toContain('@mouseleave');
    expect(names.indexOf('class')).toBeLessThan(names.indexOf('data-tip'));
    expect(names.indexOf('data-tip')).toBeLessThan(names.indexOf('role'));
  });

  // ── text bindings + attr bindings on the same element ────────────

  test('element with text binding and dynamic attr keeps both class and text marker', () => {
    const inits = new Map<string, string | number | boolean>([['name', 'World']]);
    const { processedContent } = process('<span title=${name()} class="greeting">Hello ${name()}</span>', inits);
    expect(processedContent).toContain('class="greeting"');
    expect(processedContent).toContain('title="World"');
    // text binding should have comment marker
    expect(processedContent).toMatch(/<!--b\d+-->World<!---->/);
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('multiple text bindings with multiple dynamic attrs', () => {
    const { processedContent } = process(
      '<p data-a=${a()} class="info" data-b=${b()}>First: ${a()} Second: ${b()}</p>',
    );
    const names = attrNames(processedContent);
    expect(names).toContain('data-a');
    expect(names).toContain('class');
    expect(names).toContain('data-b');
    // two text comment markers
    const commentMarkers = processedContent.match(/<!--b\d+-->/g) || [];
    expect(commentMarkers.length).toBeGreaterThanOrEqual(2);
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('expression text binding with expression attr binding', () => {
    const { processedContent } = process(
      '<div data-label=${item().name} class="card">${item().name} - ${item().price}</div>',
    );
    expect(processedContent).toContain('class="card"');
    expect(processedContent).toContain('data-label=""');
    // text content should have comment markers for each expression binding
    const markers = processedContent.match(/<!--b\d+-->/g) || [];
    expect(markers.length).toBeGreaterThanOrEqual(2);
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  // ── style binding + attr binding + text binding ──────────────────

  test('style binding does not break neighbouring static attrs', () => {
    const { processedContent } = process('<div style="color: ${color()}" class="themed" data-x="1">${color()}</div>');
    expect(processedContent).toContain('class="themed"');
    expect(processedContent).toContain('data-x="1"');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  // ── complex: event + dynamic + static + text all together ────────

  test('kitchen sink: event, dynamic attr, static attrs, and text binding', () => {
    const inits = new Map<string, string | number | boolean>([['price', 9.99]]);
    const { processedContent } = process(
      '<button class="buy" title=${price()} @click=${onBuy} data-sku="ABC" aria-label="Buy">${price()}</button>',
      inits,
    );
    const names = attrNames(processedContent);
    // All static attrs present
    expect(names).toContain('class');
    expect(names).toContain('data-sku');
    expect(names).toContain('aria-label');
    // Dynamic attr present and quoted
    expect(names).toContain('title');
    expect(processedContent).toContain('title="9.99"');
    // Event stripped
    expect(processedContent).not.toContain('@click');
    // Text binding present
    expect(processedContent).toMatch(/<!--b\d+-->9.99<!---->/);
    // Order: class, title, data-sku, aria-label  (event slot collapsed)
    expect(names.indexOf('class')).toBeLessThan(names.indexOf('title'));
    expect(names.indexOf('title')).toBeLessThan(names.indexOf('data-sku'));
    expect(names.indexOf('data-sku')).toBeLessThan(names.indexOf('aria-label'));
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('fully dynamic element: all attrs are dynamic signals', () => {
    const inits = new Map<string, string | number | boolean>([
      ['href', '/home'],
      ['cls', 'nav-link'],
      ['label', 'Home'],
    ]);
    const { processedContent } = process(
      '<a href=${href()} class=${cls()} aria-label=${label()}>${label()}</a>',
      inits,
    );
    const names = attrNames(processedContent);
    expect(names).toContain('href');
    expect(names).toContain('class');
    expect(names).toContain('aria-label');
    expect(processedContent).toContain('href="/home"');
    expect(processedContent).toContain('class="nav-link"');
    expect(processedContent).toContain('aria-label="Home"');
    expect(names.indexOf('href')).toBeLessThan(names.indexOf('class'));
    expect(names.indexOf('class')).toBeLessThan(names.indexOf('aria-label'));
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  // ── ProductCard-like real scenario ───────────────────────────────

  test('ProductCard pattern: expression attr + static class + text + event', () => {
    const { processedContent } = process('<h5 title=${product().title} class="productTitle">${product().title}</h5>');
    const names = attrNames(processedContent);
    expect(names).toContain('title');
    expect(names).toContain('class');
    expect(processedContent).toContain('class="productTitle"');
    expect(processedContent).toContain('title=""');
    expect(names.indexOf('title')).toBeLessThan(names.indexOf('class'));
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('img pattern: two expression attrs + static class', () => {
    const { processedContent } = process('<img class="productImage" src=${product().image} alt=${product().title} />');
    const names = attrNames(processedContent);
    expect(names).toContain('class');
    expect(names).toContain('src');
    expect(names).toContain('alt');
    expect(names.indexOf('class')).toBeLessThan(names.indexOf('src'));
    expect(names.indexOf('src')).toBeLessThan(names.indexOf('alt'));
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('button pattern: expression class + event + text with nested when', () => {
    const { processedContent } = process(
      '<button class=${active() ? "added" : "default"} @click=${onClick}>${active()}</button>',
    );
    const names = attrNames(processedContent);
    expect(names).toContain('class');
    expect(processedContent).not.toContain('@click');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  // ── edge: dynamic attr is the only attr ──────────────────────────

  test('single dynamic attr on element', () => {
    const { processedContent } = process('<div title=${label()}>${label()}</div>');
    const names = attrNames(processedContent);
    expect(names).toContain('title');
    assertNoUnquotedEmptyAttrs(processedContent);
  });

  test('single event attr on element is fully removed', () => {
    const { processedContent } = process('<button @click=${handler}>Click</button>');
    expect(processedContent).not.toContain('@click');
    expect(processedContent).toContain('>Click<');
  });

  // ── when directive with attrs ────────────────────────────────────

  test('when directive element: remaining attrs preserved in conditional template', () => {
    const inits = new Map<string, string | number | boolean>([['show', true]]);
    const { processedContent: _, conditionals } = process(
      '<div><span ${when(show())} class="tip" data-x="1">Tip</span></div>',
      inits,
    );
    // The when-directive element is extracted to a conditional block
    expect(conditionals.length).toBe(1);
    const condHtml = conditionals[0]!.templateContent;
    // The conditional template should include both static attrs
    expect(condHtml).toContain('class="tip"');
    expect(condHtml).toContain('data-x="1"');
  });

  test('when directive with dynamic attr + static attr on same element', () => {
    const inits = new Map<string, string | number | boolean>([['show', true]]);
    const { conditionals } = process(
      '<div><span ${when(show())} title=${tip()} class="tooltip">${tip()}</span></div>',
      inits,
    );
    expect(conditionals.length).toBe(1);
    const condHtml = conditionals[0]!.templateContent;
    expect(condHtml).toContain('class="tooltip"');
    // title should be quoted (not bare)
    expect(condHtml).not.toMatch(/title=\s/);
    expect(condHtml).not.toMatch(/title=>/);
  });
});
