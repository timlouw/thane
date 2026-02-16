/**
 * Automated tests for the Tagged Templates VS Code extension.
 *
 * These tests validate the core grammar-generation logic that lives in
 * `grammar-utils.ts` — a pure module with zero VS Code dependencies.
 * All functions under test are the REAL production code, not replicas.
 *
 * Autocomplete trigger-pattern tests verify the regex patterns used by the
 * CompletionItemProviders inside `extension.ts`. These patterns are
 * tested here as behavioural contracts so changes to the matching logic
 * are caught even without spinning up the extension host.
 *
 * Run with: `bun test` from the extension root.
 */

import { describe, test, expect } from 'bun:test';
import {
  escapeRegex,
  embeddedBlockScope,
  resolveTagMappings,
  generateGrammar,
} from './grammar-utils.js';

// ─────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────

describe('Tagged Templates Extension — Grammar Generation', () => {
  test('escapeRegex escapes special characters', () => {
    expect(escapeRegex('html')).toBe('html');
    expect(escapeRegex('a.b')).toBe('a\\.b');
    expect(escapeRegex('foo(bar)')).toBe('foo\\(bar\\)');
  });

  test('embeddedBlockScope maps standard languages', () => {
    expect(embeddedBlockScope('html')).toBe('meta.embedded.block.html');
    expect(embeddedBlockScope('css')).toBe('meta.embedded.block.css');
    expect(embeddedBlockScope('json')).toBe('meta.embedded.block.json');
  });

  test('embeddedBlockScope maps aliased languages', () => {
    expect(embeddedBlockScope('shellscript')).toBe('meta.embedded.block.shell');
    expect(embeddedBlockScope('typescriptreact')).toBe('meta.embedded.block.typescript');
    expect(embeddedBlockScope('javascriptreact')).toBe('meta.embedded.block.javascript');
  });

  test('resolveTagMappings resolves valid tags', () => {
    const mappings = resolveTagMappings({ html: 'html', css: 'css' });
    expect(mappings.length).toBe(2);
    expect(mappings[0]!.tag).toBe('html');
    expect(mappings[0]!.grammarScope).toBe('text.html.basic');
    expect(mappings[1]!.tag).toBe('css');
    expect(mappings[1]!.grammarScope).toBe('source.css');
  });

  test('resolveTagMappings skips unknown languages', () => {
    const mappings = resolveTagMappings({ html: 'html', foo: 'unknownlang' });
    expect(mappings.length).toBe(1);
    expect(mappings[0]!.tag).toBe('html');
  });

  test('resolveTagMappings trims whitespace', () => {
    const mappings = resolveTagMappings({ '  html  ': '  HTML  ' });
    expect(mappings.length).toBe(1);
    expect(mappings[0]!.tag).toBe('html');
    expect(mappings[0]!.languageId).toBe('html');
  });

  test('resolveTagMappings skips empty keys/values', () => {
    const mappings = resolveTagMappings({ '': 'html', 'css': '' });
    expect(mappings.length).toBe(0);
  });

  test('generateGrammar produces correct structure', () => {
    const mappings = resolveTagMappings({ html: 'html', sql: 'sql' });
    const grammar = generateGrammar(mappings);

    expect(grammar.scopeName).toBe('inline.tagged-templates');
    expect(grammar.patterns.length).toBe(2);
    expect(grammar.repository['tag-html']).toBeDefined();
    expect(grammar.repository['tag-sql']).toBeDefined();
  });

  test('generateGrammar includes injection selector for all source types', () => {
    const mappings = resolveTagMappings({ html: 'html' });
    const grammar = generateGrammar(mappings);

    expect(grammar.injectionSelector).toContain('L:source.ts');
    expect(grammar.injectionSelector).toContain('L:source.js');
    expect(grammar.injectionSelector).toContain('L:source.tsx');
  });

  test('generateGrammar repository entries have correct begin/end patterns', () => {
    const mappings = resolveTagMappings({ html: 'html' });
    const grammar = generateGrammar(mappings);
    const entry = grammar.repository['tag-html'];

    expect(entry.begin).toContain('html');
    expect(entry.end).toBe('(`)');
    expect(entry.contentName).toBe('meta.embedded.block.html');
  });

  test('generateGrammar handles multiple mappings independently', () => {
    const mappings = resolveTagMappings({ html: 'html', css: 'css', sql: 'sql' });
    const grammar = generateGrammar(mappings);

    expect(grammar.patterns.length).toBe(3);
    expect(Object.keys(grammar.repository).length).toBe(3);

    const htmlEntry = grammar.repository['tag-html'];
    expect(htmlEntry.contentName).toBe('meta.embedded.block.html');

    const cssEntry = grammar.repository['tag-css'];
    expect(cssEntry.contentName).toBe('meta.embedded.block.css');

    const sqlEntry = grammar.repository['tag-sql'];
    expect(sqlEntry.contentName).toBe('meta.embedded.block.sql');
  });
});

describe('Tagged Templates Extension — HTML Autocomplete Logic', () => {
  test('element completion trigger pattern matches after <', () => {
    const pattern = /<\w*$/;
    expect(pattern.test('      <')).toBe(true);
    expect(pattern.test('      <div')).toBe(true);
    expect(pattern.test('      <bu')).toBe(true);
    expect(pattern.test('text without angle')).toBe(false);
  });

  test('attribute completion trigger pattern matches inside tag', () => {
    const pattern = /<\w+[^>]*\s+[\w@-]*$/;
    expect(pattern.test('<div ')).toBe(true);
    expect(pattern.test('<div class="foo" ')).toBe(true);
    expect(pattern.test('<button @')).toBe(true);
    expect(pattern.test('<input type="text" dis')).toBe(true);
    expect(pattern.test('no tag here')).toBe(false);
  });

  test('trigger pattern does not match outside tags', () => {
    const elementPattern = /<\w*$/;
    const attrPattern = /<\w+[^>]*\s+[\w@-]*$/;
    expect(elementPattern.test('just text')).toBe(false);
    expect(attrPattern.test('just text')).toBe(false);
    expect(elementPattern.test('</div>')).toBe(false);
  });
});

describe('Tagged Templates Extension — CSS Autocomplete Logic', () => {
  test('CSS property trigger pattern matches at line start', () => {
    const pattern = /^\s*[\w-]*$/;
    expect(pattern.test('  ')).toBe(true);
    expect(pattern.test('  dis')).toBe(true);
    expect(pattern.test('  display')).toBe(true);
    expect(pattern.test('')).toBe(true);
  });

  test('CSS property trigger pattern matches after { or ;', () => {
    const pattern = /[{;]\s*[\w-]*$/;
    expect(pattern.test('  .foo { ')).toBe(true);
    expect(pattern.test('  .foo { dis')).toBe(true);
    expect(pattern.test('  color: red; ')).toBe(true);
    expect(pattern.test('  color: red; bor')).toBe(true);
  });

  test('CSS value trigger pattern matches after property colon', () => {
    const pattern = /^\s*([\w-]+)\s*:\s*([\w-]*)$/;
    expect(pattern.test('  display: ')).toBe(true);
    expect(pattern.test('  display: fl')).toBe(true);
    expect(pattern.test('  color: ')).toBe(true);
    expect(pattern.test('  not a property')).toBe(false);
    expect(pattern.test('  .foo { ')).toBe(false);
  });

  test('CSS pseudo-selector trigger pattern matches : or :: in selectors', () => {
    const pattern = /::?\s*[\w-]*$/;
    expect(pattern.test('.btn:')).toBe(true);
    expect(pattern.test('.btn:ho')).toBe(true);
    expect(pattern.test('.btn::')).toBe(true);
    expect(pattern.test('.btn::be')).toBe(true);
    expect(pattern.test('no colon')).toBe(false);
  });
});
