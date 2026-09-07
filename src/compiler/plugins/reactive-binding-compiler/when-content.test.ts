import { describe, expect, test } from 'bun:test';
import { processHtmlTemplateWithConditionals } from './template-processing.js';
import { generateInitBindingsFunction } from './codegen.js';
import { transformDefineComponentSource } from './index.js';
import { CLOSURE_ACCESS } from './types.js';

type Init = [string, string | number | boolean];
const inits = (entries: Init[] = []) => new Map<string, string | number | boolean>(entries);
const processTemplate = (template: string, initializers = inits()) =>
  processHtmlTemplateWithConditionals(template, initializers, 0);
const generate = (template: string, initializers = inits()) => {
  const r = processTemplate(template, initializers);
  return generateInitBindingsFunction(
    r.bindings,
    r.conditionals,
    r.whenElseBlocks,
    r.repeatBlocks,
    r.eventBindings,
    'x.ts',
    CLOSURE_ACCESS,
  ).code;
};

describe('when() content is processed as a sub-template', () => {
  test('event handlers on elements inside a when() block get their own element ids', () => {
    const { conditionals, eventBindings, processedContent } = processTemplate(
      '<div ${when(show())}><button @click=${a}>A</button><button @click=${b}>B</button></div>',
      inits([['show', true]]),
    );

    expect(conditionals).toHaveLength(1);
    const cond = conditionals[0]!;
    expect(cond.nestedEventBindings.map((e) => [e.elementId, e.handlerExpression])).toEqual([
      ['b1', 'a'],
      ['b2', 'b'],
    ]);
    expect(cond.templateContent).toBe('<div id="b0"><button id="b1">A</button><button id="b2">B</button></div>');
    // Not duplicated at the top level — the conditional's initializer owns them
    expect(eventBindings).toHaveLength(0);
    expect(processedContent).toContain('<button id="b1">A</button>');
  });

  test('content following a when() block that contains an event handler is preserved', () => {
    const { processedContent } = processTemplate(
      '<div ${when(show())}><button @click=${a}>A</button></div><p data-testid="after">AFTER</p>',
      inits([['show', true]]),
    );
    expect(processedContent).toBe('<div id="b0"><button id="b1">A</button></div><p data-testid="after">AFTER</p>');
  });

  test('whenElse inside a when() block is owned by the conditional and adjacent content stays intact', () => {
    const r = processTemplate(
      '<div ${when(outerGate())}>${whenElse(innerGate(), html`<u>a</u>`, html`<u>b</u>`)}</div><p>AFTER-MARKER</p>',
      inits([
        ['outerGate', true],
        ['innerGate', true],
      ]),
    );

    expect(r.whenElseBlocks).toHaveLength(0);
    const cond = r.conditionals[0]!;
    expect(cond.nestedWhenElse).toHaveLength(1);
    const we = cond.nestedWhenElse[0]!;
    expect(cond.templateContent).toBe(
      `<div id="b0"><u id="${we.thenId}">a</u><template id="${we.elseId}"></template></div>`,
    );
    expect(r.processedContent).toContain('<p>AFTER-MARKER</p>');
  });

  test('repeat inside a when() block is owned by the conditional and anchored inside its content', () => {
    const r = processTemplate(
      '<ul ${when(show())}>${repeat(items(), (it) => html`<li>${it.name}</li>`)}</ul><p>AFTER</p>',
      inits([['show', true]]),
    );

    expect(r.repeatBlocks).toHaveLength(0);
    const cond = r.conditionals[0]!;
    expect(cond.nestedRepeats).toHaveLength(1);
    const rep = cond.nestedRepeats[0]!;
    expect(cond.templateContent).toBe(`<ul id="b0"><template id="${rep.id}"></template></ul>`);
    expect(r.processedContent).toBe(`<ul id="b0"><template id="${rep.id}"></template></ul><p>AFTER</p>`);
  });

  test('bindings inside a nested when() belong to the nested block only', () => {
    const r = processTemplate(
      '<div ${when(show())}><p ${when(count() > 0)}>inner-${count()}</p></div>',
      inits([
        ['show', true],
        ['count', 1],
      ]),
    );

    const outer = r.conditionals[0]!;
    expect(outer.nestedBindings).toHaveLength(0);
    expect(outer.nestedConditionals).toHaveLength(1);
    const inner = outer.nestedConditionals[0]!;
    expect(inner.nestedBindings).toHaveLength(1);
    expect(inner.nestedBindings[0]!.conditionalId).toBe(inner.id);
    expect(outer.templateContent).toBe(
      `<div id="b0"><p id="${inner.id}">inner-<!--${inner.nestedBindings[0]!.id}-->1<!----></p></div>`,
    );
  });

  test('a when() condition without a known initializer defers rendering to the runtime', () => {
    const r = processTemplate('<div ${when(localFlag === "on")}>maybe</div>');
    expect(r.conditionals[0]!.initialValue).toBeUndefined();
    expect(r.processedContent).toBe('<template id="b0"></template>');
  });

  test('a user-supplied id on a when() element is reused as the conditional id without duplication', () => {
    const r = processTemplate(
      '<div id="box" ${when(show())} class=${cls()}>x</div>',
      inits([
        ['show', true],
        ['cls', 'c'],
      ]),
    );
    expect(r.conditionals[0]!.id).toBe('box');
    expect(r.processedContent).toBe('<div id="box" class="c">x</div>');
  });
});

describe('generated initializer for when() content', () => {
  test('binds nested events, text and directives inside the conditional initializer', () => {
    const code = generate(
      '<div ${when(show())}><button @click=${a}>A</button><span>${count()}</span>${whenElse(inner(), html`<u>a</u>`, html`<u>b</u>`)}</div>',
      inits([
        ['show', true],
        ['inner', true],
        ['count', 1],
      ]),
    );

    expect(code).toContain("__bindIf(r, show, 'b0'");
    expect(code).toMatch(/_gid\('b\d+'\)\?\.addEventListener\('click', a\)/);
    expect(code).toContain('__bindIfExpr(r, [inner], () => inner()');
    expect(code).toContain('__bindIfExpr(r, [inner], () => !(inner())');
    expect(code).toMatch(/count\.subscribe\(v => \{ b\d+\.nextSibling\.data = v; \}, true\)/);
    // Nothing from inside the block leaks into the top-level initializer
    expect(code.split("__bindIf(r, show, 'b0'")[0]).not.toContain('addEventListener');
  });

  test('imports runtime helpers that are only used inside nested directive content', () => {
    const source = `
import { defineComponent, signal } from 'thane';

export const NestedApp = defineComponent('nested-app', () => {
  const gate = signal(true);
  const show = signal(true);
  return {
    template: html\`
      \${whenElse(gate(), html\`<p \${when(show())}>then</p>\`, html\`<p>else</p>\`)}
    \`,
  };
});
`;
    const out = transformDefineComponentSource(source, '/virtual/nested-app.ts');
    expect(out).not.toBeNull();
    const runtimeImport = out!.split('\n').find((line) => line.includes("from 'thane/runtime'"));
    expect(runtimeImport).toBeDefined();
    // The only simple when() lives inside a whenElse branch — it still needs __bindIf
    expect(runtimeImport).toMatch(/\b__bindIf\b/);
    expect(runtimeImport).toMatch(/\b__bindIfExpr\b/);
  });
});
