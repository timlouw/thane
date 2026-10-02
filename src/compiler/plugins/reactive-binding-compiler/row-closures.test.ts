/**
 * The code a row keeps after it is created (a subscription to another signal, a listener on one of its
 * elements, a child inside one of its directives) reads the row's item and index as they are now. The row's
 * update assigns the new item and index to the row factory's variables before anything reads them, a
 * delegated handler reads the index from the row element, and a child in a row's branch or inner list follows
 * the row's signal. A row whose code keeps nothing of the item is compiled as before. The browser tests are
 * in e2e/tests/hardening.spec.ts ("a row's code reads its item and index as they are now").
 */
import { describe, expect, test } from 'bun:test';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;
const NAMES = { components: new Map([['Card', { selector: 'x-card' }]]), fragments: new Map() };

const compile = (template: string): string => {
  const source = `import { defineComponent, signal, html, when, repeat } from 'thane';
export const App = defineComponent(() => {
  const items = signal([{ id: 1, n: 'a', on: true, kids: [{ id: 2, n: 'b' }] }]);
  const suffix = signal('!');
  const show = signal(true);
  const pick = (x: unknown) => x;
  return { template: html\`${template}\` };
});
`;
  const out = transformDefineComponentSource(source, `/virtual/row-closures-${fileId++}.ts`, NAMES);
  if (out === null) throw new Error('not compiled');
  return out;
};

describe('a delegated handler that reads the index', () => {
  const out = compile(
    '<ul>${repeat(items(), (it, i) => html`<li @click=${() => pick(i)}>${it.n}</li>`, { key: "id" })}</ul>',
  );

  test('reads it from the row element, which the row keeps current', () => {
    expect(out).toContain('const it = _row.__d; const i = _row.__i; pick(i);');
    expect(out).toMatch(/_el\.__i = i;[\s\S]*_el\.__i = i/);
  });

  test('asks the reconciler to update rows that move', () => {
    expect(out).toMatch(/__batchRows\(16, _tc_b\d+, _bind_b\d+, _update_b\d+\), true\)/);
  });

  test('a handler that does not read it adds nothing', () => {
    const plain = compile(
      '<ul>${repeat(items(), (it, i) => html`<li @click=${() => pick(it)}>${it.n}</li>`, { key: "id" })}</ul>',
    );
    expect(plain).not.toContain('__i');
  });
});

describe("the row's update assigns its new item for the code the row keeps", () => {
  test('a binding that reads the item and another signal: its subscription reads the new item', () => {
    const out = compile('<ul>${repeat(items(), (it) => html`<li>${it.n + suffix()}</li>`, { key: "id" })}</ul>');
    expect(out).toContain(
      "suffix.subscribe(() => { if (_p0 !== (_p0 = it.n + suffix())) _m0.textContent = (_p0) ?? ''; }, true)",
    );
    expect(out).toMatch(/update: \(_it\) => \{ it = _it; if \(_p0 !== \(_p0 = it\.n \+ suffix\(\)\)\)/);
  });

  test('a listener on a row element (.self) keeps the row out of the lean rows, and reads the new item and index', () => {
    const out = compile(
      '<ul>${repeat(items(), (it, i) => html`<li @click.self=${() => pick(it.n + i)}>${it.n}</li>`, { key: "id" })}</ul>',
    );
    expect(out).not.toMatch(/_update_b\d+/);
    expect(out).toMatch(/update: \(_it, _ix\) => \{ it = _it; i = _ix; /);
  });

  test('a row whose code keeps nothing of the item has an update of the item, as before', () => {
    const out = compile('<ul>${repeat(items(), (it) => html`<li class=${it.n}>${it.n}</li>`, { key: "id" })}</ul>');
    expect(out).not.toMatch(/\b_it\b/);
    expect(out).toMatch(/_update_b\d+ = \(_m, it, _idx\) =>/);
    const kept = compile('<ul>${repeat(items(), (it) => html`<li>${it.n}${suffix()}</li>`, { key: "id" })}</ul>');
    expect(kept).not.toMatch(/\b_it\b/);
  });

  test('a child whose props read the item: the update gives it the props for the new item', () => {
    const out = compile('<ul>${repeat(items(), (it) => html`<li>${Card({ label: it.n })}</li>`, { key: "id" })}</ul>');
    expect(out).toMatch(
      /const (_cd\d+) = __rc\(Card, _cm\d+, \{ label: it\.n \}\);[\s\S]*update: \(it\) => \{ \1\.u\(\{ label: it\.n \}\); \}/,
    );
  });

  test('a child whose props do not read the row is mounted once', () => {
    const out = compile(
      '<ul>${repeat(items(), (it) => html`<li>${Card({ label: suffix() })}</li>`, { key: "id" })}</ul>',
    );
    expect(out).toContain('__dc(Card.__f(');
    expect(out).not.toContain('__rc');
  });
});

describe("a child in a row's branch or inner list follows the row", () => {
  test("in a branch: it follows the row's signal, which the row's update writes", () => {
    const out = compile(
      '<ul>${repeat(items(), (it) => html`<li>${when(show(), html`${Card({ label: it.n })}`)}</li>`, { key: "id" })}</ul>',
    );
    expect(out).toContain('const it$ = __sig(it);');
    expect(out).toMatch(/it\$\.subscribe\(\(\) => (_cd\d+)\.u\(\{ label: it\.n \}\), true\)/);
    expect(out).toMatch(/update: \(_it\) => \{ it = _it; it\$\(it\); \}/);
  });

  test('in an inner row: it follows the outer row, and its own row gives it the inner item', () => {
    const out = compile(
      '<ul>${repeat(items(), (it) => html`<li><ol>${repeat(it.kids, (k) => html`<li>${Card({ label: it.n + k.n })}</li>`, { key: "id" })}</ol></li>`, { key: "id" })}</ul>',
    );
    expect(out).toMatch(/it\$\.subscribe\(\(\) => _cd\d+\.u\(\{ label: it\.n \+ k\.n \}\), true\)/);
    expect(out).toMatch(/update: \(_it\) => \{ k = _it; _cd\d+\.u\(\{ label: it\.n \+ k\.n \}\); \}/);
  });

  test('an inner row that is a component call follows the outer row', () => {
    const out = compile(
      '<ul>${repeat(items(), (it) => html`<li><ol>${repeat(it.kids, (k) => Card({ label: it.n + k.n }), { key: "id" })}</ol></li>`, { key: "id" })}</ul>',
    );
    expect(out).toContain('cleanups: [_cd.d, it$.subscribe(() => _cd.u({ label: it.n + k.n }), true)]');
  });

  test("an inner row's item of the same name shadows the outer one: nothing follows the outer row", () => {
    const out = compile(
      '<ul>${repeat(items(), (it) => html`<li><ol>${repeat(it.kids, (it) => html`<li>${Card({ label: it.n })}</li>`, { key: "id" })}</ol></li>`, { key: "id" })}</ul>',
    );
    expect(out).not.toMatch(/it\$\.subscribe\(\(\) => _cd/);
    expect(out).toMatch(/__rc\(Card, _cm\d+, \{ label: it\.n \}\)/);
  });

  test('a child in a branch at component level reads no row and is mounted once', () => {
    const out = compile('${when(show(), html`${Card({ label: suffix() })}`)}');
    expect(out).toContain('__dc(Card.__f(');
    expect(out).not.toContain('__rc');
  });
});
