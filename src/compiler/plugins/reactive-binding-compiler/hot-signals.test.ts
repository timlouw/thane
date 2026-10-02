/**
 * `thane dev` (the hotModule option): each signal a component's setup declares at its top level is compiled as
 * `__hotSignal(signal(…), 'name')`, and each one the file declares at its top level with the file's module key
 * too, for the page's hot runtime to keep their values through a hot update (runtime/hot.ts). Any other build
 * compiles them as they are written.
 */
import { describe, expect, test } from 'bun:test';
import { transformDefineComponentSource } from './index.js';

let fileId = 0;

const SOURCE = `import { defineComponent, signal, html } from 'thane';
const total = signal(0);
let notKept = signal(0);
export const Counter = defineComponent(() => {
  const count = signal<number>(1), label = signal('a');
  const other = 1;
  const handler = () => {
    const inner = signal(2);
    return inner;
  };
  if (other) {
    const nested = signal(3);
  }
  return { template: html\`<p @click=\${handler}>\${count()} \${label()} \${total()} \${notKept()}</p>\` };
});
export const Plain = defineComponent(() => ({ template: html\`<b>plain</b>\` }));
`;

const compile = (hotModule?: string): string => {
  const out = transformDefineComponentSource(SOURCE, `/virtual/hot-${fileId++}.ts`, undefined, { hotModule });
  if (out === null) throw new Error('not compiled');
  return out;
};

describe("thane dev: a setup's signals and the file's own are kept through hot updates", () => {
  test('the top-level consts of the setup by name, and of the file by module key and name', () => {
    const out = compile('src/counter.ts');
    expect(out).toContain(
      'const count = __hotSignal(signal<number>(1), "count"), label = __hotSignal(signal(\'a\'), "label");',
    );
    expect(out).toContain('const total = __hotSignal(signal(0), "total", "src/counter.ts");');
    expect(out).toMatch(/import \{[^}]*__hotSignal[^}]*\} from 'thane\/runtime'/);
  });

  test('a let, and a signal in a nested function or block, are left as written', () => {
    const out = compile('src/counter.ts');
    expect(out).toContain('let notKept = signal(0);');
    expect(out).toContain('const inner = signal(2);');
    expect(out).toContain('const nested = signal(3);');
    expect(out.match(/__hotSignal\(/g)).toHaveLength(3);
  });

  test('any other build compiles the signals as they are written', () => {
    const out = compile();
    expect(out).not.toContain('__hotSignal');
    expect(out).toContain("const count = signal<number>(1), label = signal('a');");
  });
});
