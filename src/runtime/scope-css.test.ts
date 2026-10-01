/**
 * Characterisation of runtime style scoping.
 *
 * `scopeCssRules` rewrites a component stylesheet so every rule is prefixed with the host
 * selector. These tests pin what it does today, including the cases that look wrong: a
 * refactor of the scanners must keep every one of them; a fix changes its row.
 */
import { describe, expect, test } from 'bun:test';
import { scopeCssRules, scopeKeyframes } from './component.js';

const scope = (css: string): string => scopeCssRules(css, '.sel');

const table = (cases: Array<[input: string, expected: string]>) => {
  for (const [input, expected] of cases) {
    test(JSON.stringify(input), () => {
      expect(scope(input)).toBe(expected);
    });
  }
};

describe('scopeCssRules: :host', () => {
  table([
    [':host { color: red; }', '.sel{ color: red; }'],
    [':host(.a) { color: red; }', '.sel.a{ color: red; }'],
    [':host(.a) .x { color: red; }', '.sel.a .x{ color: red; }'],
    [':host .x { color: red; }', '.sel .x{ color: red; }'],
    [':host:hover { color: red; }', '.sel:hover{ color: red; }'],
    [':host>.x{a:b}', '.sel>.x{a:b}'],
    [':host, :host(.x), .y { a: b }', '.sel, .sel.x, .sel .y{ a: b }'],
    // The host suffix ends at the parenthesis that matches `:host(` (until it was fixed
    // it ended at the first `)`, giving `.sel:not(.x.y) .a`)
    [':host(:not(.x).y) .a { b: c }', '.sel:not(.x).y .a{ b: c }'],
    [':host(.a:is(.b,.c)) .d { e: f }', '.sel.a:is(.b,.c) .d{ e: f }'],
    [':host(:not(.x)) { a: b }', '.sel:not(.x){ a: b }'],
    [':host(:is(.a, .b)) .c, .d { e: f }', '.sel:is(.a, .b) .c, .sel .d{ e: f }'],
    // No parenthesis matches `:host(`: falls through to the plain `:host` prefix rule
    [':host(:not(.x) .a { b: c }', '.sel(:not(.x) .a{ b: c }'],
    // `:host-context` is treated as `:host` followed by `-context`
    [':host-context(.dark) .a { b: c }', '.sel-context(.dark) .a{ b: c }'],
    // No closing parenthesis: falls through to the plain `:host` prefix rule
    [':host(.a { b: c }', '.sel(.a{ b: c }'],
  ]);
});

describe('scopeCssRules: plain selectors, lists and nesting', () => {
  table([
    ['.x { color: red; }', '.sel .x{ color: red; }'],
    ['.x, .y { color: red; }', '.sel .x, .sel .y{ color: red; }'],
    ['div,\n  p { a: b }', '.sel div, .sel p{ a: b }'],
    ['.a > .b ~ .c + .d { e: f }', '.sel .a > .b ~ .c + .d{ e: f }'],
    // An empty selector after a trailing comma stays empty
    ['.a, { b: c }', '.sel .a, { b: c }'],
    // `&` is replaced by the host selector wherever it appears; no descendant prefix
    ['& .x { color: red; }', '.sel .x{ color: red; }'],
    ['.x & { color: red; }', '.x .sel{ color: red; }'],
    ['&:hover, .y { a: b }', '.sel:hover, .sel .y{ a: b }'],
    // Rule bodies are copied unchanged: nested rules rely on native CSS nesting
    ['.a { & .b { c: d } }', '.sel .a{ & .b { c: d } }'],
    // Whitespace before each selector prelude and before `{` is dropped
    ['  .a  {  b: c  }  \n  .d{e:f}', '.sel .a{  b: c  }.sel .d{e:f}'],
    ['.a{}.b{}', '.sel .a{}.sel .b{}'],
    ['', ''],
  ]);
});

describe('scopeCssRules: commas that do not split the selector list', () => {
  table([
    [':is(.a, .b) .c { a: b }', '.sel :is(.a, .b) .c{ a: b }'],
    [':where(:not(.a, .b)), .c { d: e }', '.sel :where(:not(.a, .b)), .sel .c{ d: e }'],
    ['[data-x="a,b"] { a: b }', '.sel [data-x="a,b"]{ a: b }'],
    ["[data-x='a,b'], .z { a: b }", ".sel [data-x='a,b'], .sel .z{ a: b }"],
    // An escaped quote does not end the string
    ['.a[title="x\\"y,z"] { a: b }', '.sel .a[title="x\\"y,z"]{ a: b }'],
  ]);
});

describe('scopeCssRules: braces inside strings', () => {
  table([
    ['.a::before { content: "}"; }', '.sel .a::before{ content: "}"; }'],
    [".a::before { content: '{'; } .b { c: d }", ".sel .a::before{ content: '{'; }.sel .b{ c: d }"],
    [".a::after { content: 'it\\'s {'; } .b { c: d }", ".sel .a::after{ content: 'it\\'s {'; }.sel .b{ c: d }"],
    // A quote preceded by a backslash never closes a string, even when the backslash is itself
    // escaped (`"\\"`): the string runs to the end, no brace matches, and the rest is copied
    // unscoped. The shared string scanner keeps this rule (`s[i - 1] !== '\\'`).
    ['.a::after { content: "\\\\"; } .b { c: d }', '.a::after { content: "\\\\"; } .b { c: d }'],
    // An apostrophe in a comment opens a "string" too: every later rule is left unscoped
    [".a { /* it's */ color: blue } .b { c: d }", ".a { /* it's */ color: blue } .b { c: d }"],
  ]);
});

describe('scopeCssRules: at-rules', () => {
  table([
    // Grouping at-rules are scoped recursively; their prelude is kept verbatim
    [
      '@media (max-width: 600px) { .a { b: c } :host { d: e } }',
      '@media (max-width: 600px) {.sel .a{ b: c }.sel{ d: e } }',
    ],
    ['@supports (display: grid) { .a { b: c } }', '@supports (display: grid) {.sel .a{ b: c } }'],
    ['@layer base { .a { b: c } }', '@layer base {.sel .a{ b: c } }'],
    ['@container card (min-width: 1px) { .a { b: c } }', '@container card (min-width: 1px) {.sel .a{ b: c } }'],
    ['@document url(x) { .a { b: c } }', '@document url(x) {.sel .a{ b: c } }'],
    ['@media screen { @supports (x: y) { .a { b: c } } }', '@media screen { @supports (x: y) {.sel .a{ b: c } } }'],
    ['@media print{.a{b:c}}.d{e:f}', '@media print{.sel .a{b:c}}.sel .d{e:f}'],
    // Leading whitespace before an at-rule is kept (the prelude is copied, not trimmed)
    ['  @media print { .a { b: c } }', '  @media print {.sel .a{ b: c } }'],
    // The test is a case-sensitive prefix match
    ['@media-query-like { .a { b: c } }', '@media-query-like {.sel .a{ b: c } }'],
    ['@MEDIA print { .a { b: c } }', '@MEDIA print { .a { b: c } }'],
    // Other at-rules are copied unchanged, body included
    ['@font-face { font-family: X; src: url(x.woff); }', '@font-face { font-family: X; src: url(x.woff); }'],
    ['@keyframes spin { from { a: b } to { c: d } }', '@keyframes spin { from { a: b } to { c: d } }'],
    ['@layer a, b;', '@layer a, b;'],
    // A statement at-rule becomes part of the next rule's prelude, so that rule is not scoped
    ['@import url(x.css); .a { b: c }', '@import url(x.css); .a { b: c }'],
  ]);
});

describe('scopeCssRules: malformed input', () => {
  table([
    // Unterminated rule: copied from the cursor to the end
    ['.a { b: c', '.a { b: c'],
    // Unterminated string inside a body: no matching brace, copied unscoped
    ['.a { b: "c } .d { e: f }', '.a { b: "c } .d { e: f }'],
    // Stray closing brace and trailing text without a body are copied as they are
    ['.a { b: c } }', '.sel .a{ b: c } }'],
    ['.a { b: c } .d', '.sel .a{ b: c } .d'],
    // A rule without a selector keeps its (empty) prelude
    ['{ a: b }', '{ a: b }'],
  ]);
});

describe('scopeKeyframes: a stylesheet owns the keyframes it defines', () => {
  const run = (css: string): string => scopeKeyframes(css, 'card');
  const rows = (cases: Array<[input: string, expected: string]>) => {
    for (const [input, expected] of cases) {
      test(JSON.stringify(input), () => {
        expect(run(input)).toBe(expected);
      });
    }
  };
  rows([
    // The definition and its uses are renamed together
    [
      '@keyframes spin{from{a:b}}.a{animation:spin 1s linear infinite}',
      '@keyframes card-spin{from{a:b}}.a{animation:card-spin 1s linear infinite}',
    ],
    [
      '.a { animation-name: spin; } @keyframes spin { to { a: b } }',
      '.a { animation-name: card-spin; } @keyframes card-spin { to { a: b } }',
    ],
    // Several animations in one value, and the prefixed forms
    [
      '@keyframes a{}@-webkit-keyframes b{}.x{animation:a 1s,b 2s;-webkit-animation:b 1s}',
      '@keyframes card-a{}@-webkit-keyframes card-b{}.x{animation:card-a 1s,card-b 2s;-webkit-animation:card-b 1s}',
    ],
    // A name the stylesheet does not define is a global animation, and stays
    [
      '@keyframes spin{}.a{animation:fade 1s}.b{animation:spin 1s}',
      '@keyframes card-spin{}.a{animation:fade 1s}.b{animation:card-spin 1s}',
    ],
    // Other properties and other text are left alone, even when they spell a keyframe name
    [
      '@keyframes spin{}.spin{content:"spin";animation-duration:1s;transition:spin 1s}',
      '@keyframes card-spin{}.spin{content:"spin";animation-duration:1s;transition:spin 1s}',
    ],
    // Nothing to do: returned as it is
    ['.a{animation:fade 1s}', '.a{animation:fade 1s}'],
    // Inside @media too
    [
      '@media print{@keyframes spin{}.a{animation:spin 1s}}',
      '@media print{@keyframes card-spin{}.a{animation:card-spin 1s}}',
    ],
  ]);
});
