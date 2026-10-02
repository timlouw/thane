/**
 * A template call resolved in the component's scope: a function of the component is not a signal, and the
 * binding follows the signals its body reads; a helper called with arguments is followed on its body's
 * signals too; an unknown name is still read as a signal.
 */
import { describe, expect, test } from 'bun:test';
import { buildAndReadJs } from '../../testing/build-project.js';

const app = (setup: string, markup: string, imports = ''): string => `
import { defineComponent, signal, computed, html, mount } from 'thane';
${imports}
export const App = defineComponent('x-app', ({ props }) => {
${setup}
  return { template: html\`${markup}\` };
});
mount(App);
`;

/** The compiled binding function of the component */
const bindings = async (setup: string, markup: string, extraFiles?: Record<string, string>, imports = '') => {
  const js = await buildAndReadJs(app(setup, markup, imports), {
    config: { strictTypeCheck: false },
    ...(extraFiles && { extraFiles }),
  });
  const at = js.indexOf('__b:');
  return js.slice(at, js.indexOf('return () =>', at));
};

describe('template calls resolved in the component scope', () => {
  test('a plain function of the component renders once; it is not read as a signal', async () => {
    const js = await bindings("  const label = () => 'Label';", '<b>${label()}</b>');
    expect(js).not.toContain('label.subscribe');
    expect(js).toContain('label()');
  });

  test('a function that reads signals is followed on each of them, in text and attributes', async () => {
    const js = await bindings(
      '  const price = signal(1);\n  const qty = signal(2);\n  const total = () => price() * qty();',
      '<i title=${total()}>${total()}</i>',
    );
    expect(js).not.toContain('total.subscribe');
    expect(js.match(/price\.subscribe/g)).toHaveLength(2);
    expect(js.match(/qty\.subscribe/g)).toHaveLength(2);
  });

  test("a helper called with arguments is followed on its arguments' signals and its own", async () => {
    const js = await bindings(
      "  const amount = signal(1);\n  const currency = signal('EUR');\n  const format = (n: number) => n.toFixed(2) + ' ' + currency();",
      '<p>${format(amount())}</p>',
    );
    expect(js).toContain('amount.subscribe');
    expect(js).toContain('currency.subscribe');
  });

  test('functions calling functions, a function declaration, a computed, and a prop signal', async () => {
    const js = await bindings(
      [
        '  const a = signal(1);',
        '  const doubled = computed(() => a() * 2);',
        '  function base() { return doubled() + props.offset(); }',
        '  const shown = () => base() + 1;',
      ].join('\n'),
      '<p>${shown()}</p>',
    );
    expect(js).toContain('doubled.subscribe');
    expect(js).toContain('props.offset.subscribe');
    expect(js).not.toContain('shown.subscribe');
    expect(js).not.toContain('base.subscribe');
  });

  test('a name a function declares for itself hides the component’s, and recursion ends', async () => {
    const js = await bindings(
      [
        '  const price = signal(1);',
        '  const echo = (price: number) => price;',
        '  const ping = (n: number): number => (n > 0 ? pong(n - 1) : price());',
        '  const pong = (n: number): number => ping(n);',
      ].join('\n'),
      '<p>${echo(1)}</p><b>${ping(3)}</b>',
    );
    expect(js.match(/price\.subscribe/g)).toHaveLength(1);
  });

  test('an imported name, or a local value that is not a function, is still read as a signal', async () => {
    const js = await bindings(
      '  const fromStore = store.count;',
      '<p>${count()}</p><b>${fromStore()}</b>',
      {
        'src/store.ts':
          "import { signal } from 'thane';\nexport const count = signal(0);\nexport const store = { count };\n",
      },
      "import { count, store } from './store.js';",
    );
    expect(js).toContain('count.subscribe');
    expect(js).toContain('fromStore.subscribe');
  });
});
