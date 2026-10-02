import { describe, expect, test } from 'bun:test';
import { processHtmlTemplateWithConditionals, processSubTemplateWithNesting } from './template-processing.js';

const process = (template: string, inits = new Map<string, string | number | boolean>()) =>
  processHtmlTemplateWithConditionals(template, inits, 0);

describe('conditional initialization', () => {
  test('unresolved local whenElse expression defers initial branch selection', () => {
    const { processedContent } = process(
      '${when(localMode === "ready", html`<p data-testid="then-branch">then</p>`, html`<p data-testid="else-branch">else</p>`)}',
    );

    expect(processedContent).not.toContain('data-testid="else-branch"');
    expect(processedContent).not.toContain('data-testid="then-branch"');
    // Three anchors with nothing between them: the runtime picks the branch at mount
    expect(processedContent).toMatch(/^<!--(b\d+)\(--><!--\1\|--><!--\1\)-->$/);
  });

  test('signal conditions without a known compile-time initializer defer initial branch selection', () => {
    const { processedContent } = process(
      '${when(total() > 0, html`<p data-testid="then-branch">then</p>`, html`<p data-testid="else-branch">else</p>`)}',
    );

    expect(processedContent).not.toContain('data-testid="else-branch"');
    expect(processedContent).not.toContain('data-testid="then-branch"');
    expect(processedContent).toMatch(/^<!--(b\d+)\(--><!--\1\|--><!--\1\)-->$/);
  });

  test('constant whenElse expressions still pre-render the chosen branch', () => {
    const { processedContent } = process(
      '${when(1 + 1 === 2, html`<p data-testid="then-branch">then</p>`, html`<p data-testid="else-branch">else</p>`)}',
    );

    expect(processedContent).toContain('data-testid="then-branch"');
    expect(processedContent).not.toContain('data-testid="else-branch">else</p>');
    // The then branch between the first two anchors, nothing between the last two
    expect(processedContent).toMatch(/^<!--(b\d+)\(--><p data-testid="then-branch">then<\/p><!--\1\|--><!--\1\)-->$/);
  });

  test('a when() without an else-branch is one conditional between two anchors; an empty branch shows nothing', () => {
    const { processedContent, whenElseBlocks, conditionals } = process('${when(1 + 1 === 2, html`<p>then</p>`)}');
    expect(whenElseBlocks).toHaveLength(0);
    expect(conditionals).toHaveLength(1);
    expect(conditionals[0]!.templateContent).toBe('<p>then</p>');
    expect(processedContent).toMatch(/^<!--(b\d+)\(--><p>then<\/p><!--\1\)-->$/);
    // An else-branch written empty is the same conditional
    expect(process('${when(1 + 1 === 2, html`<p>then</p>`, html``)}').processedContent).toMatch(
      /^<!--(b\d+)\(--><p>then<\/p><!--\1\)-->$/,
    );

    const emptyThen = process('${when(1 + 1 === 2, html``, html`<p>else</p>`)}');
    expect(emptyThen.whenElseBlocks).toHaveLength(1);
    expect(emptyThen.processedContent).toMatch(/^<!--(b\d+)\(--><!--\1\|--><!--\1\)-->$/);
  });

  test('template literal expressions with nested object literals are parsed intact', () => {
    const { bindings } = process('<p>${`x${{ value: 1 }.value}`}</p>');
    const exprBindings = bindings.filter((binding) => 'expression' in binding);

    expect(exprBindings).toHaveLength(1);
    expect(exprBindings[0]).toMatchObject({
      type: 'text',
      expression: '`x${{ value: 1 }.value}`',
    });
  });

  test('sub-template bindings exclude text bindings owned by nested conditionals', () => {
    const template =
      '<section>' +
      "<div data-value=\"${localExpressionMeta.label + '-' + exprA() + '-' + exprSum()}\">" +
      "${localExpressionMeta.label + '-' + exprA() + '-' + exprSum()}" +
      '</div>' +
      '<b ${when(exprSum() % 2 === 0)}>even-${exprSum()}</b>' +
      '</section>';

    const result = processSubTemplateWithNesting(template, new Map(), 0, 'parent', { detectNonSignalBindings: true });

    expect(result.bindings).toHaveLength(2);
    expect(result.bindings.every((binding) => binding.conditionalId !== 'b0')).toBe(true);
    expect(result.conditionals).toHaveLength(1);
    expect(result.conditionals[0]?.nestedBindings).toHaveLength(1);
  });

  test('a statically pre-rendered nested whenElse branch sits between its first two anchors', () => {
    const inits = new Map<string, string | number | boolean>([['flag', true]]);
    const template = '<div>${when(flag(), html`<p>nested-then</p>`, html`<p>nested-else</p>`)}</div>';

    const result = processSubTemplateWithNesting(template, inits, 0, 'parent', { detectNonSignalBindings: true });

    expect(result.whenElseBlocks).toHaveLength(1);
    const we = result.whenElseBlocks[0]!;
    expect(we.initialValue).toBe(true);
    // The pre-rendered then branch is what the runtime finds between the first two anchors, and the
    // deferred else branch leaves nothing between the last two
    expect(result.processedContent).toBe(
      `<div><!--${we.thenId}(--><p>nested-then</p><!--${we.thenId}|--><!--${we.thenId})--></div>`,
    );
  });

  test('whenElse nested inside a whenElse branch is collected once and does not corrupt adjacent content', () => {
    const inits = new Map<string, string | number | boolean>([
      ['outerGate', true],
      ['innerGate', true],
    ]);
    const template =
      '${when(outerGate(), html`<div>${when(innerGate(), html`<u>a</u>`, html`<u>b</u>`)}</div>`, html`<div>else</div>`)}' +
      '<p>AFTER-MARKER</p>';

    const result = process(template, inits);

    // Inner whenElse is owned by the outer branch's recursive processing — only one top-level block
    expect(result.whenElseBlocks).toHaveLength(1);
    expect(result.whenElseBlocks[0]?.thenWhenElse).toHaveLength(1);
    // Content following the outer whenElse must survive intact
    expect(result.processedContent).toContain('<p>AFTER-MARKER</p>');
  });

  test('whenElse inside a when() element is collected under the conditional, not at the top level', () => {
    const inits = new Map<string, string | number | boolean>([
      ['outerGate', true],
      ['innerGate', true],
    ]);
    const template =
      '<div ${when(outerGate())}>${when(innerGate(), html`<u>a</u>`, html`<u>b</u>`)}</div>' + '<p>AFTER-MARKER</p>';

    const result = process(template, inits);

    expect(result.whenElseBlocks).toHaveLength(0);
    expect(result.conditionals).toHaveLength(1);
    expect(result.conditionals[0]?.nestedWhenElse).toHaveLength(1);
    expect(result.processedContent).toContain('<p>AFTER-MARKER</p>');
  });
});
