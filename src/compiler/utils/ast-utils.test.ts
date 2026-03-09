import { describe, expect, test } from 'bun:test';
import { renameIdentifierInExpression } from './ast-utils.js';

describe('renameIdentifierInExpression', () => {
  test('preserves explicit object property keys while renaming values', () => {
    const input = '{ product: product, nested: product.id }';
    const out = renameIdentifierInExpression(input, 'product', 'item');

    expect(out).toContain('product: item');
    expect(out).toContain('nested: item.id');
    expect(out).not.toContain('item: item');
  });

  test('expands shorthand properties to preserve original key name', () => {
    const input = '{ product, count: product.count }';
    const out = renameIdentifierInExpression(input, 'product', 'item');

    expect(out).toContain('product: item');
    expect(out).toContain('count: item.count');
    expect(out).not.toContain('{ item');
  });

  test('supports expression replacements (not only identifiers)', () => {
    const input = '{ product }';
    const out = renameIdentifierInExpression(input, 'product', 'product$()');

    expect(out).toContain('product: product$()');
  });

  test('does not rename property-access names', () => {
    const input = 'obj.product + product';
    const out = renameIdentifierInExpression(input, 'product', 'item');

    expect(out).toContain('obj.product');
    expect(out).toContain('+ item');
  });
});
