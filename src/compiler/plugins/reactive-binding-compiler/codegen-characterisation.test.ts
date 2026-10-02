/**
 * Characterisation of the code generator: the exact code that
 * `generateInitBindingsFunction` and `generateStaticTemplate` emit today for every emission path
 * the CG tasks refactor — list sources, key arguments, row templates, comment maps, `when` /
 * `whenElse` calls at the three levels, simple-binding writes, the directive walkers, and the
 * signal-binding sections of outer and nested rows (the nested-row paths had no test before).
 *
 * The analysis runs for real (`processHtmlTemplateWithConditionals`, ids from 0); child mounts are
 * given the way `transformDefineComponentSource` partitions them, and their hosts placed as it
 * places them. The output is compared with
 * `codegen-characterisation.golden.txt`, one `=== <case> ===` section per case.
 *
 * To regenerate after an intended change: `UPDATE_GOLDEN=1 bun test <this file>`, and review the diff.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { processHtmlTemplateWithConditionals } from './template-processing.js';
import { generateInitBindingsFunction, generateStaticTemplate } from './codegen.js';
import { placeChildHosts } from './child-hosts.js';
import type { ConditionalBlock, EmitOptions, WhenElseBlock } from './types.js';
import type { ChildMountInfo } from './types.js';
import { minifyHTML } from '../minification/template-minifier.js';

const GOLDEN = join(import.meta.dir, 'codegen-characterisation.golden.txt');
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

/** Development output: templates and selectors as written. */
const DEV: EmitOptions = { html: (template) => template, selector: (name) => name };
/** Production output: minified templates and short selectors. */
const PROD: EmitOptions = { html: minifyHTML, selector: (name) => `m-${name.length}` };

interface Mount {
  /** The id of the placeholder the precompiler writes into the template, `<!--b900.-->` */
  anchorId: string;
  componentName: string;
  propsExpression: string;
  /** Which directive owns the mount, by the directive's position in the analysis result (null: none) */
  owner: (r: ReturnType<typeof processHtmlTemplateWithConditionals>) => string | null;
}

interface Case {
  name: string;
  template: string;
  initializers?: [string, string | number | boolean][];
  emit?: EmitOptions;
  mounts?: Mount[];
}

const firstRepeat: Mount['owner'] = (r) => r.repeatBlocks[0]!.id;
const firstCond: Mount['owner'] = (r) => r.conditionals[0]!.id;
const topLevel: Mount['owner'] = () => null;

const cases: Case[] = [
  // ── Top level: simple and expression bindings, events ──
  {
    name: 'top: simple text, attr, class, style and expression bindings',
    template:
      '<p class="${cls()}" style="color: ${col()}">${count()} and ${a() + b()}</p><input value="${v()}"><b title="${a()}-${b()}">${label()}</b>',
  },
  {
    name: 'top: events with modifiers',
    template:
      '<button @click=${inc}>+</button><button @click.prevent.stop=${() => go(1)}>go</button><input @keydown.enter=${save()}><div @click.self=${close}>x</div>',
  },
  // ── when / whenElse at the top level ──
  {
    name: 'top: when simple and expression, with bindings and events inside',
    template:
      '<div ${when(show())}><button @click=${a}>A</button>${n()}</div><div ${when(a() && !b())}><span title="${t()}">${m()}</span></div>',
    initializers: [['show', true]],
  },
  {
    name: 'top: whenElse with bindings and events in both branches',
    template:
      '${when(on(), html`<b @click=${x}>${t()}</b>`, html`<i title="${u()}" @click=${y}>no</i>`)}<p>${other()}</p>',
  },
  {
    name: 'top: whenElse with a simple signal condition',
    template: '<section>${when(flag(), html`<b>yes</b>`, html`<i>no</i>`)}</section>',
  },
  // ── Nested initializer: directives inside when() content ──
  {
    name: 'nested: when simple and expression, whenElse and a list inside a when',
    template:
      '<section ${when(outer())}><div ${when(inner())}>${x()}</div><div ${when(p() || q())}><b>${y()}</b></div>${when(z(), html`<u>${t()}</u>`, html`<s>none</s>`)}<ul>${repeat(list(), (it) => html`<li>${it.name}</li>`)}</ul></section>',
  },
  {
    name: 'nested: expression bindings inside a when and a whenElse branch',
    template:
      '<div ${when(a())}><b title="${x()}-${y()}">${x() + y()}</b></div>${when(c(), html`<i style="width: ${w() * 2}px">${w() + 1}</i>`, html`<s>n</s>`)}',
  },
  {
    name: 'nested: directives inside whenElse branches, events in a branch list',
    template:
      '${when(mode(), html`<div><p ${when(deep())}>${d()}</p><p ${when(d() > 1)}>many</p>${when(k(), html`<em>${e1()}</em>`, html`<em>b</em>`)}<ul>${repeat(rows(), (r) => html`<li @click=${() => pick(r)}>${r.id}</li>`)}</ul></div>`, html`<div><ol>${repeat(others(), (o) => html`<li>${o}</li>`, { empty: html`<li>empty</li>` })}</ol></div>`)}',
  },
  {
    name: 'nested: whenElse inside a whenElse branch inside a when',
    template:
      '<div ${when(a())}>${when(b(), html`<div>${when(c(), html`<b>${t()}</b>`, html`<i @click=${go}>x</i>`)}</div>`, html`<p>n</p>`)}</div>',
  },
  // ── Directive walkers: what counts as conditional text, conditional events and "any repeat" ──
  {
    name: 'walkers: text only in a whenElse nested in a when (comment factory without _cm)',
    template: '<div ${when(a())}>${when(b(), html`<b>${t()}</b>`, html`<i>x</i>`)}</div>',
  },
  {
    name: 'walkers: text only in a row-level when inside a when (no comment factory)',
    template:
      '<div ${when(a())}><ul>${repeat(xs(), (x) => html`<li><span ${when(on())}>${lbl()}</span></li>`)}</ul></div>',
  },
  {
    name: 'walkers: text only inside a whenElse branch list (no comment factory)',
    template: '${when(a(), html`<ul>${repeat(xs(), (x) => html`<li>${x} ${sig()}</li>`)}</ul>`, html`<p>none</p>`)}',
  },
  {
    name: 'walkers: events in a when, in a whenElse inside a when, and in rows',
    template:
      '<div ${when(a())}><button @click=${one}>1</button>${when(b(), html`<b @click=${two}>2</b>`, html`<i @click=${three}>3</i>`)}<ul>${repeat(xs(), (x) => html`<li><button ${when(on())} @click=${go}>b</button></li>`)}</ul></div><ul>${repeat(ys(), (y) => html`<li><p ${when(on())}><button @click=${four}>4</button></p></li>`)}</ul>${when(c(), html`<u @click=${five}>5</u>`, html`<s>6</s>`)}',
  },
  {
    name: 'walkers: a list only inside a whenElse inside a when (prototype caches)',
    template:
      '<div ${when(a())}>${when(b(), html`<ul>${repeat(xs(), (x) => html`<li>${x}</li>`)}</ul>`, html`<p>n</p>`)}</div>',
  },
  {
    name: 'walkers: a list only inside a when inside a whenElse (prototype caches)',
    template:
      '${when(b(), html`<div><div ${when(a())}><ul>${repeat(xs(), (x) => html`<li>${x}</li>`)}</ul></div></div>`, html`<p>n</p>`)}',
  },
  {
    name: 'walkers: no list anywhere (no prototype caches)',
    template: '<div ${when(a())}>${when(b(), html`<b>${t()}</b>`, html`<i>x</i>`)}</div>',
  },
  // ── Lists: the three row generators and their list sources ──
  {
    name: 'rows: direct child component, no empty template, key property',
    template: '<ul>${repeat(items(), (it) => Card({ item: it }), { key: "id" })}</ul>',
  },
  {
    name: 'rows: direct child component with index, empty template and key function',
    template:
      '<ul>${repeat(items(), (it, n) => Card({ item: it, n }), { key: (it) => it.a + it.b, empty: html`<li>none</li>` })}</ul>',
  },
  {
    name: 'rows: direct child component over a derived source',
    template: '<ul>${repeat(items().filter((x) => x.on === flag()), (it) => Card({ it }))}</ul>',
  },
  {
    name: 'rows: template rows, no key, empty template',
    template:
      '<ul>${repeat(items(), (it) => html`<li>${it.label}</li>`, { empty: html`<li class="e">none</li>` })}</ul>',
  },
  {
    name: 'rows: template rows over a derived source with an empty template and key property',
    template:
      '<ul>${repeat(items().filter((x) => x.on === flag()), (it) => html`<li>${it.label}</li>`, { key: "id", empty: html`<li>none</li>` })}</ul>',
  },
  {
    name: 'rows: template rows over a member source',
    template: '<ul>${repeat(store.items(), (it) => html`<li title="${it.t}">${it.label}</li>`)}</ul>',
  },
  {
    name: 'rows: no bindings, no key, no empty template',
    template: '<ul>${repeat(items(), (it) => html`<li>static</li>`)}</ul>',
  },
  {
    name: 'rows: no bindings, empty template and key property',
    template: '<ul>${repeat(items(), (it) => html`<li>static</li>`, { key: "id", empty: html`<li>none</li>` })}</ul>',
  },
  {
    name: 'rows: no bindings over a derived source, key function',
    template: '<ul>${repeat(items().slice(n()), (it) => html`<li>static</li>`, { key: (it) => it.k + 1 })}</ul>',
  },
  {
    name: 'rows: no bindings with a child mount and a named index',
    template: '<ul>${repeat(items(), (it, i) => html`<li><!--b900.--></li>`)}</ul>',
    mounts: [{ anchorId: 'b900', componentName: 'Kid', propsExpression: '{ label: it.name, i }', owner: firstRepeat }],
  },
  {
    name: 'rows: no bindings with a child mount, empty template',
    template: '<ul>${repeat(items(), (it) => html`<li><!--b900.--></li>`, { empty: html`<li>none</li>` })}</ul>',
    mounts: [{ anchorId: 'b900', componentName: 'Kid', propsExpression: '{ it }', owner: firstRepeat }],
  },
  {
    name: 'rows: bindings with two child mounts',
    template: '<ul>${repeat(items(), (it) => html`<li><span>${it.name}</span><!--b900.--><!--b901.--></li>`)}</ul>',
    mounts: [
      { anchorId: 'b900', componentName: 'Kid', propsExpression: '{ it }', owner: firstRepeat },
      { anchorId: 'b901', componentName: 'Other', propsExpression: '{}', owner: firstRepeat },
    ],
  },
  {
    name: 'mounts: child mount inside a when',
    template: '<div ${when(a())}><!--b900.--><b>${t()}</b></div>',
    mounts: [{ anchorId: 'b900', componentName: 'Kid', propsExpression: '{ x: t() }', owner: firstCond }],
  },
  {
    // The host goes into the template where the parser keeps an element; in a table row and
    // in svg it would not, so those keep a comment anchor that the host replaces
    name: 'mounts: child hosts in the template, and comment anchors where the parser keeps no element',
    template:
      '<div><p><!--b900.--></p><table><tr><td>${t()}</td><!--b901.--></tr></table><svg><!--b902.--></svg></div>',
    mounts: [
      { anchorId: 'b900', componentName: 'Kid', propsExpression: '{ x: t() }', owner: topLevel },
      { anchorId: 'b901', componentName: 'Cell', propsExpression: '{}', owner: topLevel },
      { anchorId: 'b902', componentName: 'Icon', propsExpression: '{}', owner: topLevel },
    ],
  },
  {
    name: 'mounts: child mount inside a whenElse branch',
    template: '${when(a(), html`<div><!--b900.--></div>`, html`<p>n</p>`)}',
    mounts: [
      {
        anchorId: 'b900',
        componentName: 'Kid',
        propsExpression: '{}',
        owner: (r) => (r.whenElseBlocks[0] as WhenElseBlock).thenId,
      },
    ],
  },
  // ── Rows: item bindings, lean and batch rows, events, index, selection ──
  {
    name: 'rows: lean batch rows with sole-content text, attrs and a key property',
    template:
      '<ul>${repeat(items(), (it) => html`<li class="${it.cls}" data-id="${it.id}"><a>${it.label}</a><span>${it.n}</span></li>`, { key: "id" })}</ul>',
  },
  {
    name: 'rows: comment-marker item bindings',
    template: '<ul>${repeat(items(), (it) => html`<li>${it.a} and ${it.b}<b>${it.c}</b> tail</li>`)}</ul>',
  },
  {
    name: 'rows: delegated and non-delegatable events',
    template:
      '<ul>${repeat(items(), (it, i) => html`<li @click=${() => pick(it)}><a @click.self=${() => open(it.id)}>${it.label}</a><button @click.stop=${remove}>x</button><input @keydown.enter=${(e) => save(it, i, e)}></li>`)}</ul>',
  },
  {
    name: 'rows: non-delegatable events on elements without bindings',
    template:
      '<ul>${repeat(items(), (it) => html`<li><em @click.self=${() => open(it)}>e</em><i @keydown.self.enter=${(ev) => key(ev, it)}>k</i></li>`)}</ul>',
  },
  {
    name: 'rows: index bindings',
    template: '<ul>${repeat(items(), (it, i) => html`<li data-i="${i}">${i}: ${it}</li>`)}</ul>',
  },
  {
    name: 'rows: selection binding and mixed signal-item bindings',
    template:
      '<ul>${repeat(items(), (it) => html`<li class="${sel() === it.id ? \'on\' : \'\'}"><span>${it.label + suffix()}</span><b title="${it.t + sep()}" style="width: ${it.w + unit()}">${it.x}</b></li>`, { key: "id" })}</ul>',
  },
  // ── Rows: component-signal bindings (outer rows) ──
  {
    name: 'rows: signal attr, style and text bindings next to item comment bindings',
    template:
      '<ul>${repeat(items(), (it) => html`<li title="${tip()}" style="color: ${col()}"><b>${it.x}</b> and ${it.y} ${sel()}</li>`)}</ul>',
  },
  {
    name: 'rows: signal text binding without item comment bindings',
    template: '<ul>${repeat(items(), (it) => html`<li><b>${it.x}</b><i>${sel()}</i> ${other()}</li>`)}</ul>',
  },
  {
    name: 'rows: expression signal bindings over several signals',
    template:
      '<ul>${repeat(items(), (it) => html`<li title="${a()}-${b()}" style="height: ${h() + 1}px"><b>${it.x}</b><i>${user().name} ${a() + b()}</i></li>`)}</ul>',
  },
  {
    name: 'rows: signal bindings on the row element itself',
    template: '<ul>${repeat(items(), (it) => html`<li class="${cls()}" style="top: ${top()}">${it.x}</li>`)}</ul>',
  },
  // ── Rows: directives inside rows ──
  {
    name: 'rows: when simple and expression, whenElse, with row signals',
    template:
      '<ul>${repeat(items(), (it, i) => html`<li><b ${when(show())}>${lbl()}</b><i ${when(it.on && flag())} title="${it.t}" @click=${go}>${it.name}</i>${when(it.done, html`<s>${it.name}</s>`, html`<u style="color: ${col()}">${i}</u>`)}</li>`)}</ul>',
  },
  {
    // A row whose when()/when() content comes and goes keeps its delegated elements on the
    // row (`_el.__eN`), and its selection binding stays per row
    name: 'rows: delegated events and a selection binding after row directives',
    template:
      "<ul>${repeat(items(), (it) => html`<li><b ${when(it.on)}>b</b>${when(it.done, html`<s>s</s>`, html`<u>u</u>`)}<a @click=${() => go(it.id)}>go</a><i class=${sel() === it.id ? 'on' : ''} @click=${go}>i</i></li>`, { key: 'id' })}</ul>",
  },
  {
    name: 'rows: row-level when with several bindings on one signal',
    template:
      '<ul>${repeat(items(), (it) => html`<li><b ${when(show())} style="color: ${col()}" title="${col()}">${col()}</b></li>`)}</ul>',
  },
  // ── Nested rows (a list inside a row) ──
  {
    name: 'nested rows: element, comment and signal bindings',
    template:
      '<ul>${repeat(groups(), (g) => html`<li><span>${g.name}</span><ol>${repeat(g.items, (it) => html`<li class="${it.cls}"><b>${it.label}</b> x ${it.n} <i title="${tip()}" style="color: ${col()}">${sel()}</i></li>`)}</ol></li>`)}</ul>',
  },
  {
    name: 'nested rows: signal text without item comment bindings, key property',
    template:
      '<ul>${repeat(groups(), (g) => html`<li><ol>${repeat(g.items, (it) => html`<li><b>${it.label}</b><i>${sel()}</i> ${other()}</li>`, { key: "id" })}</ol></li>`)}</ul>',
  },
  {
    name: 'nested rows: expression signal bindings and bindings on the inner row element',
    template:
      '<ul>${repeat(groups(), (g) => html`<li><ol>${repeat(g.items, (it, j) => html`<li title="${a()}-${b()}" style="left: ${x()}"><i>${user().name}</i></li>`, { key: (it) => it.k + 1 })}</ol></li>`)}</ul>',
  },
  {
    name: 'nested rows: no bindings, driven by a component signal',
    template:
      '<ul>${repeat(groups(), (g) => html`<li><span>${g.name}</span><ol>${repeat(things(), (t) => html`<li>static</li>`)}</ol></li>`)}</ul>',
  },
  {
    name: 'nested rows: only comment-marker item bindings',
    template:
      '<ul>${repeat(groups(), (g) => html`<li><ol>${repeat(g.items, (it) => html`<li>${it.a} and ${it.b}</li>`)}</ol></li>`)}</ul>',
  },
  // ── Escaping and the production access pattern ──
  {
    name: 'escaping: backslash, backtick and newline in row, branch and main templates (dev)',
    template:
      '<p title="a\\b">`q` ${t()}</p><ul>${repeat(items(), (it) => html`<li title="c\\d">${it.x} e\\f</li>`, { empty: html`<li>g\\h</li>` })}</ul><ol>${repeat(items(), (it) => html`<li>s\\t</li>`)}</ol><div ${when(a())}><i>`w`\\</i></div>',
  },
  {
    name: 'escaping: the same templates, production',
    template:
      '<p title="a\\b">`q` ${t()}</p><ul>${repeat(items(), (it) => html`<li title="c\\d">${it.x} e\\f</li>`, { empty: html`<li>g\\h</li>` })}</ul><ol>${repeat(items(), (it) => html`<li>s\\t</li>`)}</ol><div ${when(a())}><i>`w`\\</i></div>',
    emit: PROD,
  },
  {
    name: 'production: nested rows, row directives and a child mount',
    template:
      '<ul>${repeat(groups(), (g) => html`<li class="row">  <b ${when(on())}>${lbl()}</b>  <ol>${repeat(g.items, (it) => html`<li>  ${it.label}  </li>`)}</ol><!--b900.--></li>`)}</ul>',
    emit: PROD,
    mounts: [{ anchorId: 'b900', componentName: 'Kid', propsExpression: '{ g }', owner: firstRepeat }],
  },
];

const render = (c: Case): string => {
  const emit = c.emit ?? DEV;
  const r = processHtmlTemplateWithConditionals(c.template, new Map(c.initializers ?? []), 0);
  let mounts: Map<string, { cm: ChildMountInfo; globalIndex: number }[]> | undefined;
  const topLevelMounts: { cm: ChildMountInfo; globalIndex: number }[] = [];
  const cms: ChildMountInfo[] = [];
  if (c.mounts) {
    mounts = new Map();
    c.mounts.forEach((m, globalIndex) => {
      const owner = m.owner(r);
      const cm: ChildMountInfo = {
        componentName: m.componentName,
        selector: `x-${m.componentName.toLowerCase()}`,
        propsExpression: m.propsExpression,
        anchorId: m.anchorId,
      };
      cms.push(cm);
      if (owner === null) topLevelMounts.push({ cm, globalIndex });
      else mounts!.set(owner, [...(mounts!.get(owner) ?? []), { cm, globalIndex }]);
    });
  }
  // The hosts go into the templates as transformDefineComponentSource puts them
  const component = { template: r.processedContent };
  const hosts = placeChildHosts(
    cms,
    component,
    { conditionals: r.conditionals, whenElse: r.whenElseBlocks, repeats: r.repeatBlocks },
    emit,
  );
  const out = generateInitBindingsFunction(
    r.bindings,
    r.conditionals as ConditionalBlock[],
    r.whenElseBlocks,
    r.repeatBlocks,
    r.eventBindings,
    emit,
    mounts,
    topLevelMounts,
    component.template,
    hosts,
  );
  return [
    '--- template',
    component.template,
    '--- binding function body',
    out.code,
    '--- static templates',
    generateStaticTemplate(component.template, emit).replace(/^\n/, ''),
    ...(out.staticTemplates ?? []),
  ].join('\n');
};

const readGolden = (): Map<string, string> => {
  const golden = new Map<string, string>();
  if (!existsSync(GOLDEN)) return golden;
  const text = readFileSync(GOLDEN, 'utf8').replace(/\r\n/g, '\n');
  for (const section of text.split(/^=== /m).slice(1)) {
    const nl = section.indexOf(' ===\n');
    golden.set(section.slice(0, nl), section.slice(nl + 5).replace(/\n$/, ''));
  }
  return golden;
};

const golden = readGolden();
const produced = new Map<string, string>();

describe('code generator output (characterisation)', () => {
  test('case names are unique', () => {
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  for (const c of cases) {
    test(c.name, () => {
      const output = render(c);
      produced.set(c.name, output);
      if (UPDATE) return;
      if (!golden.has(c.name)) throw new Error(`No golden output for "${c.name}"; run with UPDATE_GOLDEN=1`);
      expect(output).toBe(golden.get(c.name)!);
    });
  }

  if (!UPDATE) {
    test('the golden file has no stale cases', () => {
      expect([...golden.keys()].filter((name) => !cases.some((c) => c.name === name))).toEqual([]);
    });
  }
});

afterAll(() => {
  if (!UPDATE) return;
  const text = cases.map((c) => `=== ${c.name} ===\n${produced.get(c.name)}\n`).join('');
  writeFileSync(GOLDEN, text);
});
