/**
 * Characterisation of the HTML template parser.
 *
 * Each case pins the whole parse result of `parseHtmlTemplate`: the element tree with every
 * recorded position, attributes, `when()` directives and text nodes, then the bindings in the
 * order they are reported, then the diagnostics. The expected lines were captured from the parser;
 * a line that looks wrong is still the parser's behaviour.
 */
import { describe, expect, test } from 'bun:test';
import { parseHtmlTemplate } from './index.js';
import type { BindingDetectionOptions, HtmlElement, ParsedTemplate } from './index.js';

/** One line per element (indented by depth), attribute, directive, text node, binding and diagnostic. */
const describeTree = (parsed: ParsedTemplate): string[] => {
  const lines: string[] = [];
  const element = (e: HtmlElement, depth: number) => {
    const pad = '  '.repeat(depth);
    const flags = [e.isVoid ? 'void' : '', e.isSelfClosing ? 'self-closing' : ''].filter(Boolean).join(' ');
    lines.push(
      `${pad}<${e.tagName}> tag ${e.tagStart}-${e.tagNameEnd} open-end ${e.openTagEnd} close ${e.closeTagStart}-${e.closeTagEnd}${flags ? ' ' + flags : ''}`,
    );
    if (e.whenDirective !== undefined) {
      lines.push(`${pad}  when ${JSON.stringify(e.whenDirective)} ${e.whenDirectiveStart}-${e.whenDirectiveEnd}`);
    }
    for (const [name, a] of e.attributes) {
      lines.push(
        `${pad}  attr ${name}=${JSON.stringify(a.value)} ${a.start}-${a.end} value ${a.valueStart}-${a.valueEnd}`,
      );
    }
    for (const t of e.textContent) lines.push(`${pad}  text ${JSON.stringify(t.content)} ${t.start}-${t.end}`);
    for (const c of e.children) {
      if (c.parent !== e) lines.push(`${pad}  (parent link broken)`);
      element(c, depth + 1);
    }
  };
  for (const root of parsed.roots) element(root, 0);
  for (const b of parsed.bindings) {
    const { element: owner, type, ...rest } = b;
    const fields = Object.entries(rest)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    lines.push(`binding ${type} on <${owner.tagName}@${owner.tagStart}> ${fields}`);
  }
  for (const d of parsed.diagnostics) lines.push(`${d.severity} @${d.position}: ${d.message}`);
  return lines;
};

const tree = (name: string, html: string, expected: string[], options?: BindingDetectionOptions) => {
  test(name, () => {
    const parsed = parseHtmlTemplate(html, options);
    expect(parsed.html).toBe(html);
    expect(describeTree(parsed)).toEqual(expected);
  });
};

describe('attributes', () => {
  tree(
    'unquoted values, a bare attribute, and a value with a slash',
    '<input type=text value=abc disabled><a href=/x>go</a>',
    [
      '<input> tag 0-6 open-end 36 close 36-36 void',
      '  attr type="text" 7-16 value 12-16',
      '  attr value="abc" 17-26 value 23-26',
      '  attr disabled="" 27-35 value 35-35',
      '<a> tag 36-38 open-end 47 close 49-53',
      '  attr href="/x" 39-46 value 44-46',
      '  text "go" 47-49',
    ],
  );
  tree('whitespace around = and between attributes', '<div  a = "1"   b\n=\'2\'  c ></div>', [
    '<div> tag 0-4 open-end 27 close 27-33',
    '  attr a="1" 6-13 value 11-12',
    '  attr b="2" 16-22 value 20-21',
    '  attr c="" 24-25 value 25-25',
  ]);
  tree(
    '${} values: bare signal, text around an expression, a non-signal call, an event handler',
    '<div class=${cls()} title="a ${t()} b" data-x=${fn({ a: 1 })} @click=${() => go(1)}></div>',
    [
      '<div> tag 0-4 open-end 84 close 84-90',
      '  attr class="${cls()}" 5-19 value 11-19',
      '  attr title="a ${t()} b" 20-38 value 27-37',
      '  attr data-x="${fn({ a: 1 })}" 39-61 value 46-61',
      '  attr @click="${() => go(1)}" 62-83 value 69-83',
      'binding attr on <div@0> signalName="cls" property="class" expressionStart=11 expressionEnd=19 fullExpression="${cls()}"',
      'binding attr on <div@0> signalName="t" signalNames=["t"] jsExpression="`a ${t()} b`" property="title" expressionStart=27 expressionEnd=37 fullExpression="a ${t()} b"',
      'binding event on <div@0> signalName="" eventName="click" eventModifiers=[] handlerExpression="() => go(1)" expressionStart=62 expressionEnd=83 fullExpression="@click=\\"${() => go(1)}\\""',
    ],
  );
  tree(
    'style declarations and a whole-value style expression',
    '<p style="color: ${c()}; width: ${w()}px; margin: 0">s</p><p style=${css()}>t</p>',
    [
      '<p> tag 0-2 open-end 53 close 54-58',
      '  attr style="color: ${c()}; width: ${w()}px; margin: 0" 3-52 value 10-51',
      '  text "s" 53-54',
      '<p> tag 58-60 open-end 76 close 77-81',
      '  attr style="${css()}" 61-75 value 67-75',
      '  text "t" 76-77',
      'binding style on <p@0> signalName="c" property="color" expressionStart=17 expressionEnd=23 fullExpression="${c()}"',
      'binding style on <p@0> signalName="w" signalNames=["w"] jsExpression="`${w()}px`" property="width" expressionStart=32 expressionEnd=40 fullExpression="${w()}px"',
      'binding attr on <p@58> signalName="css" property="style" expressionStart=67 expressionEnd=75 fullExpression="${css()}"',
    ],
  );
  tree(
    'non-signal expressions with detectNonSignalBindings',
    '<p title=${product.title} style="width: ${size}px">${product.name}</p>',
    [
      '<p> tag 0-2 open-end 51 close 66-70',
      '  attr title="${product.title}" 3-25 value 9-25',
      '  attr style="width: ${size}px" 26-50 value 33-49',
      '  text "${product.name}" 51-66',
      'binding attr on <p@0> signalName="" signalNames=[] jsExpression="product.title" property="title" expressionStart=9 expressionEnd=25 fullExpression="${product.title}"',
      'binding style on <p@0> signalName="" signalNames=[] jsExpression="`${size}px`" property="width" expressionStart=40 expressionEnd=49 fullExpression="${size}px"',
      'binding text on <p@0> signalName="" signalNames=[] expressionStart=51 expressionEnd=66 fullExpression="${product.name}" jsExpression="product.name"',
    ],
    { detectNonSignalBindings: true },
  );
  tree(
    'non-signal expressions without detectNonSignalBindings',
    '<p title=${product.title} style="width: ${size}px">${product.name}</p>',
    [
      '<p> tag 0-2 open-end 51 close 66-70',
      '  attr title="${product.title}" 3-25 value 9-25',
      '  attr style="width: ${size}px" 26-50 value 33-49',
      '  text "${product.name}" 51-66',
    ],
  );
  // Of two attributes with one name the first is kept, as browsers do, and the second is reported
  tree('a duplicated attribute keeps the first', '<input checked=${c()} checked value="a" value=${v()}>', [
    '<input> tag 0-6 open-end 53 close 53-53 void',
    '  attr checked="${c()}" 7-21 value 15-21',
    '  attr value="a" 30-39 value 37-38',
    'binding attr on <input@0> signalName="c" property="checked" expressionStart=15 expressionEnd=21 fullExpression="${c()}"',
    'warning @22: Duplicate attribute "checked" on <input>: the first one is kept',
    'warning @40: Duplicate attribute "value" on <input>: the first one is kept',
  ]);
  // A namespaced closing tag matches its opening tag
  tree('namespaced names', '<svg:rect xlink:href="#a"></svg:rect>', [
    '<svg:rect> tag 0-9 open-end 26 close 26-37',
    '  attr xlink:href="#a" 10-25 value 22-24',
  ]);
});

describe('when() in a tag', () => {
  tree(
    'before and after other attributes',
    '<p ${when(show())} class="a">x</p><p class="b" ${when(a() && b())}>y</p>',
    [
      '<p> tag 0-2 open-end 29 close 30-34',
      '  when "${when(show())}" 3-18',
      '  attr class="a" 19-28 value 26-27',
      '  text "x" 29-30',
      '<p> tag 34-36 open-end 67 close 68-72',
      '  when "${when(a() && b())}" 47-66',
      '  attr class="b" 37-46 value 44-45',
      '  text "y" 67-68',
      'binding when on <p@0> signalName="show" signalNames=["show"] expressionStart=3 expressionEnd=18 fullExpression="${when(show())}" jsExpression="show()"',
      'binding when on <p@34> signalName="a" signalNames=["a","b"] expressionStart=47 expressionEnd=66 fullExpression="${when(a() && b())}" jsExpression="a() && b()"',
    ],
  );
  tree('braces inside the condition', '<p ${when(pick({ a: on() }))}>x</p>', [
    '<p> tag 0-2 open-end 30 close 31-35',
    '  when "${when(pick({ a: on() }))}" 3-29',
    '  text "x" 30-31',
    'binding when on <p@0> signalName="on" signalNames=["on"] expressionStart=3 expressionEnd=29 fullExpression="${when(pick({ a: on() }))}" jsExpression="pick({ a: on() })"',
  ]);
  tree('on a void element', '<input ${when(on())} value=1>', [
    '<input> tag 0-6 open-end 29 close 29-29 void',
    '  when "${when(on())}" 7-20',
    '  attr value="1" 21-28 value 27-28',
    'binding when on <input@0> signalName="on" signalNames=["on"] expressionStart=7 expressionEnd=20 fullExpression="${when(on())}" jsExpression="on()"',
  ]);
  // A brace inside a string does not end the directive (it did before)
  tree('a quoted brace inside the condition', "<p ${when(x() === '}')}>a</p>", [
    '<p> tag 0-2 open-end 24 close 25-29',
    '  when "${when(x() === \'}\')}" 3-23',
    '  text "a" 24-25',
    'binding when on <p@0> signalName="x" signalNames=["x"] expressionStart=3 expressionEnd=23 fullExpression="${when(x() === \'}\')}" jsExpression="x() === \'}\'"',
  ]);
});

describe('comments and markup declarations', () => {
  tree(
    'comments at the root and inside, with a tag in the comment',
    '<!-- head --><div><!-- a <b> inside --><span>t</span></div><!-- tail -->',
    ['<div> tag 13-17 open-end 18 close 53-59', '  <span> tag 39-44 open-end 45 close 46-53', '    text "t" 45-46'],
  );
  tree('a doctype is text', '<!DOCTYPE html><p>a</p>', ['<p> tag 15-17 open-end 18 close 19-23', '  text "a" 18-19']);
});

describe('void and self-closing tags', () => {
  tree('void, void self-closed, non-void self-closed', '<br><img src="a.png"/><div/><input disabled/><hr />', [
    '<br> tag 0-3 open-end 4 close 4-4 void',
    '<img> tag 4-8 open-end 22 close 22-22 void self-closing',
    '  attr src="a.png" 9-20 value 14-19',
    '<div> tag 22-26 open-end 28 close 28-28 self-closing',
    '<input> tag 28-34 open-end 45 close 45-45 void',
    '  attr disabled="" 35-44 value 44-44',
    '<hr> tag 45-48 open-end 51 close 51-51 void self-closing',
  ]);
  tree('text after a void element belongs to the parent', '<p>a<br>b<img src=x>c</p>', [
    '<p> tag 0-2 open-end 3 close 21-25',
    '  text "a" 3-4',
    '  text "b" 8-9',
    '  text "c" 20-21',
    '  <br> tag 4-7 open-end 8 close 8-8 void',
    '  <img> tag 9-13 open-end 20 close 20-20 void',
    '    attr src="x" 14-19 value 18-19',
  ]);
});

describe('unclosed and orphaned tags', () => {
  tree('implicitly closed and unclosed at the end', '<div><span>text</div><p>open', [
    '<div> tag 0-4 open-end 5 close 15-21',
    '  <span> tag 5-10 open-end 11 close 0-0',
    '    text "text" 11-15',
    '<p> tag 21-23 open-end 24 close 0-0',
    '  text "open" 24-28',
    'warning @5: Unclosed tag <span> (implicitly closed by </div>)',
    'error @21: Unclosed tag <p> (reached end of template)',
  ]);
  tree('orphaned closing tags', '</b><div>x</div></i>', [
    '<div> tag 4-8 open-end 9 close 10-16',
    '  text "x" 9-10',
    'error @0: Orphaned closing tag </b> with no matching open tag',
    'error @16: Orphaned closing tag </i> with no matching open tag',
  ]);
  tree('closing tags match case-insensitively', '<DIV>x</div>', [
    '<DIV> tag 0-4 open-end 5 close 6-12',
    '  text "x" 5-6',
  ]);
});

describe('text', () => {
  tree('text at the root, with bindings', 'hello ${name()} <b>bold</b> tail ${a() + 1}', [
    '<b> tag 16-18 open-end 19 close 23-27',
    '  text "bold" 19-23',
    'binding text on <__root__@0> signalName="name" expressionStart=6 expressionEnd=15 fullExpression="${name()}"',
    'binding text on <__root__@0> signalName="a" signalNames=["a"] expressionStart=33 expressionEnd=43 fullExpression="${a() + 1}" jsExpression="a() + 1"',
  ]);
  tree(
    'bare, complex, whenElse and repeat expressions in one text node',
    '<p>${count()} and ${count() * 2} ${when(on(), html`<i>y</i>`, html`<i>n</i>`)} ${repeat(items(), (it) => html`<li>${it}</li>`)}</p>',
    [
      '<p> tag 0-2 open-end 3 close 127-131',
      '  text "${count()} and ${count() * 2} ${when(on(), html`<i>y</i>`, html`<i>n</i>`)} ${repeat(items(), (it) => html`<li>${it}</li>`)}" 3-127',
      'binding repeat on <p@0> signalName="items" signalNames=["items"] expressionStart=79 expressionEnd=127 fullExpression="${repeat(items(), (it) => html`<li>${it}</li>`)}" itemsExpression="items()" itemVar="it" itemTemplate="<li>${it}</li>"',
      'binding whenElse on <p@0> signalName="on" signalNames=["on"] expressionStart=33 expressionEnd=78 fullExpression="${when(on(), html`<i>y</i>`, html`<i>n</i>`)}" jsExpression="on()" thenTemplate="<i>y</i>" elseTemplate="<i>n</i>"',
      'binding text on <p@0> signalName="count" expressionStart=3 expressionEnd=13 fullExpression="${count()}"',
      'binding text on <p@0> signalName="count" signalNames=["count"] expressionStart=18 expressionEnd=32 fullExpression="${count() * 2}" jsExpression="count() * 2"',
    ],
  );
  tree('< and > inside an expression', '<p>${a() > b() ? "<" : ">"}</p>', [
    '<p> tag 0-2 open-end 3 close 27-31',
    '  text "${a() > b() ? \\"<\\" : \\">\\"}" 3-27',
    'binding text on <p@0> signalName="a" signalNames=["a","b"] expressionStart=3 expressionEnd=27 fullExpression="${a() > b() ? \\"<\\" : \\">\\"}" jsExpression="a() > b() ? \\"<\\" : \\">\\""',
  ]);
  tree('nested template literals', '<p>${`x ${a()} ${`y ${b()}`}`}</p>', [
    '<p> tag 0-2 open-end 3 close 30-34',
    '  text "${`x ${a()} ${`y ${b()}`}`}" 3-30',
    'binding text on <p@0> signalName="a" expressionStart=8 expressionEnd=14 fullExpression="${a()}"',
    'binding text on <p@0> signalName="b" expressionStart=20 expressionEnd=26 fullExpression="${b()}"',
    'binding text on <p@0> signalName="a" signalNames=["a","b"] expressionStart=3 expressionEnd=30 fullExpression="${`x ${a()} ${`y ${b()}`}`}" jsExpression="`x ${a()} ${`y ${b()}`}`"',
  ]);
  tree('an expression with an object literal', '<p>${fmt({ a: n() })}</p>', [
    '<p> tag 0-2 open-end 3 close 21-25',
    '  text "${fmt({ a: n() })}" 3-21',
    'binding text on <p@0> signalName="n" signalNames=["n"] expressionStart=3 expressionEnd=21 fullExpression="${fmt({ a: n() })}" jsExpression="fmt({ a: n() })"',
  ]);
  tree('text split by child elements', '<p>a ${x()} <b>b</b> c ${y()}</p>', [
    '<p> tag 0-2 open-end 3 close 29-33',
    '  text "a ${x()} " 3-12',
    '  text " c ${y()}" 20-29',
    '  <b> tag 12-14 open-end 15 close 16-20',
    '    text "b" 15-16',
    'binding text on <p@0> signalName="x" expressionStart=5 expressionEnd=11 fullExpression="${x()}"',
    'binding text on <p@0> signalName="y" expressionStart=23 expressionEnd=29 fullExpression="${y()}"',
  ]);
});

// Paths the cases above do not reach (unterminated scans, when() on self-closed tags, every binding
// shape).
describe('more tag and attribute paths', () => {
  tree('an unterminated ${when( in a tag is read as attribute names', '<p ${when(a()>x</p>', [
    '<p> tag 0-2 open-end 14 close 15-19',
    '  attr whena="" 5-13 value 13-13',
    '  text "x" 14-15',
  ]);
  tree('an unterminated attribute expression is read as an unquoted value', '<p a=${x() b="1">t</p>', [
    '<p> tag 0-2 open-end 17 close 18-22',
    '  attr a="{x()" 3-10 value 6-10',
    '  attr b="1" 11-16 value 14-15',
    '  text "t" 17-18',
  ]);
  tree('when() on self-closed and void tags', '<input ${when(on())}/><my-el ${when(a())} /><br ${when(b())}>', [
    '<input> tag 0-6 open-end 22 close 22-22 void self-closing',
    '  when "${when(on())}" 7-20',
    '<my-el> tag 22-28 open-end 44 close 44-44 self-closing',
    '  when "${when(a())}" 29-41',
    '<br> tag 44-47 open-end 61 close 61-61 void',
    '  when "${when(b())}" 48-60',
    'binding when on <input@0> signalName="on" signalNames=["on"] expressionStart=7 expressionEnd=20 fullExpression="${when(on())}" jsExpression="on()"',
    'binding when on <my-el@22> signalName="a" signalNames=["a"] expressionStart=29 expressionEnd=41 fullExpression="${when(a())}" jsExpression="a()"',
    'binding when on <br@44> signalName="b" signalNames=["b"] expressionStart=48 expressionEnd=60 fullExpression="${when(b())}" jsExpression="b()"',
  ]);
  tree('unquoted values that run into /> or >', '<img src=x/><a href=y>z</a>', [
    '<img> tag 0-4 open-end 12 close 12-12 void',
    '  attr src="x/" 5-11 value 9-11',
    '<a> tag 12-14 open-end 22 close 23-27',
    '  attr href="y" 15-21 value 20-21',
    '  text "z" 22-23',
  ]);
  tree(
    'attribute expressions with nested braces and template literals',
    '<p title=${`a ${b()}`} data-o=${{ k: c() }.k}>x</p>',
    [
      '<p> tag 0-2 open-end 46 close 47-51',
      '  attr title="${`a ${b()}`}" 3-22 value 9-22',
      '  attr data-o="${{ k: c() }.k}" 23-45 value 30-45',
      '  text "x" 46-47',
      'binding attr on <p@0> signalName="b" signalNames=["b"] jsExpression="`a ${b()}`" property="title" expressionStart=9 expressionEnd=22 fullExpression="${`a ${b()}`}"',
      'binding attr on <p@0> signalName="c" signalNames=["c"] jsExpression="{ k: c() }.k" property="data-o" expressionStart=30 expressionEnd=45 fullExpression="${{ k: c() }.k}"',
    ],
  );
  tree('quoted values containing > and expressions', '<a title="x > ${y()}" b=\'${z()}\'>t</a>', [
    '<a> tag 0-2 open-end 33 close 34-38',
    '  attr title="x > ${y()}" 3-21 value 10-20',
    '  attr b="${z()}" 22-32 value 25-31',
    '  text "t" 33-34',
    'binding attr on <a@0> signalName="y" signalNames=["y"] jsExpression="`x > ${y()}`" property="title" expressionStart=10 expressionEnd=20 fullExpression="x > ${y()}"',
    'binding attr on <a@0> signalName="z" property="b" expressionStart=25 expressionEnd=31 fullExpression="${z()}"',
  ]);
  // A text node that starts with a stray "<" starts at that "<" (it used to keep the start of
  // the text before it, so later bindings got positions that were too small)
  tree('a < that does not open a tag is text', '<p>a < b <1 c</p>', [
    '<p> tag 0-2 open-end 3 close 13-17',
    '  text "a " 3-5',
    '  text "< b " 5-9',
    '  text "<1 c" 9-13',
  ]);
  tree('bindings after a < that does not open a tag', '<p>1 < 2 ${x()} <!x ${y() + 1}</p>', [
    '<p> tag 0-2 open-end 3 close 30-34',
    '  text "1 " 3-5',
    '  text "< 2 ${x()} " 5-16',
    '  text "<!x ${y() + 1}" 16-30',
    'binding text on <p@0> signalName="x" expressionStart=9 expressionEnd=15 fullExpression="${x()}"',
    'binding text on <p@0> signalName="y" signalNames=["y"] expressionStart=20 expressionEnd=30 fullExpression="${y() + 1}" jsExpression="y() + 1"',
  ]);
  tree('whitespace inside closing tags', '<p>x</p ><b>y</ b>', [
    '<p> tag 0-2 open-end 3 close 4-9',
    '  text "x" 3-4',
    '<b> tag 9-11 open-end 12 close 13-18',
    '  text "y" 12-13',
  ]);
  tree('an unterminated comment swallows the rest', '<p>a<!-- x ${y()}</p>', [
    '<p> tag 0-2 open-end 3 close 0-0',
    '  text "a" 3-4',
    'error @0: Unclosed tag <p> (reached end of template)',
  ]);
  tree('an unterminated text expression swallows the rest', '<p>${a() + 1</p><b>x</b>', [
    '<p> tag 0-2 open-end 3 close 0-0',
    '  text "${a() + 1</p><b>x</b>" 3-24',
    'error @0: Unclosed tag <p> (reached end of template)',
  ]);
  tree('a bare attribute before /> does not self-close the tag', '<my-el flag/>t', [
    '<my-el> tag 0-6 open-end 13 close 0-0',
    '  attr flag="" 7-12 value 12-12',
    '  text "t" 13-14',
    'error @0: Unclosed tag <my-el> (reached end of template)',
  ]);
  // They were dropped and the name went on (`<pwhenx>`); a missing space is reported now, and the rest
  // is read as the tag's attributes
  tree('a character a tag name cannot hold starts the attributes, reported', '<p${when(x())}>y</p>', [
    '<p> tag 0-2 open-end 15 close 16-20',
    '  when "${when(x())}" 2-14',
    '  text "y" 15-16',
    'binding when on <p@0> signalName="x" signalNames=["x"] expressionStart=2 expressionEnd=14 fullExpression="${when(x())}" jsExpression="x()"',
    'error @2: Missing space after <p: "$" cannot be part of a tag name, and is read as the start of an attribute',
  ]);
  tree(
    'event bindings with modifiers, and an event value that is not an expression',
    '<button @click.stop.prevent=${() => go()} @input="plain">b</button>',
    [
      '<button> tag 0-7 open-end 57 close 58-67',
      '  attr @click.stop.prevent="${() => go()}" 8-41 value 28-41',
      '  attr @input="plain" 42-56 value 50-55',
      '  text "b" 57-58',
      'binding event on <button@0> signalName="" eventName="click" eventModifiers=["stop","prevent"] handlerExpression="() => go()" expressionStart=8 expressionEnd=41 fullExpression="@click.stop.prevent=\\"${() => go()}\\""',
    ],
  );
});
describe('binding shapes', () => {
  tree(
    'attribute: several expressions, a bare read with spaces, a complex single expression',
    '<a href="/u/${id()}/${tab()}" title="${ t() }" data-n="${n() + 1}" class="${a()}${b()}">x</a>',
    [
      '<a> tag 0-2 open-end 88 close 89-93',
      '  attr href="/u/${id()}/${tab()}" 3-29 value 9-28',
      '  attr title="${ t() }" 30-46 value 37-45',
      '  attr data-n="${n() + 1}" 47-66 value 55-65',
      '  attr class="${a()}${b()}" 67-87 value 74-86',
      '  text "x" 88-89',
      'binding attr on <a@0> signalName="id" signalNames=["id","tab"] jsExpression="`/u/${id()}/${tab()}`" property="href" expressionStart=9 expressionEnd=28 fullExpression="/u/${id()}/${tab()}"',
      'binding attr on <a@0> signalName="t" property="title" expressionStart=37 expressionEnd=45 fullExpression="${ t() }"',
      'binding attr on <a@0> signalName="n" signalNames=["n"] jsExpression="n() + 1" property="data-n" expressionStart=55 expressionEnd=65 fullExpression="${n() + 1}"',
      'binding attr on <a@0> signalName="a" signalNames=["a","b"] jsExpression="`${a()}${b()}`" property="class" expressionStart=74 expressionEnd=86 fullExpression="${a()}${b()}"',
    ],
  );
  tree(
    'attribute: signal and non-signal template literals with detectNonSignalBindings',
    '<a href="/u/${user.id}/${tab()}" title="${label}" alt="${ok ? \'y\' : \'n\'} x">x</a>',
    [
      '<a> tag 0-2 open-end 76 close 77-81',
      '  attr href="/u/${user.id}/${tab()}" 3-32 value 9-31',
      '  attr title="${label}" 33-49 value 40-48',
      "  attr alt=\"${ok ? 'y' : 'n'} x\" 50-75 value 55-74",
      '  text "x" 76-77',
      'binding attr on <a@0> signalName="tab" signalNames=["tab"] jsExpression="`/u/${user.id}/${tab()}`" property="href" expressionStart=9 expressionEnd=31 fullExpression="/u/${user.id}/${tab()}"',
      'binding attr on <a@0> signalName="" signalNames=[] jsExpression="label" property="title" expressionStart=40 expressionEnd=48 fullExpression="${label}"',
      'binding attr on <a@0> signalName="" signalNames=[] jsExpression="`${ok ? \'y\' : \'n\'} x`" property="alt" expressionStart=55 expressionEnd=74 fullExpression="${ok ? \'y\' : \'n\'} x"',
    ],
    { detectNonSignalBindings: true },
  );
  tree(
    'attribute: signal and non-signal template literals without detectNonSignalBindings',
    '<a href="/u/${user.id}/${tab()}" title="${label}" alt="${ok ? \'y\' : \'n\'} x">x</a>',
    [
      '<a> tag 0-2 open-end 76 close 77-81',
      '  attr href="/u/${user.id}/${tab()}" 3-32 value 9-31',
      '  attr title="${label}" 33-49 value 40-48',
      "  attr alt=\"${ok ? 'y' : 'n'} x\" 50-75 value 55-74",
      '  text "x" 76-77',
      'binding attr on <a@0> signalName="tab" signalNames=["tab"] jsExpression="`/u/${user.id}/${tab()}`" property="href" expressionStart=9 expressionEnd=31 fullExpression="/u/${user.id}/${tab()}"',
    ],
  );
  tree(
    'style: bare, complex single, several expressions, static only',
    "<p style=\"color: ${c()}; background: ${on() ? 'red' : 'blue'}; margin: ${a()}px ${b()}em; top: 0\">s</p>",
    [
      '<p> tag 0-2 open-end 98 close 99-103',
      "  attr style=\"color: ${c()}; background: ${on() ? 'red' : 'blue'}; margin: ${a()}px ${b()}em; top: 0\" 3-97 value 10-96",
      '  text "s" 98-99',
      'binding style on <p@0> signalName="c" property="color" expressionStart=17 expressionEnd=23 fullExpression="${c()}"',
      'binding style on <p@0> signalName="on" signalNames=["on"] jsExpression="on() ? \'red\' : \'blue\'" property="background" expressionStart=37 expressionEnd=61 fullExpression="${on() ? \'red\' : \'blue\'}"',
      'binding style on <p@0> signalName="a" signalNames=["a","b"] jsExpression="`${a()}px ${b()}em`" property="margin" expressionStart=71 expressionEnd=88 fullExpression="${a()}px ${b()}em"',
    ],
  );
  tree(
    'style: non-signal values with detectNonSignalBindings',
    '<p style="color: ${c}; margin: ${a}px ${b()}em; left: ${ l() }">s</p>',
    [
      '<p> tag 0-2 open-end 64 close 65-69',
      '  attr style="color: ${c}; margin: ${a}px ${b()}em; left: ${ l() }" 3-63 value 10-62',
      '  text "s" 64-65',
      'binding style on <p@0> signalName="" signalNames=[] jsExpression="c" property="color" expressionStart=17 expressionEnd=21 fullExpression="${c}"',
      'binding style on <p@0> signalName="b" signalNames=["b"] jsExpression="`${a}px ${b()}em`" property="margin" expressionStart=31 expressionEnd=46 fullExpression="${a}px ${b()}em"',
      'binding style on <p@0> signalName="l" property="left" expressionStart=54 expressionEnd=62 fullExpression="${ l() }"',
    ],
    { detectNonSignalBindings: true },
  );
  tree(
    'a call whose callee is not an identifier is not a signal read',
    '<p title=${1()} style="color: ${this()}">${1()} ${this()}</p>',
    [
      '<p> tag 0-2 open-end 41 close 57-61',
      '  attr title="${1()}" 3-15 value 9-15',
      '  attr style="color: ${this()}" 16-40 value 23-39',
      '  text "${1()} ${this()}" 41-57',
      'binding attr on <p@0> signalName="" signalNames=[] jsExpression="1()" property="title" expressionStart=9 expressionEnd=15 fullExpression="${1()}"',
      'binding style on <p@0> signalName="" signalNames=[] jsExpression="this()" property="color" expressionStart=30 expressionEnd=39 fullExpression="${this()}"',
      'binding text on <p@0> signalName="1" expressionStart=41 expressionEnd=47 fullExpression="${1()}"',
      'binding text on <p@0> signalName="this" expressionStart=48 expressionEnd=57 fullExpression="${this()}"',
    ],
    { detectNonSignalBindings: true },
  );
  tree(
    'text: spaces around expressions, and empty expressions',
    '<p>${ a() + 1 } ${} ${ } ${ b() } ${ c }</p>',
    [
      '<p> tag 0-2 open-end 3 close 40-44',
      '  text "${ a() + 1 } ${} ${ } ${ b() } ${ c }" 3-40',
      'binding text on <p@0> signalName="a" signalNames=["a"] expressionStart=3 expressionEnd=15 fullExpression="${ a() + 1 }" jsExpression=" a() + 1 "',
      'binding text on <p@0> signalName="b" signalNames=["b"] expressionStart=25 expressionEnd=33 fullExpression="${ b() }" jsExpression=" b() "',
      'binding text on <p@0> signalName="" signalNames=[] expressionStart=34 expressionEnd=40 fullExpression="${ c }" jsExpression=" c "',
    ],
    { detectNonSignalBindings: true },
  );
  tree(
    'text: expressions inside whenElse and repeat arguments are not text bindings of the parent',
    '<p>${when(on(), html`<b>${x()}</b>`, html`<i>${y() + 1}</i>`)} ${repeat(items(), (it) => html`<li>${it.n} ${z()}</li>`)} ${w() + 1}</p>',
    [
      '<p> tag 0-2 open-end 3 close 131-135',
      '  text "${when(on(), html`<b>${x()}</b>`, html`<i>${y() + 1}</i>`)} ${repeat(items(), (it) => html`<li>${it.n} ${z()}</li>`)} ${w() + 1}" 3-131',
      'binding repeat on <p@0> signalName="items" signalNames=["items"] expressionStart=63 expressionEnd=120 fullExpression="${repeat(items(), (it) => html`<li>${it.n} ${z()}</li>`)}" itemsExpression="items()" itemVar="it" itemTemplate="<li>${it.n} ${z()}</li>"',
      'binding whenElse on <p@0> signalName="on" signalNames=["on"] expressionStart=3 expressionEnd=62 fullExpression="${when(on(), html`<b>${x()}</b>`, html`<i>${y() + 1}</i>`)}" jsExpression="on()" thenTemplate="<b>${x()}</b>" elseTemplate="<i>${y() + 1}</i>"',
      'binding text on <p@0> signalName="w" signalNames=["w"] expressionStart=121 expressionEnd=131 fullExpression="${w() + 1}" jsExpression="w() + 1"',
    ],
  );
  // The directive ranges end at the call's `)`, so `${q() + 1}` after it is still reached as its own
  // expression. Skipping each whole `${…}` that starts in a directive range would lose it.
  tree(
    'text: a directive call inside a larger expression, and a space before the closing brace',
    '<p>${repeat(items(), (it) => html`<li>${it}</li>`) || `${q() + 1}`} ${when(on(), html`a`, html`b`) } ${r() * 2}</p>',
    [
      '<p> tag 0-2 open-end 3 close 111-115',
      '  text "${repeat(items(), (it) => html`<li>${it}</li>`) || `${q() + 1}`} ${when(on(), html`a`, html`b`) } ${r() * 2}" 3-111',
      'binding repeat on <p@0> signalName="items" signalNames=["items"] expressionStart=3 expressionEnd=50 fullExpression="${repeat(items(), (it) => html`<li>${it}</li>`)" itemsExpression="items()" itemVar="it" itemTemplate="<li>${it}</li>"',
      'binding whenElse on <p@0> signalName="on" signalNames=["on"] expressionStart=68 expressionEnd=98 fullExpression="${when(on(), html`a`, html`b`)" jsExpression="on()" thenTemplate="a" elseTemplate="b"',
      'binding text on <p@0> signalName="q" signalNames=["q"] expressionStart=55 expressionEnd=65 fullExpression="${q() + 1}" jsExpression="q() + 1"',
      'binding text on <p@0> signalName="r" signalNames=["r"] expressionStart=101 expressionEnd=111 fullExpression="${r() * 2}" jsExpression="r() * 2"',
    ],
  );
});

// One expression scanner. Braces inside strings and nested template literals (any depth,
// escapes included) no longer end an expression; an escaped `\${` is text.
describe('quotes and nested template literals in expressions', () => {
  tree('text: braces inside strings', "<p>${on() ? '}' : '{'} <b>x</b></p>", [
    '<p> tag 0-2 open-end 3 close 31-35',
    "  text \"${on() ? '}' : '{'} \" 3-23",
    '  <b> tag 23-25 open-end 26 close 27-31',
    '    text "x" 26-27',
    'binding text on <p@0> signalName="on" signalNames=["on"] expressionStart=3 expressionEnd=22 fullExpression="${on() ? \'}\' : \'{\'}" jsExpression="on() ? \'}\' : \'{\'"',
  ]);
  tree('attributes: a brace inside a string', '<p style="color: ${on() ? \'}\' : \'red\'}" title=${"a}" + t()}>s</p>', [
    '<p> tag 0-2 open-end 60 close 61-65',
    "  attr style=\"color: ${on() ? '}' : 'red'}\" 3-39 value 10-38",
    '  attr title="${\\"a}\\" + t()}" 40-59 value 46-59',
    '  text "s" 60-61',
    'binding style on <p@0> signalName="on" signalNames=["on"] jsExpression="on() ? \'}\' : \'red\'" property="color" expressionStart=17 expressionEnd=38 fullExpression="${on() ? \'}\' : \'red\'}"',
    'binding attr on <p@0> signalName="t" signalNames=["t"] jsExpression="\\"a}\\" + t()" property="title" expressionStart=46 expressionEnd=59 fullExpression="${\\"a}\\" + t()}"',
  ]);
  tree('text: template literals nested three deep', '<p>${`a ${`b ${`c ${d()}`}`}`} <i>y</i></p>', [
    '<p> tag 0-2 open-end 3 close 39-43',
    '  text "${`a ${`b ${`c ${d()}`}`}`} " 3-31',
    '  <i> tag 31-33 open-end 34 close 35-39',
    '    text "y" 34-35',
    'binding text on <p@0> signalName="d" expressionStart=18 expressionEnd=24 fullExpression="${d()}"',
    'binding text on <p@0> signalName="d" signalNames=["d"] expressionStart=3 expressionEnd=30 fullExpression="${`a ${`b ${`c ${d()}`}`}`}" jsExpression="`a ${`b ${`c ${d()}`}`}`"',
  ]);
  tree(
    'text: an escaped backtick in a nested template literal, and an escaped ${',
    '<p>${`a \\` ${b()}`} \\${c()} <i>z</i></p>',
    [
      '<p> tag 0-2 open-end 3 close 36-40',
      '  text "${`a \\\\` ${b()}`} \\\\${c()} " 3-28',
      '  <i> tag 28-30 open-end 31 close 32-36',
      '    text "z" 31-32',
      'binding text on <p@0> signalName="b" expressionStart=11 expressionEnd=17 fullExpression="${b()}"',
      'binding text on <p@0> signalName="b" signalNames=["b"] expressionStart=3 expressionEnd=19 fullExpression="${`a \\\\` ${b()}`}" jsExpression="`a \\\\` ${b()}`"',
    ],
  );
});

describe('quotes and escapes in directive arguments', () => {
  tree(
    'a row template with braces inside strings',
    '<ul>${repeat(items(), (it) => html`<li>${it.on ? "}" : "{"}</li>`)}</ul>',
    [
      '<ul> tag 0-3 open-end 4 close 67-72',
      '  text "${repeat(items(), (it) => html`<li>${it.on ? \\"}\\" : \\"{\\"}</li>`)}" 4-67',
      'binding repeat on <ul@0> signalName="items" signalNames=["items"] expressionStart=4 expressionEnd=67 fullExpression="${repeat(items(), (it) => html`<li>${it.on ? \\"}\\" : \\"{\\"}</li>`)}" itemsExpression="items()" itemVar="it" itemTemplate="<li>${it.on ? \\"}\\" : \\"{\\"}</li>"',
    ],
  );
  // Before it was fixed, the escaped backtick ended the branch template: no whenElse, and the rest of the
  // template was read as one expression (an unclosed <p>)
  tree('a branch template with an escaped backtick', '<p>${when(on(), html`<i>\\`</i>`, html`<b>{</b>`)}</p>', [
    '<p> tag 0-2 open-end 3 close 49-53',
    '  text "${when(on(), html`<i>\\\\`</i>`, html`<b>{</b>`)}" 3-49',
    'binding whenElse on <p@0> signalName="on" signalNames=["on"] expressionStart=3 expressionEnd=49 fullExpression="${when(on(), html`<i>\\\\`</i>`, html`<b>{</b>`)}" jsExpression="on()" thenTemplate="<i>\\\\`</i>" elseTemplate="<b>{</b>"',
  ]);
});

describe('errors thrown by binding detection', () => {
  test('a ":" prefixed attribute is rejected with THANE006', () => {
    let message = '';
    try {
      parseHtmlTemplate('<img :src=${url()} />');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      'THANE006: attribute ":src" — the ":" prefix is not a binding syntax. Write src=${…} instead.',
    );
  });
});
