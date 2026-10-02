/**
 * Template values in the project type check (`thane build`, `thane typecheck`): a value in content is what
 * content shows, a value in a tag an attribute's, a handler gets its event's type, a handler for another event is
 * an error, an expression that runs on the event cannot be a function (nothing would call it), and every
 * diagnostic points at the source as written.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runProjectTypeCheck } from './tsc-type-checker.js';
import { createTempProject, removeTempProject, type TempProject } from '../../testing/build-project.js';

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    lib: ['ESNext', 'DOM'],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['./src/**/*.ts', './.thane/types/**/*.d.ts'],
});

/** A component file whose setup declares `setup` and whose template is `markup`. */
const component = (name: string, setup: string, markup: string): string =>
  [
    "import { defineComponent, html, signal } from 'thane';",
    '',
    `export const ${name} = defineComponent(() => {`,
    '  const count = signal(0);',
    `  ${setup}`,
    `  return { template: html\`${markup}\` };`,
    '});',
    '',
  ].join('\n');

const CASES: Record<string, string> = {
  // An untyped parameter gets the event's type
  'src/untyped.ts': component(
    'Untyped',
    '',
    '<b @click=${(e) => count(e.clientX)} @keydown.enter=${(e) => e.key.length}>x</b>',
  ),
  // A handler for a wider event, no parameter, a custom event, and an expression that runs on the event
  'src/accepted.ts': component(
    'Accepted',
    'const onEvent = (e: Event) => e.type;',
    '<b @click=${onEvent} @input=${() => count(1)} @my-event=${(e: CustomEvent<number>) => e.detail} @focus=${count(2)}>x</b>',
  ),
  'src/wrong-member.ts': component('WrongMember', '', '<b @click=${(e) => e.key}>x</b>'),
  // Outside a row, currentTarget is the element; in a row it is the list container, so it stays EventTarget
  'src/current-target.ts': component(
    'CurrentTarget',
    '',
    '<input @input=${(e) => count(e.currentTarget.value.length)} /><select @change=${(e) => e.currentTarget.selectedIndex}></select>',
  ),
  'src/row-target.ts': [
    "import { defineComponent, html, repeat, signal } from 'thane';",
    '',
    'export const RowTarget = defineComponent(() => {',
    '  const rows = signal([1]);',
    '  return { template: html`<ul>${repeat(rows(), (n) => html`<li @click=${(e) => e.currentTarget.id}>${n}</li>`)}</ul>` };',
    '});',
    '',
  ].join('\n'),
  'src/wrong-event.ts': component('WrongEvent', '', '<b @click=${(e: KeyboardEvent) => e.key}>x</b>'),
  // What content shows and what a tag takes: text, numbers, booleans, nothing, templates and lists of them
  'src/values.ts': [
    "import { defineComponent, html, signal, when, repeat } from 'thane';",
    "import { Card } from './card.js';",
    '',
    'export const Values = defineComponent(() => {',
    "  const name = signal<string | null>('a');",
    '  const n = signal(1);',
    '  const on = signal(true);',
    "  const items = signal([{ id: 1, label: 'x' }]);",
    '  const badge = html`<b>new</b>`;',
    '  return {',
    '    template: html`<p class=${name()} data-n=${n()} hidden=${!on()} ${when(on())}>',
    '      ${name()} ${n() + 1} ${on()} ${undefined} ${badge} ${Card({ label: "c" })}',
    '      ${when(on(), html`<i>on</i>`)} ${on() ? html`<b>y</b>` : null}',
    '      ${repeat(items(), (i) => html`<li>${i.label}</li>`)} ${items().map((i) => html`<li>${i.id}</li>`)}',
    '    </p>`,',
    '  };',
    '});',
    '',
  ].join('\n'),
  'src/card.ts': [
    "import { defineComponent, html } from 'thane';",
    '',
    'export const Card = defineComponent<{ label: string }>(({ props }) => ({ template: html`<b>${props.label}</b>` }));',
    '',
  ].join('\n'),
  // An object, a promise and an imported signal without its call in content; an object and a template in a tag
  'src/store.ts': "import { signal } from 'thane';\nexport const count = signal(0);\n",
  'src/wrong-values.ts': [
    "import { defineComponent, html, signal } from 'thane';",
    "import { count } from './store.js';",
    '',
    'export const WrongValues = defineComponent(() => {',
    "  const user = signal({ name: 'a' });",
    "  const load = async () => 'x';",
    '  return {',
    '    template: html`<p class=${user()} title=${html`<b>t</b>`}>${user()} ${load()} ${count}</p>`,',
    '  };',
    '});',
    '',
  ].join('\n'),
  // Refs: one for the tag's element, one for a wider type, one on a custom element; a canvas ref on an input
  'src/refs.ts': [
    "import { defineComponent, html, ref, signal, when } from 'thane';",
    '',
    'export const Refs = defineComponent(() => {',
    '  const input = ref<HTMLInputElement>();',
    '  const box = ref();',
    '  const custom = ref<HTMLDivElement>();',
    '  const open = signal(true);',
    '  return {',
    '    template: html`<input ${input} /><div ${box} ${when(open())}></div><my-el ${custom}></my-el>`,',
    '    onMount: () => input.el.focus(),',
    '  };',
    '});',
    '',
  ].join('\n'),
  'src/wrong-refs.ts': [
    "import { defineComponent, html, ref, signal } from 'thane';",
    '',
    'export const WrongRefs = defineComponent(() => {',
    '  const canvas = ref<HTMLCanvasElement>();',
    '  const open = signal(true);',
    '  return { template: html`<input ${canvas} /><p ${open}>x</p>` };',
    '});',
    '',
  ].join('\n'),
  // A call that returns a handler, and a ternary of handlers: each runs on the event, and its value is dropped
  'src/dropped-handler.ts': component(
    'DroppedHandler',
    'const makeHandler = (id: number) => () => count(id); const open = signal(false); const close = () => {}; const show = (e: Event) => e;',
    '<b @click=${makeHandler(1)} @blur=${open() ? close : show}>x</b>',
  ),
  // A row: in a row, a click handler from a call is checked the same way
  'src/row-dropped-handler.ts': [
    "import { defineComponent, html, repeat, signal } from 'thane';",
    '',
    'export const RowDropped = defineComponent(() => {',
    '  const rows = signal([1]);',
    '  const select = (n: number) => () => n;',
    '  return { template: html`<ul>${repeat(rows(), (n) => html`<li @click=${select(n)}>${n}</li>`)}</ul>` };',
    '});',
    '',
  ].join('\n'),
  'src/wrong-reference.ts': component(
    'WrongReference',
    'const onKey = (e: KeyboardEvent) => e.key;',
    '<b @keydown=${onKey} @click=${onKey}>x</b>',
  ),
};

let project: TempProject;
let output = '';

beforeAll(async () => {
  project = await createTempProject('export {};\n', { 'tsconfig.json': TSCONFIG, ...CASES });
  const saved = console.error;
  const lines: string[] = [];
  console.error = (...a: unknown[]) => lines.push(a.map((v) => String(v).replace(/\x1b\[[0-9;]*m/g, '')).join(' '));
  try {
    await runProjectTypeCheck({ strict: false, projectRoot: project.root });
  } finally {
    console.error = saved;
  }
  output = lines.join('\n');
}, 60_000);

afterAll(async () => {
  await removeTempProject(project);
});

/** The error lines (`file:line:column - error TS…: message`) reported for one file. */
const errorsIn = (file: string): string[] =>
  output.split('\n').filter((line) => line.includes(`${file}:`) && line.includes(' - error TS'));

/** `line:column` of the first `needle` in a case file, 1-based. */
const at = (file: string, needle: string): string => {
  const lines = CASES[file]!.split('\n');
  const line = lines.findIndex((l) => l.includes(needle));
  return `${line + 1}:${lines[line]!.indexOf(needle) + 1}`;
};

describe('template event handlers in the type check', () => {
  test('an untyped parameter gets the event type, and accepted handlers pass', () => {
    expect(errorsIn('src/untyped.ts')).toEqual([]);
    expect(errorsIn('src/accepted.ts')).toEqual([]);
  });

  test("a member the event does not have is an error, at the member's position", () => {
    const errors = errorsIn('src/wrong-member.ts');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`src/wrong-member.ts:${at('src/wrong-member.ts', 'key}')} - error TS2339`);
    expect(errors[0]).toContain(
      "Property 'key' does not exist on type 'PointerEvent & { readonly currentTarget: HTMLElement; }'",
    );
  });

  test('a handler for another event is an error, at the handler as written', () => {
    const errors = errorsIn('src/wrong-event.ts');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`src/wrong-event.ts:${at('src/wrong-event.ts', '(e: KeyboardEvent)')} - error TS1360`);
    expect(errors[0]).toContain(`does not satisfy the expected type 'ThaneEventListener<"click", "b">'`);
  });

  test("outside a row currentTarget is the element; in a row it is not the row's element", () => {
    expect(errorsIn('src/current-target.ts')).toEqual([]);
    const errors = errorsIn('src/row-target.ts');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("'e.currentTarget' is possibly 'null'");
    expect(errors[1]).toContain("Property 'id' does not exist on type 'EventTarget'");
  });

  test('a reference is checked against each event it is bound to', () => {
    const errors = errorsIn('src/wrong-reference.ts');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`src/wrong-reference.ts:${at('src/wrong-reference.ts', 'onKey}>')} - error TS1360`);
  });

  test('an expression whose value is a function is an error, at the expression: nothing would call it', () => {
    const errors = errorsIn('src/dropped-handler.ts');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain(
      `src/dropped-handler.ts:${at('src/dropped-handler.ts', 'makeHandler(1)')} - error TS2345`,
    );
    expect(errors[0]).toContain(
      "Argument of type '() => number' is not assignable to parameter of type '\"this runs on the event and its value is a function, which nothing calls: pass the handler itself, @click=${handler}, or call it, @click=${(e) => handler(e)}\"'",
    );
    expect(errors[1]).toContain(
      `src/dropped-handler.ts:${at('src/dropped-handler.ts', 'open() ? close')} - error TS2345`,
    );
    expect(errorsIn('src/row-dropped-handler.ts')).toHaveLength(1);
  });

  test('the values content shows and a tag takes pass: text, numbers, booleans, nothing, templates and their lists', () => {
    expect(errorsIn('src/values.ts')).toEqual([]);
    expect(errorsIn('src/card.ts')).toEqual([]);
  });

  test('an object, a promise or a function in content, and an object or a template in a tag, are errors', () => {
    const errors = errorsIn('src/wrong-values.ts');
    const at = (needle: string) => {
      const lines = CASES['src/wrong-values.ts']!.split('\n');
      const line = lines.findIndex((l) => l.includes(needle));
      return `${line + 1}:${lines[line]!.indexOf(needle) + 1}`;
    };
    expect(errors.map((e) => /:(\d+:\d+) - error (TS\d+)/.exec(e)!.slice(1).join(' '))).toEqual([
      `${at('user()} title')} TS1360`,
      `${at('html\`<b>t</b>\`')} TS1360`,
      `${at('user()} ${load')} TS1360`,
      `${at('load()}')} TS1360`,
      `${at('count}<')} TS1360`,
    ]);
    expect(errors[0]).toContain("does not satisfy the expected type 'ThaneAttribute'");
    expect(errors[2]).toContain("Type '{ name: string; }' does not satisfy the expected type 'ThaneContent'");
    expect(errors[3]).toContain("Type 'Promise<string>' does not satisfy the expected type 'ThaneContent'");
    expect(errors[4]).toContain("Type 'Signal<number>' does not satisfy the expected type 'ThaneContent'");
  });

  test("a ref is checked against its tag's element; any other value alone in a tag is an error", () => {
    expect(errorsIn('src/refs.ts')).toEqual([]);
    const errors = errorsIn('src/wrong-refs.ts');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain(`src/wrong-refs.ts:${at('src/wrong-refs.ts', 'canvas} />')} - error TS2345`);
    expect(errors[0]).toContain('"this ref is for another kind of element than the tag it is in"');
    expect(errors[1]).toContain(`src/wrong-refs.ts:${at('src/wrong-refs.ts', 'open}>')} - error TS2345`);
    expect(errors[1]).toContain("a ${…} alone in an element's tag is when(condition) or an element ref");
  });

  test('the printed source is the source as written', () => {
    expect(output).toContain('<b @click=${(e: KeyboardEvent) => e.key}>x</b>');
    expect(output).not.toContain('satisfies ThaneEventListener');
    expect(output).toContain('<b @click=${makeHandler(1)} @blur=${open() ? close : show}>x</b>');
    expect(output).not.toContain('__thaneEventCall');
    expect(output).not.toMatch(/satisfies Thane(Content|Attribute)|__thaneTag/);
  });
});
