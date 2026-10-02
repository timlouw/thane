/**
 * The static text next to text bindings,
 * pinned for rows, component templates, when() content, when() branches and a row's when() content,
 * in development and production builds. One component holds every shape; each shape's emitted template
 * is found by the class on its element.
 *
 * A row template holds each text binding as a marker, a placeholder text node the row writes and a
 * boundary (`<!----> <!---->`); a component template holds the initial value in place of the
 * placeholder. `renderedText` reads a template back as the text it shows (not for shapes with
 * directive anchors, whose comments it cannot tell from markers; e2e/tests/hardening.spec.ts renders
 * those).
 *
 * The shapes with a `lostSpace` used to lose a space: between two bindings ("JohnDoe"), or between a
 * binding and an element or directive next to it ("Name:John", "Ax"). Every other shape is pinned as it
 * is, including whitespace between two elements and at the edges of the binding's parent, which the
 * fix leaves alone.
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs, PROD_BUILD } from '../../testing/build-project.js';

interface Shape {
  /** The element's content as written */
  source: string;
  /** The element's content in the emitted template */
  template: string;
  /** The values the row's text bindings write, in order (absent: the template holds them) */
  values?: string[];
  /** The text the element shows (absent: the template holds directive anchors) */
  text?: string;
  /** The space this shape used to lose, named in its test's title */
  lostSpace?: 'between two bindings' | 'next to an element';
}

const titleFor = (shape: Shape, what: string) =>
  shape.lostSpace ? `${what} (it lost the space ${shape.lostSpace})` : what;

const TWO = '<!----> <!----> <!----> <!---->';

/** Row content, in `<li class="r-<name>">` */
const ROW_SHAPES: Record<string, Shape> = {
  space: {
    source: '${it.a} ${it.b}',
    template: TWO,
    values: ['John', 'Doe'],
    text: 'John Doe',
    lostSpace: 'between two bindings',
  },
  twoSpaces: {
    source: '${it.a}  ${it.b}',
    template: TWO,
    values: ['John', 'Doe'],
    text: 'John Doe',
    lostSpace: 'between two bindings',
  },
  newline: {
    source: '${it.a}\n    ${it.b}',
    template: TWO,
    values: ['John', 'Doe'],
    text: 'John Doe',
    lostSpace: 'between two bindings',
  },
  padded: {
    source: '\n    ${it.a} ${it.b}\n  ',
    template: TWO,
    values: ['John', 'Doe'],
    text: 'John Doe',
    lostSpace: 'between two bindings',
  },
  three: {
    source: '${it.a} ${it.b} ${it.c}',
    template: `${TWO} <!----> <!---->`,
    values: ['John', 'Doe', 'Jr'],
    text: 'John Doe Jr',
    lostSpace: 'between two bindings',
  },
  itemAndSignal: {
    source: '${it.a} ${label()}',
    template: TWO,
    values: ['John', 'L'],
    text: 'John L',
    lostSpace: 'between two bindings',
  },
  signals: {
    source: '${a()} ${b()}',
    template: TWO,
    values: ['A', 'B'],
    text: 'A B',
    lostSpace: 'between two bindings',
  },
  dash: {
    source: '${it.a}-${it.b}',
    template: '<!----> <!---->-<!----> <!---->',
    values: ['John', 'Doe'],
    text: 'John-Doe',
  },
  adjacent: {
    source: '${it.a}${it.b}',
    template: '<!----> <!----><!----> <!---->',
    values: ['John', 'Doe'],
    text: 'JohnDoe',
  },
  around: { source: 'x ${it.a} y', template: 'x <!----> <!----> y', values: ['John'], text: 'x John y' },
  pre: {
    source: '<pre>${it.a} ${it.b}</pre>',
    template: `<pre>${TWO}</pre>`,
    values: ['John', 'Doe'],
    text: 'John Doe',
  },
  beforeElement: {
    source: '${it.a} <b>B</b>',
    template: '<!----> <!----> <b>B</b>',
    values: ['John'],
    text: 'John B',
    lostSpace: 'next to an element',
  },
  afterElement: {
    source: '<b>B</b> ${it.a}',
    template: '<b>B</b> <!----> <!---->',
    values: ['John'],
    text: 'B John',
    lostSpace: 'next to an element',
  },
  label: {
    source: '<b>Name:</b> ${it.a}',
    template: '<b>Name:</b> <!----> <!---->',
    values: ['John'],
    text: 'Name: John',
    lostSpace: 'next to an element',
  },
  afterVoid: {
    source: '<input type="checkbox"> ${it.a}',
    template: '<input type="checkbox"> <!----> <!---->',
    values: ['John'],
    text: ' John',
    lostSpace: 'next to an element',
  },
  // Between the two elements a space on one line stays, as it does next to the binding
  betweenElements: {
    source: '<b>x</b> <i>y</i> ${it.a}',
    template: '<b>x</b> <i>y</i> <!----> <!---->',
    values: ['John'],
    text: 'x y John',
    lostSpace: 'next to an element',
  },
  // At the start of the binding's parent the whitespace goes; after its last element one space stays
  edges: {
    source: ' ${it.a} <b>x</b> ',
    template: '<!----> <!----> <b>x</b> ',
    values: ['John'],
    text: 'John x ',
    lostSpace: 'next to an element',
  },
  // Whitespace that holds a line break goes between tags: it is the template's own formatting
  lineBreaks: {
    source: '\n  <b>x</b>\n  <i>y</i>\n  ${it.a}',
    template: '<b>x</b><i>y</i> <!----> <!---->',
    values: ['John'],
    text: 'xy John',
  },
  when: {
    source: '${it.a} <span ${when(it.on)}>w</span> ${it.b}',
    template: '<!----> <!----> <!----><!----> <!----> <!---->',
    lostSpace: 'next to an element',
  },
  whenElse: {
    source: '${it.a} ${when(it.on, html`<i>y</i>`, html`<i>n</i>`)} ${it.b}',
    template: '<!----> <!----> <!----><!----><!----> <!----> <!---->',
    lostSpace: 'next to an element',
  },
  nestedList: {
    source: '${it.a} <ol>${repeat(it.kids, (k) => html`<li>${k}</li>`)}</ol>',
    template: '<!----> <!----> <ol><!----></ol>',
    lostSpace: 'next to an element',
  },
};

/** Component content, in `<p class="c-<name>">`, and the same in `<p class="w-<name>" ${when(on())}>` */
const COMPONENT_SHAPES: Record<string, Shape> = {
  space: { source: '${a()} ${b()}', template: '<!---->A<!----> <!---->B<!---->', text: 'A B' },
  twoSpaces: { source: '${a()}  ${b()}', template: '<!---->A<!----> <!---->B<!---->', text: 'A B' },
  newline: { source: '${a()}\n    ${b()}', template: '<!---->A<!----> <!---->B<!---->', text: 'A B' },
  padded: { source: '\n    ${a()} ${b()}\n  ', template: ' <!---->A<!----> <!---->B<!---->', text: ' A B' },
  expressions: { source: '${a() + 1} ${b() + 1}', template: TWO, values: ['A1', 'B1'], text: 'A1 B1' },
  dash: { source: '${a()}-${b()}', template: '<!---->A<!---->-<!---->B<!---->', text: 'A-B' },
  adjacent: { source: '${a()}${b()}', template: '<!---->A<!----><!---->B<!---->', text: 'AB' },
  around: { source: 'x ${a()} y', template: 'x <!---->A<!----> y', text: 'x A y' },
  beforeElement: {
    source: '${a()} <b>B</b>',
    template: '<!---->A<!----> <b>B</b>',
    text: 'A B',
    lostSpace: 'next to an element',
  },
  expressionBeforeElement: {
    source: '${a() + 1} <b>B</b>',
    template: '<!----> <!----> <b>B</b>',
    values: ['A1'],
    text: 'A1 B',
    lostSpace: 'next to an element',
  },
  afterElement: { source: '<b>B</b> ${a()}', template: '<b>B</b> <!---->A<!---->', text: 'B A' },
  afterVoid: { source: '<input> ${a()}', template: '<input> <!---->A<!---->', text: ' A' },
  betweenElements: { source: '<b>x</b> <i>y</i>', template: '<b>x</b> <i>y</i>', text: 'x y' },
  lineBreaks: { source: '<b>x</b>\n  <i>y</i>', template: '<b>x</b><i>y</i>', text: 'xy' },
  // The whitespace before the end of the binding's parent still goes
  trailing: { source: '<b>${a()} </b>x', template: '<b><!---->A<!----></b>x', text: 'Ax' },
};

/** Component content with directives, in `<p class="d-<name>">` */
const DIRECTIVE_SHAPES: Record<string, Shape> = {
  when: {
    source: '${a()} <span ${when(on())}>w</span> ${b()}',
    template: '<!---->A<!----> <!----><span>w</span><!----> <!---->B<!---->',
    lostSpace: 'next to an element',
  },
  whenHidden: {
    source: '${a()} <span ${when(off())}>w</span> ${b()}',
    template: '<!---->A<!----> <!----><!----> <!---->B<!---->',
    lostSpace: 'next to an element',
  },
  whenElse: {
    source: '${a()} ${when(on(), html`<i>y</i>`, html`<i>n</i>`)} ${b()}',
    template: '<!---->A<!----> <!----><i>y</i><!----><!----> <!---->B<!---->',
    lostSpace: 'next to an element',
  },
  list: {
    source: '${a()} ${repeat(items(), (it) => html`<i>${it.a}</i>`)}',
    template: '<!---->A<!----> <!---->',
    lostSpace: 'next to an element',
  },
  afterWhen: {
    source: '<span ${when(on())}>w</span> ${a()}',
    template: '<!----><span>w</span><!----> <!---->A<!---->',
  },
};

/** Content of a row's when(), in `<li><span class="rw-<name>" ${when(it.on)}>` (compiled as a sub-template) */
const ROW_WHEN_SHAPES: Record<string, Shape> = {
  space: { source: '${it.a} ${it.b}', template: TWO, values: ['John', 'Doe'], text: 'John Doe' },
  twoSpaces: { source: '${it.a}  ${it.b}', template: TWO, values: ['John', 'Doe'], text: 'John Doe' },
  newline: { source: '${it.a}\n    ${it.b}', template: TWO, values: ['John', 'Doe'], text: 'John Doe' },
  padded: { source: '\n    ${it.a} ${it.b}\n  ', template: ` ${TWO}`, values: ['John', 'Doe'], text: ' John Doe' },
  three: {
    source: '${it.a} ${it.b} ${it.c}',
    template: `${TWO} <!----> <!---->`,
    values: ['John', 'Doe', 'Jr'],
    text: 'John Doe Jr',
  },
  dash: {
    source: '${it.a}-${it.b}',
    template: '<!----> <!---->-<!----> <!---->',
    values: ['John', 'Doe'],
    text: 'John-Doe',
  },
  adjacent: {
    source: '${it.a}${it.b}',
    template: '<!----> <!----><!----> <!---->',
    values: ['John', 'Doe'],
    text: 'JohnDoe',
  },
  around: { source: 'x ${it.a} y', template: 'x <!----> <!----> y', values: ['John'], text: 'x John y' },
  beforeElement: {
    source: '${it.a} <b>B</b>',
    template: '<!----> <!----> <b>B</b>',
    values: ['John'],
    text: 'John B',
    lostSpace: 'next to an element',
  },
  afterElement: { source: '<b>B</b> ${it.a}', template: '<b>B</b> <!----> <!---->', values: ['John'], text: 'B John' },
};

/**
 * A row whose when() is pre-rendered (a component condition, true at compile time). Its row template
 * used to be garbled (a boundary twice, no space); the row holds the when()'s own template, with one
 * space between the two bindings.
 */
const PRERENDERED_ROW_WHEN = '<li class="rp-space"><!----><span><!----> <!----> <!----> <!----></span><!----></li>';

const fixture = (): string => {
  const list = (row: string) => '<ul>${repeat(items(), (it) => html`' + row + '`)}</ul>';
  const parts = [
    ...Object.entries(ROW_SHAPES).map(([name, s]) => list(`<li class="r-${name}">${s.source}</li>`)),
    ...Object.entries(COMPONENT_SHAPES).map(([name, s]) => `<p class="c-${name}">${s.source}</p>`),
    ...Object.entries(COMPONENT_SHAPES).map(([name, s]) => `<p class="w-${name}" \${when(on())}>${s.source}</p>`),
    ...Object.entries(COMPONENT_SHAPES).map(
      ([name, s]) => `\${when(on(), html\`<p class="e-${name}">${s.source}</p>\`, html\`<p>-</p>\`)}`,
    ),
    ...Object.entries(DIRECTIVE_SHAPES).map(([name, s]) => `<p class="d-${name}">${s.source}</p>`),
    ...Object.entries(ROW_WHEN_SHAPES).map(([name, s]) =>
      list(`<li><span class="rw-${name}" \${when(it.on)}>${s.source}</span></li>`),
    ),
    list('<li class="rp-space"><span ${when(on())}>${it.a} ${it.b}</span></li>'),
  ];
  return [
    "import { defineComponent, signal, mount } from 'thane';",
    "export const H52App = defineComponent('h52-spacing-app', () => {",
    "  const a = signal('A');",
    "  const b = signal('B');",
    "  const label = signal('L');",
    '  const on = signal(true);',
    '  const off = signal(false);',
    "  const items = signal([{ id: 1, a: 'John', b: 'Doe', c: 'Jr', on: true, kids: ['k'] }]);",
    '  return { template: html`<div>' + parts.join('\n  ') + '</div>` };',
    '});',
    'mount({ component: H52App });',
  ].join('\n');
};

const MODES = { dev: { strictTypeCheck: false }, prod: PROD_BUILD } as const;
const bundles = new Map<keyof typeof MODES, Promise<string>>();
const bundle = (mode: keyof typeof MODES): Promise<string> => {
  let js = bundles.get(mode);
  if (!js) bundles.set(mode, (js = buildAndReadJs(fixture(), { config: MODES[mode] })));
  return js;
};

const QUOTES = ['`', '"', "'"];

/**
 * The emitted HTML from `open` to the first `close` after it. With `ownLiteral`, the template that
 * starts with `open` and ends with `close` (a row template, a when() content template), otherwise the
 * one element inside the component template. The fixture's text has no escapes, so the bundle's text
 * is the template's.
 */
const emitted = (js: string, open: string, close: string, ownLiteral: boolean): string => {
  const found: string[] = [];
  for (let at = js.indexOf(open); at !== -1; at = js.indexOf(open, at + 1)) {
    const end = js.indexOf(close, at) + close.length;
    const own = QUOTES.includes(js[at - 1]!) && js[end] === js[at - 1];
    if (own === ownLiteral) found.push(js.slice(at, end));
  }
  expect(found).toHaveLength(1);
  expect(found[0]).not.toContain('\\');
  return found[0]!;
};

/** The text a template shows once each text binding's placeholder holds its value, in order. */
const renderedText = (template: string, values?: string[]): string => {
  let next = 0;
  const filled = values ? template.replace(/<!----> <!---->/g, () => values[next++] ?? '') : template;
  return filled.replace(/<[^>]*>/g, '');
};

const TIMEOUT = 60_000;

/** The shape's element as emitted: `<tag class="<prefix>-<name>">` + its template + `</tag>`, and its text. */
const expectShape = async (
  mode: keyof typeof MODES,
  [tag, prefix, ownLiteral]: [string, string, boolean],
  name: string,
  shape: Shape,
) => {
  const open = `<${tag} class="${prefix}-${name}">`;
  const html = emitted(await bundle(mode), open, `</${tag}>`, ownLiteral);
  expect(html).toBe(`${open}${shape.template}</${tag}>`);
  if (shape.text !== undefined) expect(renderedText(html, shape.values)).toBe(shape.text);
};

const GROUPS: [string, Record<string, Shape>, [string, string, boolean]][] = [
  ['row', ROW_SHAPES, ['li', 'r', true]],
  ['component', COMPONENT_SHAPES, ['p', 'c', false]],
  ['when() content', COMPONENT_SHAPES, ['p', 'w', true]],
  ['when() branch', COMPONENT_SHAPES, ['p', 'e', true]],
  ['component with directives', DIRECTIVE_SHAPES, ['p', 'd', false]],
  ["a row's when() content", ROW_WHEN_SHAPES, ['span', 'rw', true]],
];

for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
  describe(`text next to text bindings (${mode})`, () => {
    for (const [what, shapes, place] of GROUPS) {
      for (const [name, shape] of Object.entries(shapes)) {
        test(titleFor(shape, `${what}: ${name}`), () => expectShape(mode, place, name, shape), TIMEOUT);
      }
    }

    test(
      "a row whose when() is pre-rendered holds the when()'s own template",
      async () => {
        expect(emitted(await bundle(mode), '<li class="rp-space">', '</li>', true)).toBe(PRERENDERED_ROW_WHEN);
      },
      TIMEOUT,
    );
  });
}
