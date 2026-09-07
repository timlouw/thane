import { describe, expect, test } from 'bun:test';
import {
  processHtmlTemplateWithConditionals,
  processSubTemplateWithNesting,
} from './plugins/reactive-binding-compiler/template-processing.js';

const process = (template: string, inits = new Map<string, string | number | boolean>()) =>
  processHtmlTemplateWithConditionals(template, inits, 0);

describe('conditional initialization', () => {
  test('unresolved local whenElse expression defers initial branch selection', () => {
    const { processedContent } = process(
      '${whenElse(localMode === "ready", html`<p data-testid="then-branch">then</p>`, html`<p data-testid="else-branch">else</p>`)}',
    );

    expect(processedContent).not.toContain('data-testid="else-branch"');
    expect(processedContent).not.toContain('data-testid="then-branch"');
    expect(processedContent.match(/<template id="b\d+"><\/template>/g)?.length).toBe(2);
  });

  test('signal conditions without a known compile-time initializer defer initial branch selection', () => {
    const { processedContent } = process(
      '${whenElse(total() > 0, html`<p data-testid="then-branch">then</p>`, html`<p data-testid="else-branch">else</p>`)}',
    );

    expect(processedContent).not.toContain('data-testid="else-branch"');
    expect(processedContent).not.toContain('data-testid="then-branch"');
    expect(processedContent.match(/<template id="b\d+"><\/template>/g)?.length).toBe(2);
  });

  test('constant whenElse expressions still pre-render the chosen branch', () => {
    const { processedContent } = process(
      '${whenElse(1 + 1 === 2, html`<p data-testid="then-branch">then</p>`, html`<p data-testid="else-branch">else</p>`)}',
    );

    expect(processedContent).toContain('data-testid="then-branch"');
    expect(processedContent).not.toContain('data-testid="else-branch">else</p>');
    expect(processedContent.match(/<template id="b\d+"><\/template>/g)?.length).toBe(1);
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

  test('statically pre-rendered nested whenElse branches carry their branch id for runtime lookup', () => {
    const inits = new Map<string, string | number | boolean>([['flag', true]]);
    const template = '<div>${whenElse(flag(), html`<p>nested-then</p>`, html`<p>nested-else</p>`)}</div>';

    const result = processSubTemplateWithNesting(template, inits, 0, 'parent', { detectNonSignalBindings: true });

    expect(result.whenElseBlocks).toHaveLength(1);
    const we = result.whenElseBlocks[0]!;
    expect(we.initialValue).toBe(true);
    // Pre-rendered then branch must be findable by the runtime IF_EXPR binding
    expect(result.processedContent).toContain(`<p id="${we.thenId}">nested-then</p>`);
    // Deferred else branch stays a placeholder
    expect(result.processedContent).toContain(`<template id="${we.elseId}"></template>`);
  });

  test('whenElse nested inside a whenElse branch is collected once and does not corrupt adjacent content', () => {
    const inits = new Map<string, string | number | boolean>([
      ['outerGate', true],
      ['innerGate', true],
    ]);
    const template =
      '${whenElse(outerGate(), html`<div>${whenElse(innerGate(), html`<u>a</u>`, html`<u>b</u>`)}</div>`, html`<div>else</div>`)}' +
      '<p>AFTER-MARKER</p>';

    const result = process(template, inits);

    // Inner whenElse is owned by the outer branch's recursive processing — only one top-level block
    expect(result.whenElseBlocks).toHaveLength(1);
    expect(result.whenElseBlocks[0]?.thenWhenElse).toHaveLength(1);
    // Content following the outer whenElse must survive intact
    expect(result.processedContent).toContain('<p>AFTER-MARKER</p>');
  });

  test('whenElse inside a when()-element content is skipped without corrupting adjacent content', () => {
    const inits = new Map<string, string | number | boolean>([
      ['outerGate', true],
      ['innerGate', true],
    ]);
    const template =
      '<div ${when(outerGate())}>${whenElse(innerGate(), html`<u>a</u>`, html`<u>b</u>`)}</div>' +
      '<p>AFTER-MARKER</p>';

    const result = process(template, inits);

    expect(result.whenElseBlocks).toHaveLength(0);
    expect(result.processedContent).toContain('<p>AFTER-MARKER</p>');
  });
});
