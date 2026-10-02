/**
 * Event modifiers: an unknown one is a build error (THANE015) naming the one it is close to, and `.once`,
 * `.passive` and `.capture` are options of the listener. In a list row they give the row's element a listener of
 * its own, as `.self` does. `.once` with a guard (`.self`, a key) runs the handler on the first event the guard
 * lets through. The browser tests are in e2e/tests/hardening.spec.ts ("event modifiers").
 */
import { describe, expect, test } from 'bun:test';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;
const NAMES = { components: new Map(), fragments: new Map() };

const compile = (template: string): string => {
  const source = `import { defineComponent, signal, html, when, repeat } from 'thane';
export const App = defineComponent(() => {
  const items = signal([{ id: 1, n: 'a' }]);
  const show = signal(true);
  const go = (x?: unknown) => x;
  return { template: html\`${template}\` };
});
`;
  const out = transformDefineComponentSource(source, `/virtual/event-modifiers-${fileId++}.ts`, NAMES);
  if (out === null) throw new Error('not compiled');
  return out;
};

const listeners = (out: string): string[] => out.match(/addEventListener\([^\n]*/g) ?? [];

describe('an unknown modifier is a build error', () => {
  test('with the modifier it is close to', () => {
    expect(() => compile('<a @click.prevnet=${go}>x</a>')).toThrow(
      "THANE015: @click.prevnet — 'prevnet' is not an event modifier: did you mean 'prevent'?",
    );
    expect(() => compile('<input @keydown.entr=${go} />')).toThrow("did you mean 'enter'?");
    expect(() => compile('<a @click.onc=${go}>x</a>')).toThrow("did you mean 'once'?");
  });

  test('with the list of modifiers when none is close, and for an empty one', () => {
    expect(() => compile('<a @click.debounce=${go}>x</a>')).toThrow(
      "THANE015: @click.debounce — 'debounce' is not an event modifier. The modifiers are prevent, stop, self, once, passive, capture, enter,",
    );
    expect(() => compile('<a @click.=${go}>x</a>')).toThrow("THANE015: @click. — '' is not an event modifier.");
  });

  test('in a row and a branch too', () => {
    expect(() => compile('<ul>${repeat(items(), (i) => html`<li @click.sotp=${() => go(i)}>x</li>`)}</ul>')).toThrow(
      "did you mean 'stop'?",
    );
    expect(() => compile('${when(show(), html`<a @click.slef=${go}>x</a>`)}')).toThrow("did you mean 'self'?");
  });

  test('.passive with .prevent: a passive listener cannot prevent the default', () => {
    expect(() => compile('<div @wheel.passive.prevent=${go}></div>')).toThrow(
      'THANE015: @wheel.passive.prevent — a passive listener cannot prevent the default: remove .passive or .prevent.',
    );
  });
});

describe('.once, .passive and .capture are options of the listener', () => {
  test('at component level, alone or together, with the handler as written', () => {
    expect(listeners(compile('<a @click.once=${go}>x</a><div @scroll.passive.capture=${() => go(1)}></div>'))).toEqual([
      "addEventListener('click', go, { once: true });",
      "addEventListener('scroll', () => go(1), { passive: true, capture: true });",
    ]);
  });

  test('with .prevent and .stop, which run before the handler', () => {
    expect(listeners(compile('<form @submit.prevent.once=${go}></form>'))).toEqual([
      "addEventListener('submit', (_e) => { _e.preventDefault(); (go)(_e); }, { once: true });",
    ]);
  });

  test('in a when() branch', () => {
    expect(listeners(compile('${when(show(), html`<a @click.once=${go}>x</a>`)}'))).toEqual([
      "addEventListener('click', go, { once: true });",
    ]);
  });

  test("in a row: the row's element gets a listener of its own, and the list's container none", () => {
    const out = compile(
      '<ul>${repeat(items(), (i) => html`<li @click.once=${() => go(i)}>${i.n}</li>`, { key: "id" })}</ul>',
    );
    expect(listeners(out)).toEqual(["addEventListener('click', (_e) => { go(i); }, { once: true });"]);
    expect(out).not.toMatch(/_ct_b\d+\.addEventListener/);
  });

  test('a row handler without them is delegated to the container, as before', () => {
    const out = compile(
      '<ul>${repeat(items(), (i) => html`<li @click.stop=${() => go(i)}>${i.n}</li>`, { key: "id" })}</ul>',
    );
    expect(out).toMatch(/_ct_b\d+\.addEventListener\('click'/);
  });
});

describe('.once with a guard runs the handler on the first event the guard lets through', () => {
  test('a key: the listener removes itself once the key matches', () => {
    expect(listeners(compile('<input @keydown.enter.once=${go} />'))).toEqual([
      "addEventListener('keydown', function _once(_e) { if (_e.key !== 'Enter') return; this.removeEventListener('keydown', _once); (go)(_e); });",
    ]);
  });

  test('.self in a row, and .capture, which the removal names', () => {
    const out = compile(
      '<ul>${repeat(items(), (i) => html`<li @click.self.once.capture=${() => go(i)}>${i.n}</li>`, { key: "id" })}</ul>',
    );
    expect(listeners(out)).toEqual([
      "addEventListener('click', function _once(_e) { if (_e.target !== _e.currentTarget) return; this.removeEventListener('click', _once, true); go(i); }, { capture: true });",
    ]);
  });
});

describe('the other modifiers', () => {
  test('a key modifier next to a listener option guards on its key only', () => {
    expect(listeners(compile('<input @keydown.esc.capture=${go} />'))).toEqual([
      "addEventListener('keydown', (_e) => { if (_e.key !== 'Escape') return; (go)(_e); }, { capture: true });",
    ]);
  });

  test('in a row, .self is checked before .prevent and .stop, as at component level', () => {
    const out = compile('<ul>${repeat(items(), (i) => html`<li @click.prevent.self=${() => go(i)}>${i.n}</li>`)}</ul>');
    expect(listeners(out)).toEqual([
      "addEventListener('click', (_e) => { if (_e.target !== _e.currentTarget) return; _e.preventDefault(); go(i); });",
    ]);
  });
});
