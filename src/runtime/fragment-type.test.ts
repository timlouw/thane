/**
 * The Fragment type (markers.ts): an html template is a Fragment, and so is a child component call and a
 * directive, so each goes where a template goes. A component's `template` takes an html template only (the
 * compiler compiles nothing else there); a directive's templates take a plain template literal of markup
 * too, as the compiler does. A child call in a template is TypeScript like any other: a callback prop's
 * parameters are typed from the component's props, and a prop can be typed as a Fragment.
 *
 * One program holds the runtime and a usage file with one case per function; a case's diagnostics are the
 * ones on its lines.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import ts from 'typescript';

const VALID: Record<string, string> = {
  'an html template is a Fragment': 'const f: Fragment = html`<p></p>`; return f;',
  "a component's template": 'return defineComponent(() => ({ template: html`<p></p>` }));',
  'a child component call is a Fragment': 'const f: Fragment = Card({ n: 1 }); return f;',
  'fragments and plain markup as when() branches': 'return when(true, spinner, `<b></b>`);',
  'a component call as a row': 'return repeat(items, (it) => Card({ n: it.id }), { empty: spinner });',
  'a directive in a template': 'return html`<div>${when(true, spinner)}</div>`;',
  "a callback prop's parameters are typed at a child call site":
    'return html`<ul>${Picker({ onPick: (id) => id.toFixed(0), label: spinner })}</ul>`;',
};
const INVALID: Record<string, [call: string, message: RegExp]> = {
  "a string as a component's template": [
    "return defineComponent(() => ({ template: '<p></p>' }));",
    /not assignable to type 'Fragment'/,
  ],
  'a number as a when() branch': ['return when(true, 1, spinner);', /not assignable/],
  'a row that is not a template': ['return repeat(items, (it) => it.id);', /not assignable/],
  "a fragment's members": ['return spinner.length;', /does not exist on type 'Fragment'/],
  'a callback prop used with the wrong type': [
    'return html`${Picker({ onPick: (id) => id.toUpperCase(), label: spinner })}`;',
    /Property 'toUpperCase' does not exist on type 'number'/,
  ],
  'a string where a prop takes a Fragment': [
    "return html`${Picker({ onPick: () => {}, label: '<b>x</b>' })}`;",
    /not assignable to type 'Fragment'/,
  ],
};

const USAGE = '/fragment-type/usage.ts';
const cases: [string, string][] = [
  ...Object.entries(VALID),
  ...Object.entries(INVALID).map(([name, [call]]) => [name, call] as [string, string]),
];
const runtime = (file: string): string => join(import.meta.dir, file).replaceAll('\\', '/');
const usage = [
  `import { html, when, repeat, type Fragment } from '${runtime('markers.js')}';`,
  `import { defineComponent } from '${runtime('component.js')}';`,
  'const items = [{ id: 1 }];',
  'const spinner = html`<span></span>`;',
  'const Card = defineComponent<{ n: number }>(({ props }) => ({ template: html`<b>${props.n}</b>` }));',
  'const Picker = defineComponent<{ onPick: (id: number) => void; label: Fragment }>(() => ({ template: html`<i></i>` }));',
  ...cases.map(([, body], i) => `export function case${i}() {\n  ${body}\n}`),
].join('\n');

/** The diagnostics of the usage file, by case name. */
const diagnosticsByCase = (): Map<string, string[]> => {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  const fileExists = host.fileExists;
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === USAGE
      ? ts.createSourceFile(name, usage, languageVersion, true)
      : getSourceFile.call(host, name, languageVersion, ...rest);
  host.fileExists = (name) => name === USAGE || fileExists.call(host, name);
  const program = ts.createProgram([join(import.meta.dir, 'markers.ts'), USAGE], options, host);
  const file = program.getSourceFile(USAGE)!;
  const lines = usage.split('\n');
  const byCase = new Map<string, string[]>(cases.map(([name]) => [name, []]));
  for (const d of ts.getPreEmitDiagnostics(program, file)) {
    const line = file.getLineAndCharacterOfPosition(d.start ?? 0).line;
    const fn = lines.slice(0, line + 1).findLastIndex((l) => l.startsWith('export function case'));
    const name = fn === -1 ? 'setup' : cases[Number(/case(\d+)/.exec(lines[fn]!)![1])]![0];
    byCase.set(name, [...(byCase.get(name) ?? []), ts.flattenDiagnosticMessageText(d.messageText, '\n')]);
  }
  return byCase;
};

let computed: Map<string, string[]> | undefined;
const diagnostics = (): Map<string, string[]> => (computed ??= diagnosticsByCase());

describe('the Fragment type', () => {
  test('templates, component calls and directives go where a template goes', () => {
    expect(diagnostics().get('setup')).toBeUndefined();
    for (const name of Object.keys(VALID)) expect({ [name]: diagnostics().get(name) }).toEqual({ [name]: [] });
  }, 60_000);

  for (const [name, [, message]] of Object.entries(INVALID)) {
    test(`${name} is a type error`, () => {
      expect(diagnostics().get(name)?.join('\n')).toMatch(message);
    }, 60_000);
  }
});
