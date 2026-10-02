/**
 * Code that type-checks and builds, then does the wrong thing at run time, is reported at build time:
 *
 * - THANE414: a signal used in a template without its call (`${count}`, `@input=${query}`, `when(show)`)
 * - THANE415: a setup's return key that nothing reads (`onMoun`), with the key it is close to
 * - THANE416 (a warning): a child's prop that reads a signal, which the child reads once, when it mounts
 *
 * Each rule is shown on the code it reports and on the code next to it that it leaves alone, and a build shows
 * what each does to the build.
 */
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import type { Diagnostic } from '../../types.js';
import { buildAndReadJs } from '../../testing/build-project.js';
import { logger } from '../../utils/index.js';
import { noUncalledSignal, noUnknownComponentKey, noSignalSnapshotProp } from './rules/index.js';
import type { LintRuleDefinition } from './rules/index.js';

const run = (rule: LintRuleDefinition, source: string): Diagnostic[] =>
  rule.check(ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), 'test.ts');

/** A component whose setup declares `count`, `query`, `show`, `items` and `total` (a computed) */
const component = (
  template: string,
  before = '',
) => `import { defineComponent, signal, computed, html, when, repeat } from 'thane';
${before}
export const App = defineComponent(() => {
  const count = signal(0);
  const query = signal('');
  const show = signal(true);
  const items = signal([{ id: 1, n: 'a' }]);
  const total = computed(() => count() * 2);
  return { template: html\`${template}\` };
});
`;

const messages = (rule: LintRuleDefinition, template: string, before?: string): string[] =>
  run(rule, component(template, before)).map((d) => `${d.code} ${d.severity}: ${d.message}`);

describe('THANE414 — a signal in a template without its call', () => {
  test('in content and in an attribute: the template would get the function itself', () => {
    expect(messages(noUncalledSignal, '<p class=${total}>${count}</p>')).toEqual([
      'THANE414 error: ${total} is the signal function itself, not its value: call it, ${total()}.',
      'THANE414 error: ${count} is the signal function itself, not its value: call it, ${count()}.',
    ]);
  });

  test('in an event slot: the signal would be called with the event, and set to it', () => {
    expect(messages(noUncalledSignal, '<input @input=${query} /><b @keydown.enter="${query}">x</b>')).toEqual([
      'THANE414 error: @input=${query} calls the signal with the event, which sets it to the event: write a handler, @input=${() => query(…)}.',
      'THANE414 error: @keydown=${query} calls the signal with the event, which sets it to the event: write a handler, @keydown=${() => query(…)}.',
    ]);
  });

  test('given to when() or repeat(), in a tag, in content and in a row', () => {
    expect(
      messages(
        noUncalledSignal,
        '<p ${when(show)}>a</p>${when(show, html`<b>b</b>`)}<ul>${repeat(items, (i) => html`<li ${when(show)}>${i.n}</li>`)}</ul>',
      ),
    ).toEqual([
      'THANE414 error: when(show) is given the signal itself, not its value: a function is always truthy. Call it: when(show()).',
      'THANE414 error: when(show, …) is given the signal itself, not its value: a function is always truthy. Call it: when(show(), …).',
      'THANE414 error: repeat(items, …) is given the signal itself, not its value: it lists nothing. Call it: repeat(items(), …).',
      'THANE414 error: when(show) is given the signal itself, not its value: a function is always truthy. Call it: when(show()).',
    ]);
  });

  test('a two-way binding takes the signal itself', () => {
    expect(
      messages(noUncalledSignal, '<input bind:value=${query} /><input type="checkbox" bind:checked="${show}" />'),
    ).toEqual([]);
  });

  test('a call, and a name that is not a signal where the template reads it, pass', () => {
    expect(
      messages(noUncalledSignal, '<p class=${total()}>${count()}</p><input @input=${(e) => query(e.type)} />'),
    ).toEqual([]);
    // A row's parameter, a handler, and a local of an inner scope hide the component's signal
    expect(messages(noUncalledSignal, '${repeat(items(), (count) => html`<li>${count}</li>`)}')).toEqual([]);
    expect(
      run(
        noUncalledSignal,
        `import { html, signal, defineComponent } from 'thane';
const count = signal(0);
const label = (count: string) => html\`<b>\${count}</b>\`;
export const App = defineComponent(() => {
  const count = 'static';
  return { template: html\`<p>\${count}</p>\` };
});`,
      ),
    ).toEqual([]);
  });

  test('an imported signal is left to the type check, which sees its type', () => {
    expect(
      run(
        noUncalledSignal,
        `import { html, defineComponent } from 'thane';
import { count } from './store.js';
export const App = defineComponent(() => ({ template: html\`<p>\${count}</p>\` }));`,
      ),
    ).toEqual([]);
  });

  test('a top-level signal of the file is reported in a component that reads it', () => {
    const d = run(
      noUncalledSignal,
      `import { html, signal, defineComponent } from 'thane';
export const theme = signal('dark');
export const App = defineComponent(() => ({ template: html\`<p class=\${theme}>x</p>\` }));`,
    );
    expect(d.map((x) => x.message)).toEqual([
      '${theme} is the signal function itself, not its value: call it, ${theme()}.',
    ]);
    expect(d[0]!.location).toMatchObject({ line: 3 });
  });

  test('it fails the build', async () => {
    await expect(
      buildAndReadJs(component('<p>${count}</p>') + 'import { mount } from "thane";\nmount(App);\n', {
        config: { strictTypeCheck: false },
      }),
    ).rejects.toThrow('is the signal function itself');
  });
});

describe("THANE415 — a key of a setup's return object that nothing reads", () => {
  const returning = (keys: string) =>
    run(
      noUnknownComponentKey,
      `import { defineComponent, html, css } from 'thane';
export const App = defineComponent(() => {
  const start = () => {};
  return { template: html\`<p>x</p>\`, ${keys} };
});`,
    ).map((d) => `${d.code}: ${d.message}`);

  test('a misspelled hook or key, with the key it is close to', () => {
    expect(returning('onMoun: () => start(), onDestory() {}, stlyes: css`p { color: red; }`')).toEqual([
      "THANE415: 'onMoun' is not a key of a component, and nothing reads it: did you mean 'onMount'?",
      "THANE415: 'onDestory' is not a key of a component, and nothing reads it: did you mean 'onDestroy'?",
      "THANE415: 'stlyes' is not a key of a component, and nothing reads it: did you mean 'styles'?",
    ]);
  });

  test('a key close to none of them lists the four', () => {
    expect(returning("state: { open: false }, 'data-x': 1")).toEqual([
      "THANE415: 'state' is not a key of a component, and nothing reads it. A setup returns template, styles, onMount, onDestroy.",
      "THANE415: 'data-x' is not a key of a component, and nothing reads it. A setup returns template, styles, onMount, onDestroy.",
    ]);
  });

  test('the four keys pass, written as properties, shorthand or methods', () => {
    expect(returning('styles: css`p { color: red; }`, onMount() { start(); }, onDestroy: start')).toEqual([]);
    expect(
      run(
        noUnknownComponentKey,
        `import { defineComponent, html } from 'thane';
export const App = defineComponent(() => {
  const template = html\`<p>x</p>\`;
  const onMount = () => {};
  return { template, onMount };
});`,
      ),
    ).toEqual([]);
  });

  test('an object a function inside the setup returns is not the return object', () => {
    expect(
      run(
        noUnknownComponentKey,
        `import { defineComponent, html } from 'thane';
export const App = defineComponent(() => {
  const make = () => ({ onMoun: 1 });
  return { template: html\`<p>\${make().onMoun}</p>\` };
});`,
      ),
    ).toEqual([]);
  });

  test('it fails the build', async () => {
    await expect(
      buildAndReadJs(
        `import { defineComponent, html, mount } from 'thane';
export const App = defineComponent(() => ({ template: html\`<p>x</p>\`, onMoun: () => {} }));
mount(App);
`,
        { config: { strictTypeCheck: false } },
      ),
    ).rejects.toThrow("did you mean 'onMount'?");
  });
});

describe("THANE416 — a child's prop that reads a signal", () => {
  const before = `const Badge = defineComponent<{ label: unknown; onPick?: () => void }>('x-badge', ({ props }) => ({
  template: html\`<b>\${String(props.label)}</b>\`,
}));`;

  test('reads it once, when the child mounts: a warning that says what to pass', () => {
    expect(messages(noSignalSnapshotProp, "${Badge({ label: 'n: ' + count() })}", before)).toEqual([
      "THANE416 warning: label: 'n: ' + count() reads count once, when Badge mounts: it does not see count change. Pass the signal, label: count, typed ReadonlySignal in the child's props, and read it in its template.",
    ]);
  });

  test('in a branch and a row too', () => {
    const d = messages(
      noSignalSnapshotProp,
      '${when(show(), html`${Badge({ label: total() })}`)}<ul>${repeat(items(), (i) => html`<li>${Badge({ label: i.n + query() })}</li>`)}</ul>',
      before,
    );
    expect(d.map((m) => m.split(' reads ')[0])).toEqual([
      'THANE416 warning: label: total()',
      'THANE416 warning: label: i.n + query()',
    ]);
  });

  test('the signal itself, a callback that reads it, a row item and plain values pass', () => {
    expect(
      messages(
        noSignalSnapshotProp,
        "${Badge({ label: count, onPick: () => count(count() + 1) })}${Badge({ label: 'x' })}<ul>${repeat(items(), (i) => html`<li>${Badge({ label: i.n })}</li>`)}</ul>",
        before,
      ),
    ).toEqual([]);
  });

  const reported = async (lint: Record<string, 'off' | 'warning' | 'error'>): Promise<string[]> => {
    const codes: string[] = [];
    const original = logger.diagnostics.bind(logger);
    logger.diagnostics = (diagnostics) => {
      codes.push(...diagnostics.map((d) => `${d.code} ${d.severity}`));
      original(diagnostics);
    };
    try {
      await buildAndReadJs(
        component('${Badge({ label: count() })}', before) + 'import { mount } from "thane";\nmount(App);\n',
        { config: { lint, strictTypeCheck: false } },
      );
    } finally {
      logger.diagnostics = original;
    }
    return codes;
  };

  test('the build goes on with the warning; lint turns it off, or into an error', async () => {
    expect(await reported({})).toEqual(['THANE416 warning']);
    expect(await reported({ THANE416: 'off' })).toEqual([]);
    await expect(reported({ THANE416: 'error' })).rejects.toThrow('reads count once');
  });
});
