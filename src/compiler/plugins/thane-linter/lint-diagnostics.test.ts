/**
 * Lint rule diagnostics, pinned in full: severity, message, code and location (file, line, column).
 *
 * lint-rules.test.ts pins codes and counts. These tests pin everything else a user sees, plus the
 * shapes each rule accepts or skips: which calls count as defineComponent, which tags count as html/css,
 * and how THANE411 keys mount targets. THANE401 (component-property-order) and THANE402
 * (lifecycle-arrow-function) are retired: the compiler reads properties in any order and hooks in any form.
 * THANE406 (no-element-id) is retired: compiled code no longer uses ids. THANE407 (single-component-per-file)
 * is retired: each component of a file is compiled on its own. THANE410 (no-cross-file-html-template) is
 * retired: a template can use a fragment another module exports.
 */

import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { ErrorCode } from '../../errors.js';
import type { Diagnostic } from '../../types.js';
import type { LintRuleDefinition } from './rules/types.js';
import {
  noDefaultExportComponent,
  requireConstTaggedTemplates,
  noNestedHtmlTags,
  noConditionalTemplateInit,
  componentConstDeclaration,
  noAliasedComponentExport,
  duplicateMountTarget,
  singleReturnObject,
  noAliasedThaneImport,
} from './rules/index.js';

/** The path passed to the rule. The source is parsed as 'parsed.ts', so the reported file must come from here. */
const FILE = 'C:/app/src/widget.ts';

const run = (rule: LintRuleDefinition, src: string[]): Diagnostic[] =>
  rule.check(ts.createSourceFile('parsed.ts', src.join('\n'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), FILE);

/** A diagnostic at the first occurrence of `needle` on 1-based line `line` of `src`. */
const diag =
  (severity: 'error' | 'warning', code: string) =>
  (src: string[], line: number, needle: string, message: string): Diagnostic => {
    const column = src[line - 1]!.indexOf(needle) + 1;
    if (column === 0) throw new Error(`'${needle}' is not on line ${line}`);
    return { severity, message, location: { file: FILE, line, column }, code };
  };

// ============================================================================
// THANE400: no-default-export-component
// ============================================================================

describe('THANE400 diagnostics', () => {
  const error = diag('error', ErrorCode.NO_DEFAULT_EXPORT_COMPONENT);
  const MESSAGE = 'defineComponent must use a named export: export const MyComponent = defineComponent(...)';

  test('reports at the export statement, after its doc comment', () => {
    const src = [
      "import { defineComponent } from 'thane';",
      '',
      '/** The app. */',
      '  export default defineComponent(() => ({ template: html`<div/>` }));',
    ];
    expect(run(noDefaultExportComponent, src)).toStrictEqual([error(src, 4, 'export default', MESSAGE)]);
  });

  test('ignores a member callee, a parenthesised call and export =', () => {
    expect(run(noDefaultExportComponent, ['export default lib.defineComponent(() => ({}));'])).toStrictEqual([]);
    expect(run(noDefaultExportComponent, ['export default (defineComponent(() => ({})));'])).toStrictEqual([]);
    expect(run(noDefaultExportComponent, ['export = defineComponent(() => ({}));'])).toStrictEqual([]);
  });
});

// ============================================================================
// THANE403: require-const-tagged-templates
// ============================================================================

describe('THANE403 diagnostics', () => {
  const error = diag('error', ErrorCode.REQUIRE_CONST_TAGGED_TEMPLATES);
  const message = (tag: string, keyword: string) =>
    `'${tag}\`\`' tagged template must use 'const', not '${keyword}'. ` +
    `Templates declared with '${keyword}' can be reassigned and cannot be resolved at compile time.`;

  test('reports each html or css declarator of a let, var or using statement', () => {
    const src = [
      'let header = html`<h1/>`, count = 1, footer = css`x`;',
      'function f() {',
      '  var inner = html`<p/>`;',
      '}',
      'using res = html`<i/>`;',
      'await using res2 = html`<i/>`;',
      'const ok = html`<b/>`;',
    ];
    expect(run(requireConstTaggedTemplates, src)).toStrictEqual([
      error(src, 1, 'header', message('html', 'let')),
      error(src, 1, 'footer', message('css', 'let')),
      error(src, 3, 'inner', message('html', 'var')),
      error(src, 5, 'res', message('html', 'using')),
    ]);
  });

  test('ignores other tags, member tags, untagged and wrapped templates', () => {
    const src = [
      'let a = sql`x`;',
      'let b = lib.html`<b/>`;',
      'let c = `<c/>`;',
      'let d = (html`<d/>`);',
      'let e = wrap(css`x`);',
      'for (let f = html`<f/>`; ; ) {}',
    ];
    expect(run(requireConstTaggedTemplates, src)).toStrictEqual([]);
  });
});

// ============================================================================
// THANE404: no-nested-html-tags
// ============================================================================

describe('THANE404 diagnostics', () => {
  const error = diag('error', ErrorCode.NO_NESTED_HTML_TAGS);
  const MESSAGE =
    "An 'html' template here is not compiled: inside another template, one is compiled where it is the whole " +
    '${…}, a directive argument, or a branch of a ternary, && or .map() in content.';

  test('reports a nested html template at its tag unless it is the whole ${}, in a directive call or a branch', () => {
    const src = [
      'const t = html`<div>${html`<p>${html`<i/>`}</p>`}</div>`;',
      'const u = html`${when(x(), html`<b/>`)}${when(x(), html`<c/>`, html`<d/>`)}`;',
      'const v = html`${fmt(html`<e/>`)}`;',
      'const w = html`${repeat(xs, (i) => html`${html`<s/>`}`)}`;',
      'const m = html`${lib.html`<q/>`}${lib.when(x(), html`<r/>`)}`;',
      "const y = html`${on() ? html`<y/>` : ''}${xs.map((i) => html`<z/>`)}${on() && html`<a/>`}`;",
      'const k = html`${fmt(html`${html`<k/>`}`)}`;',
      "const g = html`<p title=${on() ? html`<g/>` : ''}>${on() ? a : b ? html`<h/>` : null}</p>`;",
      'const f = html`${on() ? fmt(html`<f/>`) : html`<f2/>`}${xs.map((i) => { return html`<f3/>`; })}`;',
    ];
    expect(run(noNestedHtmlTags, src)).toStrictEqual([
      error(src, 3, 'html`<e/>', MESSAGE),
      error(src, 5, 'html`<r/>', MESSAGE),
      error(src, 7, 'html`${html', MESSAGE),
      // In a tag, a ternary of templates is a plain value
      error(src, 8, 'html`<g/>', MESSAGE),
      // A template inside a branch's call, and a .map() row with a block body, are plain values
      error(src, 9, 'html`<f/>', MESSAGE),
      error(src, 9, 'html`<f3/>', MESSAGE),
    ]);
  });
});

// ============================================================================
// THANE405: no-conditional-template-init
// ============================================================================

describe('THANE405 diagnostics', () => {
  const warning = diag('warning', ErrorCode.NO_CONDITIONAL_TEMPLATE_INIT);
  const TERNARY =
    'Conditional assignment of tagged templates is not supported. ' +
    "The compiler cannot determine which template to use at compile time. Use 'when()' in the template instead.";
  const LOGICAL =
    'Logical expression assignment of tagged templates is not supported. ' +
    "The compiler cannot resolve the template value at compile time. Use 'when()' in the template instead.";

  test('reports ternaries and logical expressions whose operands contain html or css', () => {
    const src = [
      'const a = on ? html`<a/>` : null;',
      'const b = on ? null : wrap(css`x`);',
      'const c = html`<c/>` ? 1 : 2;',
      'let d = x ?? html`<d/>`;',
      'var e = x || lib.html`<e/>`;',
      'function f() { const g = y && html`<g/>`; }',
      'const h = cond ? sql`x` : [html`<h/>`];',
      'const i = a + html`<i/>`;',
      'const j = (on ? html`<j/>` : null);',
    ];
    expect(run(noConditionalTemplateInit, src)).toStrictEqual([
      warning(src, 1, 'a =', TERNARY),
      warning(src, 2, 'b =', TERNARY),
      warning(src, 4, 'd =', LOGICAL),
      warning(src, 6, 'g =', LOGICAL),
      warning(src, 7, 'h =', TERNARY),
    ]);
  });
});

// ============================================================================
// THANE408: component-const-declaration
// ============================================================================

describe('THANE408 diagnostics', () => {
  const error = diag('error', ErrorCode.COMPONENT_CONST_DECLARATION);
  const message = (keyword: string) =>
    `Component declaration must use 'const', not '${keyword}'. ` +
    "Reassigning a component variable breaks the compiler's static analysis " +
    'and can cause selector collisions.';

  test('reports each defineComponent declarator of a let, var or using statement', () => {
    const src = [
      'export let A = defineComponent(() => ({ template: html`<a/>` })), n = 1;',
      'function f() {',
      '  var B = defineComponent(() => ({}));',
      '}',
      'using C = defineComponent(() => ({}));',
      'await using C2 = defineComponent(() => ({}));',
      'const D = defineComponent(() => ({}));',
      'let E = lib.defineComponent(() => ({}));',
      'let F = (defineComponent(() => ({})));',
    ];
    expect(run(componentConstDeclaration, src)).toStrictEqual([
      error(src, 1, 'A =', message('let')),
      error(src, 3, 'B =', message('var')),
      error(src, 5, 'C =', message('using')),
    ]);
  });
});

// ============================================================================
// THANE409: no-aliased-component-export
// ============================================================================

describe('THANE409 diagnostics', () => {
  const error = diag('error', ErrorCode.NO_ALIASED_COMPONENT_EXPORT);
  const aliased = (local: string, exported: string) =>
    `Aliased component export is not supported: '${local}' exported as '${exported}'. ` +
    'The compiler derives the selector from the declaration name, not the exported name. ' +
    `Use 'export const ${exported} = defineComponent(...)' instead.`;
  const deferred = (name: string) =>
    `Deferred component export is not supported. The compiler requires the export keyword ` +
    `on the declaration: export const ${name} = defineComponent(...)`;

  test('reports aliased and deferred exports of local components; a re-export is fine', () => {
    const src = [
      'const Inner = defineComponent(() => ({ template: html`<a/>` }));',
      'const Plain = defineComponent(() => ({ template: html`<b/>` }));',
      'function f() { const Deep = defineComponent(() => ({})); }',
      'const Lib = lib.defineComponent(() => ({}));',
      'const Wrapped = (defineComponent(() => ({})));',
      'const helper = 1;',
      'export { Inner as Outer, Plain, helper as Helper, Deep, Lib as Lib2, Wrapped as W };',
      "export { Card, util, type Model } from './card.js';",
      "export {   x as Button } from './button.js';",
      "export type { Shape } from './shape.js';",
    ];
    expect(run(noAliasedComponentExport, src)).toStrictEqual([
      error(src, 7, 'Inner as', aliased('Inner', 'Outer')),
      error(src, 7, 'Plain', deferred('Plain')),
      error(src, 7, 'Deep', deferred('Deep')),
    ]);
  });
});

// ============================================================================
// THANE411: duplicate-mount-target
// ============================================================================

describe('THANE411 diagnostics', () => {
  const warning = diag('warning', ErrorCode.DUPLICATE_MOUNT_TARGET);
  const message = (target: string, previousLine: number) =>
    `Duplicate mount() call targeting ${target}. ` +
    `A previous mount() to the same target was found at line ${previousLine}. ` +
    'Mounting multiple components to the same target appends duplicate content ' +
    'and causes binding collisions. Use a different target element for each mount().';
  const BODY = 'document.body';

  test('keys every way of writing a target, and names the first mount of each target', () => {
    const src = [
      'mount(App);',
      '  mount(Other);',
      'mount(App, { target });',
      "mount(App, { 'target': el });",
      'mount(...args);',
      'mount(App, options);',
      'mount(B, { target: el });',
      "mount(App, { target: document.getElementById('app') });",
      'mount(App, { target: document.body });',
      "mount(App, { target: document.getElementById('app') });",
      'mount(App, { target: els[0] });',
      'mount(App, { target: els[0] });',
      'mount(App, { target: (el as HTMLElement)! });',
      'mount(App, { target: target });',
      'lib.mount(App);',
      'mount(Routes, { scrollRestoration: false });',
    ];
    // A spread and an options variable are not compared: their target is unknown. The shorthand `{ target }`
    // and a string key are the variables they name; no options, or options without a target, is document.body.
    expect(run(duplicateMountTarget, src)).toStrictEqual([
      warning(src, 2, 'mount', message(BODY, 1)),
      warning(src, 7, 'mount', message('var:el', 4)),
      warning(src, 9, 'mount', message(BODY, 1)),
      warning(src, 10, 'mount', message("document.getElementById('app')", 8)),
      warning(src, 12, 'mount', message('els[0]', 11)),
      warning(src, 13, 'mount', message('var:el', 4)),
      warning(src, 14, 'mount', message('var:target', 3)),
      warning(src, 16, 'mount', message(BODY, 1)),
    ]);
  });

  test('tracks each function scope on its own', () => {
    const src = [
      'mount(App, { target: el });',
      'const f = () => {',
      '  mount(App, { target: el });',
      '  const g = function () { mount(App, { target: el }); };',
      '  mount(Other, { target: el });',
      '};',
      'mount(Other, { target: el });',
    ];
    expect(run(duplicateMountTarget, src)).toStrictEqual([
      warning(src, 5, 'mount', message('var:el', 3)),
      warning(src, 7, 'mount', message('var:el', 1)),
    ]);
  });
});

// ============================================================================
// THANE412: single-return-object
// ============================================================================

describe('THANE412 diagnostics', () => {
  const error = diag('error', ErrorCode.SINGLE_RETURN_OBJECT);
  const MESSAGE =
    'A setup function with more than one return is not supported. ' +
    "The compiler builds one template per component, from the last return, so this one is never used. Use 'when()' in the template instead.";

  test('a template returned alone counts as a return, before an object or another template', () => {
    const src = [
      'export const A = defineComponent(() => {',
      '  if (loading()) return html`<p>Loading</p>`;',
      '  if (failed()) return (html`<p>Failed</p>`);',
      '  return { template: html`<p>a</p>`, styles };',
      '});',
      'export const B = defineComponent(() => {',
      '  if (x) return { template: html`<p>b</p>` };',
      '  return html`<p>c</p>`;',
      '});',
      'export const C = defineComponent(() => {',
      '  const label = () => html`<i>nested</i>`;',
      '  return html`<p>${label}</p>`;',
      '});',
    ];
    expect(run(singleReturnObject, src)).toStrictEqual([
      error(src, 2, 'return', MESSAGE),
      error(src, 3, 'return', MESSAGE),
      error(src, 7, 'return', MESSAGE),
    ]);
  });

  test('reports every return object but the last, at any depth, at its return', () => {
    const src = [
      'export const App = defineComponent(() => {',
      '  if (flag) {',
      '    return { template: html`<p>a</p>` };',
      '  }',
      '  for (const x of xs) { if (x) return { template: html`<p>b</p>` }; }',
      '  return { template: html`<p>c</p>` };',
      '});',
    ];
    expect(run(singleReturnObject, src)).toStrictEqual([
      error(src, 3, 'return', MESSAGE),
      error(src, 5, 'return', MESSAGE),
    ]);
  });

  test('the setup after a selector counts; each component on its own', () => {
    const src = [
      "export const A = defineComponent('x-a', function () {",
      '  if (flag) return { template: html`<p>a</p>` };',
      '  return { template: html`<p>b</p>` };',
      '});',
      'export const B = defineComponent(() => ({ template: html`<p>b</p>` }));',
    ];
    expect(run(singleReturnObject, src)).toStrictEqual([error(src, 2, 'return', MESSAGE)]);
  });

  test('accepts one return object, a concise body, returns inside nested functions, and other returns', () => {
    const src = [
      'export const A = defineComponent(() => {',
      '  const helper = () => { return { a: 1 }; };',
      '  function decl() { return { b: 2 }; }',
      '  const obj = { method() { return { c: 3 }; } };',
      '  if (flag) return;',
      '  return { template: html`<p>a</p>` };',
      '});',
      'export const B = defineComponent(() => (({ template: html`<p>b</p>` })));',
      'const notAComponent = () => { if (flag) return { a: 1 }; return { b: 2 }; };',
    ];
    expect(run(singleReturnObject, src)).toStrictEqual([]);
  });
});

// ============================================================================
// THANE413: no-aliased-thane-import
// ============================================================================

describe('THANE413 diagnostics', () => {
  const error = diag('error', ErrorCode.NO_ALIASED_THANE_IMPORT);

  test('reports a marker or defineComponent imported under another name, at the specifier', () => {
    const src = [
      "import { html as h, repeat, defineComponent as dc, signal as s } from 'thane';",
      "import { css as style } from 'thane';",
    ];
    expect(run(noAliasedThaneImport, src)).toStrictEqual([
      error(
        src,
        1,
        'html as h',
        "'html' is imported as 'h', and the compiler finds it only by its own name. Import it as 'html': import { html } from 'thane'",
      ),
      error(
        src,
        1,
        'defineComponent as dc',
        "'defineComponent' is imported as 'dc', and the compiler finds it only by its own name. " +
          "Import it as 'defineComponent': import { defineComponent } from 'thane'",
      ),
      error(
        src,
        2,
        'css as style',
        "'css' is imported as 'style', and the compiler finds it only by its own name. Import it as 'css': import { css } from 'thane'",
      ),
    ]);
  });

  test("reports a marker read through a namespace import of 'thane'", () => {
    const src = [
      "import * as thane from 'thane';",
      'export const App = thane.defineComponent(() => ({',
      '  template: thane.html`<ul>${thane.repeat(items(), row)}</ul>`,',
      '}));',
      'const count = thane.signal(0);',
    ];
    const message = (text: string, name: string) =>
      `'${text}' is not compiled: the compiler finds '${name}' only by its own name. Import it by name: import { ${name} } from 'thane'`;
    expect(run(noAliasedThaneImport, src)).toStrictEqual([
      error(src, 2, 'thane.defineComponent', message('thane.defineComponent', 'defineComponent')),
      error(src, 3, 'thane.html', message('thane.html', 'html')),
      error(src, 3, 'thane.repeat', message('thane.repeat', 'repeat')),
    ]);
  });

  test('accepts the markers under their own names, other aliases, type imports and other modules', () => {
    const src = [
      "import { defineComponent, html, css, when, repeat, signal as s } from 'thane';",
      "import { type Signal as S } from 'thane';",
      "import type { MountHandle as H } from 'thane';",
      "import { html as litHtml } from 'lit';",
      "import * as other from 'other';",
      'other.html`<p></p>`;',
    ];
    expect(run(noAliasedThaneImport, src)).toStrictEqual([]);
  });
});
