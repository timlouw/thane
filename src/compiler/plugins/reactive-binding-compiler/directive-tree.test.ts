import { describe, expect, test } from 'bun:test';
import { walkDirectives } from './directive-tree.js';
import { processHtmlTemplateWithConditionals } from './template-processing.js';
import type { ConditionalBlock, RepeatBlock, WhenElseBlock } from './types.js';

// Minimal blocks: the walk reads only the child lists; the name identifies the block in the log.
type Children = { c?: ConditionalBlock[]; w?: WhenElseBlock[]; r?: RepeatBlock[] };

const cond = (name: string, children: Children = {}): ConditionalBlock =>
  ({
    id: name,
    nestedConditionals: children.c ?? [],
    nestedWhenElse: children.w ?? [],
    nestedRepeats: children.r ?? [],
  }) as unknown as ConditionalBlock;

const whenElse = (name: string, then: Children = {}, otherwise: Children = {}): WhenElseBlock =>
  ({
    thenId: name,
    thenConditionals: then.c ?? [],
    thenWhenElse: then.w ?? [],
    thenRepeats: then.r ?? [],
    elseConditionals: otherwise.c ?? [],
    elseWhenElse: otherwise.w ?? [],
    elseRepeats: otherwise.r ?? [],
  }) as unknown as WhenElseBlock;

const repeat = (name: string, children: Children = {}): RepeatBlock =>
  ({
    id: name,
    nestedConditionals: children.c ?? [],
    nestedWhenElse: children.w ?? [],
    nestedRepeats: children.r ?? [],
  }) as unknown as RepeatBlock;

const logAll = (roots: Parameters<typeof walkDirectives>[0]): string[] => {
  const log: string[] = [];
  walkDirectives(roots, {
    cond: (b) => void log.push(`cond ${b.id}`),
    whenElse: (b) => void log.push(`whenElse ${b.thenId}`),
    repeat: (b) => void log.push(`repeat ${b.id}`),
  });
  return log;
};

describe('walkDirectives', () => {
  test('no roots, or empty roots: nothing is visited', () => {
    expect(logAll({})).toEqual([]);
    expect(logAll({ conditionals: [], whenElse: [], repeats: [] })).toEqual([]);
  });

  test('at each level: conditionals, then whenElse blocks, then repeats, each in array order', () => {
    expect(
      logAll({
        repeats: [repeat('r1'), repeat('r2')],
        whenElse: [whenElse('w1'), whenElse('w2')],
        conditionals: [cond('c1'), cond('c2')],
      }),
    ).toEqual(['cond c1', 'cond c2', 'whenElse w1', 'whenElse w2', 'repeat r1', 'repeat r2']);
  });

  test('pre-order: a block is visited before its children, and its subtree before its next sibling', () => {
    const tree = {
      conditionals: [
        cond('c1', { c: [cond('c1.c')], w: [whenElse('c1.w')], r: [repeat('c1.r', { c: [cond('c1.r.c')] })] }),
        cond('c2'),
      ],
      repeats: [repeat('r1', { r: [repeat('r1.r')], w: [whenElse('r1.w')], c: [cond('r1.c')] })],
    };
    expect(logAll(tree)).toEqual([
      'cond c1',
      'cond c1.c',
      'whenElse c1.w',
      'repeat c1.r',
      'cond c1.r.c',
      'cond c2',
      'repeat r1',
      'cond r1.c',
      'whenElse r1.w',
      'repeat r1.r',
    ]);
  });

  test('whenElse children: then and else conditionals, then and else whenElse, then and else repeats', () => {
    const we = whenElse(
      'w',
      { c: [cond('then.c')], w: [whenElse('then.w')], r: [repeat('then.r')] },
      { c: [cond('else.c')], w: [whenElse('else.w')], r: [repeat('else.r')] },
    );
    expect(logAll({ whenElse: [we] })).toEqual([
      'whenElse w',
      'cond then.c',
      'cond else.c',
      'whenElse then.w',
      'whenElse else.w',
      'repeat then.r',
      'repeat else.r',
    ]);
  });

  test('a visitor returning false skips that block’s subtree, and only that', () => {
    const tree = {
      conditionals: [
        cond('skip', { c: [cond('hidden')], r: [repeat('hidden-r')] }),
        cond('next', { c: [cond('seen')] }),
      ],
      whenElse: [whenElse('w-skip', { c: [cond('hidden-then')] }, { r: [repeat('hidden-else')] })],
      repeats: [repeat('r-skip', { c: [cond('hidden-row')] }), repeat('r-next', { r: [repeat('seen-r')] })],
    };
    const log: string[] = [];
    walkDirectives(tree, {
      cond: (b) => {
        log.push(`cond ${b.id}`);
        return b.id !== 'skip';
      },
      whenElse: (b) => {
        log.push(`whenElse ${b.thenId}`);
        return false;
      },
      repeat: (b) => {
        log.push(`repeat ${b.id}`);
        if (b.id === 'r-skip') return false;
        return undefined;
      },
    });
    expect(log).toEqual([
      'cond skip',
      'cond next',
      'cond seen',
      'whenElse w-skip',
      'repeat r-skip',
      'repeat r-next',
      'repeat seen-r',
    ]);
  });

  test('a missing visitor still descends into that kind of block', () => {
    const log: string[] = [];
    walkDirectives(
      { whenElse: [whenElse('w', { r: [repeat('r', { c: [cond('c')] })] })] },
      { cond: (b) => void log.push(`cond ${b.id}`) },
    );
    expect(log).toEqual(['cond c']);
  });

  test('walks the blocks template processing produces', () => {
    // (the row's when() is on an inner element: on the row's root it is a build error, THANE008)
    const result = processHtmlTemplateWithConditionals(
      '<div ${when(a())}>${repeat(items(), (it) => html`<li><b ${when(it.on)}>${it.name}</b></li>`)}</div>' +
        '${when(b(), html`<p ${when(c())}>t</p>`, html`<p>e</p>`)}',
      new Map<string, string | number | boolean>([
        ['a', true],
        ['b', true],
        ['c', true],
      ]),
      0,
    );
    const kinds: string[] = [];
    walkDirectives(
      { conditionals: result.conditionals, whenElse: result.whenElseBlocks, repeats: result.repeatBlocks },
      {
        cond: (b) => void kinds.push(`when ${b.jsExpression}`),
        whenElse: (b) => void kinds.push(`whenElse ${b.jsExpression}`),
        repeat: (b) => void kinds.push(`repeat ${b.itemsExpression}`),
      },
    );
    expect(kinds).toEqual(['when a()', 'repeat items()', 'when it$().on', 'whenElse b()', 'when c()']);
  });
});
