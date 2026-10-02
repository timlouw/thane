/**
 * The template shapes that path-based lookup and anchored directives must keep compiling, built end to
 * end in development and production. Each build must succeed and keep every developer id in the emitted
 * markup, on its own element: the compiler's own lookups use no ids, and developer ids are left alone.
 * No generated id is left in the output. The runtime behaviour of the same shapes (and of the markup the
 * browser's parser rebuilds) is covered in a browser by e2e/tests/hardening.spec.ts ('lookups and
 * branches').
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs, PROD_BUILD } from '../../testing/build-project.js';

const KID = `import { defineComponent } from 'thane';

export const ShapeKid = defineComponent<{ label: string }>('lookup-shape-kid', ({ props }) => ({
  template: html\`<em class="kid">\${props.label}</em>\`,
  onDestroy: () => {},
}));
`;

/** An entry that mounts one component whose setup declares `signals` and returns `template`. */
const app = (signals: string, template: string): string => `
import { defineComponent, signal, mount } from 'thane';
import { ShapeKid } from './kid.js';

export const App = defineComponent('test-app', () => {
${signals}
  return { template: html\`${template}\` };
});
mount({ component: App });
`;

const SIGNALS = [
  "  const t = signal('t0');",
  '  const show = signal(true);',
  '  const hidden = signal(false);',
  '  const unknown = signal(Math.random() > 2);',
  "  const items = signal(['a', 'b']);",
  '  const rows = signal([{ id: 1, g: "g1" }]);',
  '  const clicks = signal(0);',
  '  const inc = () => clicks(clicks() + 1);',
].join('\n');

/** Each shape, and how often each developer id appears as an id attribute in the emitted markup. */
const shapes: { name: string; template: string; ids: Record<string, number> }[] = [
  {
    name: 'developer ids on bound elements, directive roots, a list container and inside a hidden branch',
    template:
      '<div><p id="d-attr" title=${t()}>P</p><div id="d-when" ${when(show())}><b title=${t()}>W</b></div>' +
      '${when(show(), html`<i id="d-then" title=${t()}>T</i>`, html`<i id="d-else">E</i>`)}' +
      '<ul id="d-list">${repeat(items(), (it) => html`<li>${it}</li>`)}</ul>' +
      '<button id="d-btn" @click=${inc}>${clicks()}</button>' +
      '<section ${when(hidden())}><span id="d-inner" title=${t()}>I</span></section></div>',
    // d-when and d-then: pre-rendered in the component template and in their branch template
    ids: { 'd-attr': 1, 'd-when': 2, 'd-then': 2, 'd-list': 1, 'd-btn': 1, 'd-inner': 1 },
  },
  {
    name: 'text bindings at the start, middle and end of text, next to comments, in <pre> and at the top level',
    template:
      'top ${t()} level <div><p>${t()} tail</p><p>head ${t()} tail</p><p>head ${t()}</p><p>${t()}${clicks()}</p>' +
      '<p><!-- note -->${t()}<!-- other --> x</p><pre id="d-pre">line1\n  ${t()} line2</pre><span>${t()}</span></div> ${t()} end',
    ids: { 'd-pre': 1 },
  },
  {
    name: 'a table without <tbody>, a <p> before a block, an unclosed <li> and a <select> list',
    template:
      '<div><table id="d-table"><tr title=${t()}><td>${t()}</td><td @click=${inc}>c</td></tr></table>' +
      '<div><p>intro<div id="d-block" title=${t()}>${t()}</div></p><span title=${t()}>${t()}</span></div>' +
      '<ul><li title=${t()}>one<li id="d-li" title=${t()}>${t()}</ul>' +
      '<select id="d-select"><option value="">Choose</option>${repeat(items(), (o) => html`<option value=${o}>${o}</option>`)}</select></div>',
    ids: { 'd-table': 1, 'd-block': 1, 'd-li': 1, 'd-select': 1 },
  },
  {
    name: 'a repeat() whose container is the component root',
    template: '${repeat(items(), (it) => html`<p>${it}</p>`)}',
    ids: {},
  },
  {
    name: 'when() / when() alone in an element, next to text and three deep, with events and children',
    template:
      '<div><section><div id="d-only" ${when(show())} title=${t()}>${t()}<button @click=${inc}>+</button>${ShapeKid({ label: "only" })}</div></section>' +
      '<section>before ${when(show(), html`<i title=${t()}>${t()}${ShapeKid({ label: "then" })}</i>`, html`<u>${t()}</u>`)} after</section>' +
      '<div ${when(show())}>L1:${t()}${when(hidden(), html`<div>L2:${t()}<p id="d-l3" ${when(show())} title=${t()}>L3<button @click=${inc}>+</button>${ShapeKid({ label: "l3" })}</p></div>`, html`<span>no</span>`)}</div></div>',
    ids: { 'd-only': 2, 'd-l3': 2 },
  },
  {
    name: 'when() and when() at the top level of the template',
    template:
      '<b ${when(show())} title=${t()}>${t()}</b>${when(hidden(), html`<i title=${t()}>${t()}</i>`, html`<u>${t()}</u>`)}<span id="d-static">S</span>',
    ids: { 'd-static': 1 },
  },
  {
    name: 'a text-only when() branch that starts hidden',
    template: '<section>${when(hidden(), html`text-${t()}`, html`<u id="d-else2">else</u>`)}</section>',
    ids: { 'd-else2': 2 },
  },
  {
    name: 'a row when() of unknown initial value before a child component',
    template:
      '<ul>${repeat(rows(), (r) => html`<li><b ${when(unknown())}>${t()}</b>${ShapeKid({ label: r.g })}</li>`, { key: "id" })}</ul>',
    ids: {},
  },
  {
    name: 'child hosts in a paragraph, a table row, svg and a row of their own',
    template:
      '<div><p>${ShapeKid({ label: "p" })}</p><table><tbody>${repeat(rows(), (r) => html`<tr><td>${r.g}</td>${ShapeKid({ label: r.g })}</tr>`, { key: "id" })}</tbody></table>' +
      '<ul>${repeat(rows(), (r) => html`${ShapeKid({ label: r.g })}`, { key: "id" })}</ul><svg>${ShapeKid({ label: "svg" })}</svg></div>',
    ids: {},
  },
  {
    name: 'an event on an element with an empty id attribute',
    template: '<div><button id="" @click=${inc}>${clicks()}</button></div>',
    ids: {},
  },
];

describe('template shapes compile in development and production, developer ids kept', () => {
  for (const shape of shapes) {
    for (const mode of ['development', 'production'] as const) {
      test(`${shape.name} (${mode})`, async () => {
        const js = await buildAndReadJs(app(SIGNALS, shape.template), {
          extraFiles: { 'src/kid.ts': KID },
          config: mode === 'production' ? PROD_BUILD : { strictTypeCheck: false },
        });
        const counts = Object.fromEntries(Object.keys(shape.ids).map((id) => [id, js.split(`id="${id}"`).length - 1]));
        expect(counts).toEqual(shape.ids);
        // No element carries a second id attribute next to a developer's
        expect(js).not.toMatch(/\bid="[^"]*" id=/);
        // and no generated id, placeholder element, id in a comment or compile-time mark is left
        expect(js.match(/\bid="[bi]\d+"|<template id=|<!--[bi]\d|data-thane-ref/g) ?? []).toEqual([]);
      });
    }
  }
});
