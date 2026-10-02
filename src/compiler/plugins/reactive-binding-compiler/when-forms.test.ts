/**
 * The two forms of `when()`: in an element's tag it shows the element, in content it shows a template, or one
 * of two. Without an else-branch the content form is one conditional over two anchors, bound like the tag
 * form; with one it is a branch pair over three. A content `when()` that is not a conditional is THANE014.
 */
import { describe, expect, test } from 'bun:test';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;
const compile = (template: string, setup = ''): string => {
  const source = `import { defineComponent, html, signal, when } from 'thane';
export const App = defineComponent<{ label: string }>(({ props }) => {
  const open = signal(false);
  const n = signal(1);
  ${setup}
  return { template: html\`${template}\` };
});
`;
  const out = transformDefineComponentSource(source, `/virtual/when-forms-${fileId++}.ts`);
  if (out === null) throw new Error('not compiled');
  return out;
};
const templateOf = (out: string): string => /const __tpl = __T\(`([^`]*)`\)/.exec(out)?.[1] ?? '';

describe('when() in content', () => {
  test('without an else-branch: one conditional over two anchors, bound on the signal itself', () => {
    const out = compile('<div>${when(open(), html`<p>${n()}</p>`)}</div>');
    expect(templateOf(out)).toBe('<div><!----><!----></div>');
    expect(out).toMatch(/__bindIf\(_ws_b\d+, _we_b\d+, open, `<p><!---->1<!----><\/p>`, \(_c\) => \{/);
    expect(out).not.toContain('__bindIfExpr');
  });

  test('without an else-branch, over an expression: one __bindIfExpr', () => {
    const out = compile('<div>${when(n() > 1, html`<p>many</p>`)}</div>');
    expect(out.match(/__bindIfExpr\(/g)).toHaveLength(1);
    expect(out).toContain('() => n() > 1, `<p>many</p>`');
  });

  test('an empty else-branch is the same as none', () => {
    const withEmpty = compile('<div>${when(open(), html`<p>a</p>`, html``)}</div>');
    const without = compile('<div>${when(open(), html`<p>a</p>`)}</div>');
    expect(withEmpty.replace(/when-forms-\d+/, '')).toBe(without.replace(/when-forms-\d+/, ''));
  });

  test('with an else-branch: two bindings over three anchors, the initial branch pre-rendered', () => {
    const out = compile('<div>${when(open(), html`<p>on</p>`, html`<p>off</p>`)}</div>');
    expect(templateOf(out)).toBe('<div><!----><!----><p>off</p><!----></div>');
    expect(out).toContain('() => open(), `<p>on</p>`');
    expect(out).toContain('() => !(open()), `<p>off</p>`');
  });

  test('a tag form inside a row or a branch is the template of that row or branch', () => {
    const out = compile(
      '<ul>${repeat([1, 2], (i) => html`<li><b ${when(open())}>${i}</b></li>`)}</ul>${when(n(), html`<i ${when(open())}>x</i>`)}',
    );
    expect(out).toContain('__bindIf(');
  });
});

describe('THANE014: a content when() that is not a conditional', () => {
  test('a condition alone', () =>
    expect(() => compile('<div>${when(open())}</div>')).toThrow(
      /THANE014: \$\{when\(open\(\)\)\} has no template to show\. In an element's tag, when\(condition\) shows the element/,
    ));

  test('more than three arguments', () =>
    expect(() => compile('<div>${when(open(), html`a`, html`b`, html`c`)}</div>')).toThrow(
      /THANE014: when\(\) takes a condition and one or two templates/,
    ));

  test('a branch that is not a template', () =>
    expect(() => compile('<div>${when(open(), props.label)}</div>')).toThrow(
      /THANE014: when\(\)'s second argument is not a template: props\.label/,
    ));

  test('an else-branch that is not a template', () =>
    expect(() => compile('<div>${when(open(), html`a`, "b")}</div>')).toThrow(
      /THANE014: when\(\)'s third argument is not a template: "b"/,
    ));
});
