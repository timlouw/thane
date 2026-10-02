/**
 * Characterisation of the two template scopes: the component template
 * (`processHtmlTemplateWithConditionals`) and directive content (`processSubTemplateWithNesting`).
 *
 * The golden file stores each case's full result, raw ids included, so it pins id allocation
 * order as well as structure. The two scopes allocate differently: the component template binds
 * its events after every other binding, a sub-template in document order, and a sub-template's
 * first root element takes the parent's id. Degenerate markup (`id=""`, `@=${…}`) and a
 * duplicated property-bound attribute in pre-rendered when() content are included because the
 * scopes treat them differently today.
 *
 * To regenerate after an intended change:
 * `UPDATE_GOLDEN=1 bun test ./src/compiler/plugins/reactive-binding-compiler/template-scopes.test.ts`,
 * then `bunx prettier --write src/compiler/plugins/reactive-binding-compiler/template-scopes.golden.json`,
 * and review the diff.
 */
import { expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { processHtmlTemplateWithConditionals, processSubTemplateWithNesting } from './template-processing.js';

const GOLDEN = join(import.meta.dir, 'template-scopes.golden.json');

type Inits = Array<[string, string | number | boolean]>;
type Case = { scope: 'component' | 'sub'; template: string; inits?: Inits };

const cases: Record<string, Case> = {
  'component: events come before other bindings in the markup': {
    scope: 'component',
    template:
      '<div><button @click=${go}>Go</button><span title=${t()}>${n()}</span><input checked=${c()} @change=${ch}></div>',
  },
  'component: event on an element with its own id, and with an empty id': {
    scope: 'component',
    template: '<button id="save" @click=${s}>S</button><button id="" @click=${d}>D</button><p>${n()}</p>',
  },
  'component: an event attribute without a name': {
    scope: 'component',
    template: '<button @=${f}>x</button><i>${n()}</i>',
  },
  'component: pre-rendered when() with property-bound attributes, on a void element and inside': {
    scope: 'component',
    template: '<div><input ${when(s())} checked=${c()} checked><p ${when(s())}><input value=${v()}></p></div>',
    inits: [['s', true]],
  },
  'component: pre-rendered when() on a non-void element with a duplicated property-bound attribute': {
    scope: 'component',
    template: '<div><button ${when(s())} disabled disabled=${d()}>B</button><b>${n()}</b></div>',
    inits: [
      ['s', true],
      ['d', false],
    ],
  },
  // The parser keeps the first of two duplicates, so the bound copy has to come first to be bound
  'component: pre-rendered when() on a non-void element with a duplicated property-bound attribute, bound first': {
    scope: 'component',
    template: '<div><button ${when(s())} disabled=${d()} disabled>B</button><b>${n()}</b></div>',
    inits: [
      ['s', true],
      ['d', false],
    ],
  },
  'component: whenElse with events, a repeat with row events, then more bindings': {
    scope: 'component',
    template:
      '<section>${when(f(), html`<p @click=${a}>${n()}</p>`, html`<p>else</p>`)}' +
      '<ul>${repeat(items(), (it) => html`<li @click=${() => pick(it)}>${it.name}</li>`)}</ul>' +
      '<em @click=${z}>${m()}</em></section>',
    inits: [['f', true]],
  },
  'component: nested when() with events and attributes': {
    scope: 'component',
    template:
      '<div ${when(a())}><span ${when(b())} @click=${h}>${n()}</span><i title=${t()} @click=${k}>x</i></div><b>${n()}</b>',
    inits: [
      ['a', true],
      ['b', false],
    ],
  },
  'component: expression bindings and unquoted attribute values': {
    scope: 'component',
    template:
      '<a href=${url()} class="x ${k()}" style="width: ${w()}px" @click=${go}>${n() + 1}</a><img src=${p.src} alt="">',
  },
  'sub: the first root element takes the parent id': {
    scope: 'sub',
    template: '<div @click=${a}><span>${n()}</span><b title=${t()} @click=${b}>x</b></div>',
  },
  'sub: first root with its own id, events in document order': {
    scope: 'sub',
    template: '<div id="own" title=${t()}><button @click=${a}>A</button><button id="" @click=${b}>B</button></div>',
  },
  'sub: an event attribute without a name': {
    scope: 'sub',
    template: '<div><i @=${f}>x</i>${n()}</div>',
  },
  'sub: nested whenElse and when() with events': {
    scope: 'sub',
    template:
      '<div>${when(f(), html`<p @click=${a}>${n()}</p>`, html`<p>${m()}</p>`)}<em ${when(g())} @click=${z}>${m()}</em><u @click=${y}>u</u></div>',
    inits: [
      ['f', false],
      ['g', true],
    ],
  },
};

const run = (c: Case): unknown => {
  const inits = new Map(c.inits ?? []);
  const result =
    c.scope === 'component'
      ? processHtmlTemplateWithConditionals(c.template, inits, 0)
      : processSubTemplateWithNesting(c.template, inits, 0, 'parent', { detectNonSignalBindings: true }, { value: 0 });
  return JSON.parse(JSON.stringify(result));
};

test('both template scopes match the golden results', () => {
  const results = Object.fromEntries(Object.entries(cases).map(([name, c]) => [name, run(c)]));
  if (process.env['UPDATE_GOLDEN'] === '1') writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
  if (!existsSync(GOLDEN)) throw new Error(`Missing ${GOLDEN}; run with UPDATE_GOLDEN=1 to create it`);
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  for (const name of Object.keys(cases)) {
    expect({ name, result: results[name] }).toEqual({ name, result: golden[name] });
  }
  expect(Object.keys(results)).toEqual(Object.keys(golden));
});
