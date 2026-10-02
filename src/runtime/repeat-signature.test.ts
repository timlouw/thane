/**
 * The `repeat()` marker's signature (markers.ts): its options, `{ key, empty }`, type-check every form the
 * compiler takes, and reject what it does not: a key that is not a property whose value is a string or a
 * number, an option it does not have, and anything but an options object in the third argument.
 *
 * One program holds the markers and a usage file with one call per case, each in its
 * own function; a case's diagnostics are the ones on its lines.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import ts from 'typescript';

const VALID: Record<string, string> = {
  'no options': 'repeat(items, row)',
  'a key property': "repeat(items, row, { key: 'id' })",
  'a key property of strings': "repeat(items, row, { key: 'label' })",
  'a key function': 'repeat(items, row, { key: (it, i) => `${it.id}-${i}` })',
  'an html template': 'repeat(items, row, { empty: html`<li>none</li>` })',
  'a key and an html template': "repeat(items, row, { key: 'id', empty: html`<li>none</li>` })",
  'a plain template literal': 'repeat(items, row, { empty: `<li>none</li>` })',
  'a readonly array': 'repeat(frozen, row)',
  'a key function over strings': 'repeat(words, (w) => html`<li>${w}</li>`, { key: (w) => w })',
};
const INVALID: Record<string, string> = {
  'a key function as the third argument': 'repeat(items, row, (it) => it.id)',
  'null as the third argument': 'repeat(items, row, null)',
  'a key that is not a property': "repeat(items, row, { key: 'nope' })",
  'a key whose values are not strings or numbers': "repeat(items, row, { key: 'on' })",
  'an option repeat() does not have': 'repeat(items, row, { trackBy: (it: { id: number }) => it.id })',
  'a function as the empty template': 'repeat(items, row, { empty: (it: { id: number }) => it.id })',
  'a signal as the items': 'repeat(() => items, row)',
};

const USAGE = '/repeat-signature/usage.ts';
const cases = Object.entries({ ...VALID, ...INVALID });
const usage = [
  `import { html, repeat } from '${join(import.meta.dir, 'markers.js').replaceAll('\\', '/')}';`,
  "const items = [{ id: 1, label: 'a', on: true }];",
  'const frozen: readonly { id: number; label: string; on: boolean }[] = items;',
  "const words = ['a', 'b'];",
  'const row = (it: { id: number }) => html`<li>${it.id}</li>`;',
  ...cases.map(([, call], i) => `export function case${i}() {\n  return ${call};\n}`),
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

describe('the repeat() marker', () => {
  test('every form of the options the compiler takes type-checks', () => {
    expect(diagnostics().get('setup')).toBeUndefined();
    for (const name of Object.keys(VALID)) expect({ [name]: diagnostics().get(name) }).toEqual({ [name]: [] });
  }, 60_000);

  for (const name of Object.keys(INVALID)) {
    test(`${name} is a type error`, () => {
      expect(diagnostics().get(name)?.join('\n')).toMatch(
        /not assignable|does not exist|Object literal may only|has no properties in common/,
      );
    }, 60_000);
  }
});
