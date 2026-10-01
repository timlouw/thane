/**
 * The DOM model: the tree the browser's parser builds of a template, which positions are
 * computed on. Each row pins one normalisation the model follows, or a shape it reports instead.
 * The serialisation writes elements as `tag(children)`, text as "…" and comments as <!--…-->.
 * Every tree here was checked against Chromium's `template.innerHTML`.
 */
import { describe, expect, test } from 'bun:test';
import { buildDomModel, cookTemplateText, type DomNode } from './dom-model.js';

const show = (nodes: DomNode[]): string =>
  nodes
    .map((n) =>
      n.kind === 'text'
        ? JSON.stringify(n.data)
        : n.kind === 'comment'
          ? `<!--${n.data}-->`
          : n.children.length > 0
            ? `${n.tag}(${show(n.children)})`
            : n.tag,
    )
    .join(' ');

const tree = (html: string): string => show(buildDomModel(html).roots);
const problems = (html: string): string[] => buildDomModel(html).problems;

describe('the tree the browser builds', () => {
  const rows: [string, string, string][] = [
    ['nesting, text and comments', '<div>a<b>b</b><!--c--><!----></div>', 'div("a" b("b") <!--c--> <!---->)'],
    ['top-level nodes', 'x<i>y</i>z', '"x" i("y") "z"'],
    ['void elements take no children', '<p><img src="a">t<br>u</p>', 'p(img "t" br "u")'],
    ['`/>` is ignored on an HTML element', '<div/><span>x</span>', 'div(span("x"))'],
    ['`/>` closes an svg element', '<svg><circle/><rect/></svg><b>x</b>', 'svg(circle rect) b("x")'],
    [
      'a <p> closes before a block element, and the stray </p> is a new <p>',
      '<p>a<div>b</div></p>',
      'p("a") div("b") p',
    ],
    [
      'a <p> closes before a table',
      '<p>a<table><tbody><tr><td>c</td></tr></tbody></table>',
      'p("a") table(tbody(tr(td("c"))))',
    ],
    ['an open <li> closes before the next one', '<ul><li>a<li>b</ul>', 'ul(li("a") li("b"))'],
    ['a nested list stays inside its item', '<ul><li>a<ul><li>b</li></ul></li></ul>', 'ul(li("a" ul(li("b"))))'],
    ['<dt> and <dd> close each other', '<dl><dt>a<dd>b<dt>c</dl>', 'dl(dt("a") dd("b") dt("c"))'],
    [
      'an <option> closes before the next one',
      '<select><option>a<option>b</select>',
      'select(option("a") option("b"))',
    ],
    ['a heading inside a heading closes it', '<h1>a<h2>b</h2>', 'h1("a") h2("b")'],
    ['a table without <tbody> gets one', '<table><tr><td>a</td></tr></table>', 'table(tbody(tr(td("a"))))'],
    ['a cell directly in a table gets a <tbody> and a <tr>', '<table><td>a</td></table>', 'table(tbody(tr(td("a"))))'],
    ['a <col> gets a <colgroup>', '<table><col><tr><td>a</td></tr></table>', 'table(colgroup(col) tbody(tr(td("a"))))'],
    [
      'cells and rows close before the next one',
      '<table><tr><td>a<td>b<tr><td>c</table>',
      'table(tbody(tr(td("a") td("b")) tr(td("c"))))',
    ],
    [
      'whitespace stays in the table',
      '<table> <tr> <td>a</td> </tr> </table>',
      'table(" " tbody(tr(" " td("a") " ") " "))',
    ],
    ['a row template at the top level gets no <tbody>', '<tr><td>a</td></tr>', 'tr(td("a"))'],
    ['a cell template at the top level gets no <tr>', '<td>a</td>', 'td("a")'],
    ['an end tag closes the elements open inside it', '<div><span>a</div>b', 'div(span("a")) "b"'],
    ['a stray end tag is dropped', '<div>a</span>b</div>', 'div("ab")'],
    ['</br> is a <br>', '<div>a</br>b</div>', 'div("a" br "b")'],
    ['<pre> drops its first newline', '<pre>\nline</pre>', 'pre("line")'],
    ['<pre> keeps a second newline', '<pre>\n\nline</pre>', 'pre("\\nline")'],
    [
      '<textarea> content is text and drops its first newline',
      '<textarea>\n<b>x</b></textarea>',
      'textarea("<b>x</b>")',
    ],
    [
      '<script> and <style> content is text',
      '<script>a<b</script><style>p>q{}</style>',
      'script("a<b") style("p>q{}")',
    ],
    ['svg <style> is not raw text', '<svg><style><b>x</b></style></svg>', 'svg(style) b("x")'],
    [
      'a <template> element has no children in the tree',
      '<div><template><p>x</p></template><i>y</i></div>',
      'div(template i("y"))',
    ],
    ['comments of every form', '<!----><!--x--><!-->a<!--->b', '<!----> <!--x--> <!----> "a" <!----> "b"'],
    ['a doctype is dropped, other markup declarations are comments', '<!doctype html><!x>a', '<!--x--> "a"'],
    ['`<` that opens no tag is text', '<p>1 < 2 <3</p>', 'p("1 < 2 <3")'],
    ['a form control inside a <p> stays', '<p>a<input>b<button>c</button></p>', 'p("a" input "b" button("c"))'],
    ['a button inside a button closes it', '<button>a<button>b</button>', 'button("a") button("b")'],
    ['HTML inside svg ends the svg', '<svg><circle/><div>x</div></svg>', 'svg(circle) div("x")'],
    [
      'foreignObject content is HTML',
      '<svg><foreignObject><div>x</div></foreignObject></svg>',
      'svg(foreignobject(div("x")))',
    ],
    ['a list end tag closes an open item', '<ul><li>a<li>b</ul><p>c</p>', 'ul(li("a") li("b")) p("c")'],
    ['<noscript> holds markup in template content', '<noscript><b>x</b></noscript>', 'noscript(b("x"))'],
    ['table parts outside a table are dropped', '<div><tr><td>x</td></tr></div>', 'div("x")'],
    ['<body> inside a template is dropped', '<body><p>x</p></body>', 'p("x")'],
    ['a <form> inside another is dropped', '<form><form></form></form>', 'form'],
  ];
  for (const [name, html, expected] of rows) {
    test(name, () => {
      expect(tree(html)).toBe(expected);
      expect(problems(html)).toEqual([]);
    });
  }

  test('elements are numbered in document order, as querySelectorAll("*") lists them', () => {
    const model = buildDomModel('<p>a<div><b>x</b></div></p><table><tr><td>c</td></tr></table>');
    expect(model.elements.map((e) => `${e.order}:${e.tag}`)).toEqual([
      '0:p',
      '1:div',
      '2:b',
      '3:p',
      '4:table',
      '5:tbody',
      '6:tr',
      '7:td',
    ]);
  });

  test('attributes: lower-case names, the first of two with one name, quoted and unquoted values', () => {
    const [el] = buildDomModel(`<DIV Data-A="1" data-a="2" b=x c='y' d>t</DIV>`).roots;
    expect(el!.tag).toBe('div');
    expect([...el!.attrs]).toEqual([
      ['data-a', '1'],
      ['b', 'x'],
      ['c', 'y'],
      ['d', ''],
    ]);
  });
});

describe('markup the model reports instead of guessing', () => {
  const rows: [string, string, RegExp][] = [
    ['text directly in a table', '<table>x<tr><td>a</td></tr></table>', /moves text out of the table/],
    ['an element directly in a table', '<table><div>x</div></table>', /moves <div> out of the table/],
    ['an element directly in a row', '<table><tr><b>x</b></tr></table>', /moves <b> out of the table/],
    ['a formatting element closed by another end tag', '<div><b>x</div>y', /re-opens it/],
    ['a formatting element closed by a block element', '<p><i>x<div>y</div>', /re-opens it/],
    ['misnested formatting end tags', '<b><i>x</b>y</i>', /restructures the markup/],
    ['a link inside a link', '<a href="1"><a href="2">x</a></a>', /closes the outer one/],
    ['a non-option element in a select', '<select><div>x</div></select>', /inside <select>/],
  ];
  for (const [name, html, message] of rows) {
    test(name, () => {
      expect(problems(html).join('\n')).toMatch(message);
    });
  }

  test('a formatting element closed inside a cell is forgotten when the cell ends', () => {
    expect(problems('<table><tr><td><b>x</td><td>y</td></tr></table>')).toEqual([]);
  });
});

describe('cookTemplateText', () => {
  test('escape sequences read as the template literal means them', () => {
    expect(cookTemplateText('a\\nb\\tc\\\\d\\`e\\${f}\\x41\\u0042\\u{43}\\q')).toBe('a\nb\tc\\d`e${f}ABCq');
  });
  test('a line continuation disappears and line endings become \\n', () => {
    expect(cookTemplateText('a\\\nb\r\nc\rd')).toBe('ab\nc\nd');
  });
});
