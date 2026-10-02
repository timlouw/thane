/**
 * Slots: a template a parent passes to a child as a prop (`Card({ body: html`…` })`) is compiled in the parent's
 * scope into the value the child mounts, `{ t, b }`, whose bindings and handlers are the parent's. The child
 * mounts a prop its props type declares as Fragment where its template reads it (`${props.body}`); one the parent
 * left out mounts nothing. The browser tests are in e2e/tests/hardening.spec.ts ("slots").
 */
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { transformDefineComponentSource } from './index.js';
import { noNestedHtmlTags, noSignalSnapshotProp } from '../thane-linter/rules/index.js';

let fileId = 0;
const NAMES = {
  components: new Map([['Card', { selector: 'x-card' }]]),
  fragments: new Map([['Spinner', { staticText: undefined }]]),
};

const parent = (template: string, setup = ''): string => {
  const source = `import { defineComponent, signal, html, when, repeat } from 'thane';
import { Spinner } from './spinner.js';
export const App = defineComponent(() => {
  const n = signal(1);
  const items = signal([{ id: 1, label: 'a' }]);
  const bump = () => n(n() + 1);
  ${setup}
  return { template: html\`${template}\` };
});
`;
  const out = transformDefineComponentSource(source, `/virtual/slots-parent-${fileId++}.ts`, NAMES as never);
  if (out === null) throw new Error('not compiled');
  return out;
};

const child = (template: string, props = '{ title: string; body: Fragment; footer?: Fragment }'): string => {
  const source = `import { defineComponent, signal, html, when, type Fragment } from 'thane';
interface CardProps ${props}
export const Card = defineComponent<CardProps>('x-card', ({ props }) => {
  const open = signal(true);
  return { template: html\`${template}\` };
});
`;
  const out = transformDefineComponentSource(source, `/virtual/slots-child-${fileId++}.ts`, {
    components: new Map(),
    fragments: new Map(),
  });
  if (out === null) throw new Error('not compiled');
  return out;
};

describe('the parent compiles a template it passes as a prop, in its own scope', () => {
  const out = parent("<div>${Card({ title: 'T', body: html`<p @click=${bump}>count ${n()}</p>` })}</div>");

  test('into the value the child mounts: its static template, and a binding function closed over the setup', () => {
    expect(out).toContain('const __tpl_s0 = __T(`<p>count <!---->1<!----></p>`);');
    expect(out).toMatch(/Card\.__f\(_ns\[\d+\], \{ title: 'T', body: \{ t: __tpl_s0, b: \(_ctx, _ns\) => \{/);
    // Its bindings read the parent's signal, and its handler is the parent's
    expect(out).toContain("_subs.push(n.subscribe(v => { _b0.data = v ?? ''; }, true));");
    expect(out).toContain("_ns[0].addEventListener('click', bump);");
    expect(out).toContain('_ctx.place();');
  });

  test('a const template passed by name, which is then not kept', () => {
    const named = parent("${Card({ title: 'T', body })}", 'const body = html`<b>${n()}</b>`;');
    expect(named).toMatch(/Card\.__f\(_ns\[\d+\], \{ title: 'T', body: \{ t: __tpl_s0, b:/);
    expect(named).toContain('const body = html``;');
  });

  test('an imported fragment is passed as it is: it already is such a value', () => {
    expect(parent("${Card({ title: 'T', body: Spinner })}")).toMatch(/\{ title: 'T', body: Spinner \}/);
  });

  test('a template without bindings is its static template alone', () => {
    expect(parent("${Card({ title: 'T', body: html`<p>static</p>` })}")).toContain('body: { t: __tpl_s0 } }');
  });

  test("in a row, a slot reads the row's item, and the child gets it again when the row changes", () => {
    const rows = parent(
      '<ul>${repeat(items(), (it) => html`<li>${Card({ title: it.label, body: html`<b>${it.id}</b>` })}</li>`)}</ul>',
    );
    expect(rows).toMatch(/__rc\(Card, _cm\d+, \{ title: it\.label, body: \{ t: __tpl_s0/);
  });
});

describe('the child mounts a prop typed Fragment where its template reads it', () => {
  test('${props.body} mounts the value; a slot left out mounts nothing (__mf takes undefined)', () => {
    const out = child('<section><h2>${props.title}</h2>${props.body}${props.footer}</section>');
    expect(out).toMatch(/__mf\(_cma\d+, props\.body\)/);
    expect(out).toMatch(/__mf\(_cma\d+, props\.footer\)/);
    // A prop of another type is text
    expect(out).toContain("_b2.data = (_pv_b2_0) ?? ''");
    expect(out).toContain("import { signal, html, when, type Fragment } from 'thane'");
  });

  test('in a when() branch, and as a branch of a ternary', () => {
    const out = child('${when(open(), html`<div>${props.body}</div>`)}${open() ? props.body : null}');
    expect(out.match(/__mf\(/g)).toHaveLength(2);
  });

  test('the props type can be a literal, an alias, or an intersection of them', () => {
    expect(child('${props.body}', '{ body: Fragment }')).toMatch(/__mf\(_cma\d+, props\.body\)/);
    expect(child('${props.body}', '{ title: string; body?: Fragment | undefined }')).toMatch(
      /__mf\(_cma\d+, props\.body\)/,
    );
  });

  test('a prop not typed Fragment is text', () => {
    expect(child('${props.body}', '{ body: string }')).not.toContain('__mf');
  });
});

describe('the lint rules know slots', () => {
  const lint = (source: string, rule: typeof noNestedHtmlTags) =>
    rule.check(ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), 'x.ts');
  const source = `import { defineComponent, html, signal } from 'thane';
export const App = defineComponent(() => {
  const n = signal(0);
  return { template: html\`\${Card({ title: 'T', body: html\`<p>\${n()}</p>\` })}\` };
});`;

  test('THANE404: a template as a prop of a child is a slot, compiled; as an argument of another function it is not', () => {
    expect(lint(source, noNestedHtmlTags)).toEqual([]);
    expect(lint(source.replace('Card({', 'wrap({'), noNestedHtmlTags).map((d) => d.code)).toEqual(['THANE404']);
  });

  test("THANE416: a slot's reads are its bindings, not a snapshot", () => {
    expect(lint(source, noSignalSnapshotProp)).toEqual([]);
  });
});
