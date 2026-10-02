/**
 * Characterisation of `bindConditional` through `__bindIf` / `__bindIfExpr`.
 *
 * A `when()` / `when()` branch sits between two comment anchors, with any number of root nodes.
 * The fake DOM below has just what the binding touches: nodes with siblings, fragments, `insertBefore`
 * and `remove`, and a `<template>` whose `innerHTML` is a space-separated list of node names (each
 * set creates fresh nodes, as parsing does). An operation log records the order of insertion,
 * removal, nested initialisation and cleanup. On hide the nodes go first, then the cleanups run.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { __bindIf, __bindIfExpr } from './internal.js';
import { batch, signal } from './signal.js';

/** Every insertion, removal, initialisation and cleanup, in the order they happen. */
let ops: string[] = [];

class FakeNode {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  constructor(public name: string) {}

  get nextSibling(): FakeNode | null {
    const list = this.parentNode?.childNodes;
    return list?.[list.indexOf(this) + 1] ?? null;
  }

  appendChild(child: FakeNode): FakeNode {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode {
    // Duck-typed: the runtime caches one parsing <template>, which may come from another test file
    const isFragment = node.name === '#fragment';
    const nodes = isFragment ? [...node.childNodes] : [node];
    ops.push(`insert ${nodes.map((n) => n.name).join('+') || '(nothing)'}`);
    for (const n of nodes) {
      const at = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
      this.childNodes.splice(at, 0, n);
      n.parentNode = this;
    }
    if (isFragment) node.childNodes = [];
    return node;
  }

  remove(): void {
    if (!this.parentNode) return;
    ops.push(`remove ${this.name}`);
    const list = this.parentNode.childNodes;
    list.splice(list.indexOf(this), 1);
    this.parentNode = null;
  }
}

class FakeFragment extends FakeNode {
  constructor() {
    super('#fragment');
  }
}

/** `innerHTML` is a space-separated list of node names: `'b i'` is a branch with two roots. */
class FakeTemplateElement extends FakeNode {
  content = new FakeFragment();
  constructor() {
    super('template');
  }
  set innerHTML(value: string) {
    this.content = new FakeFragment();
    for (const name of value.split(' ').filter(Boolean)) this.content.appendChild(new FakeNode(name));
  }
}

let originalDocument: unknown;
beforeEach(() => {
  ops = [];
  originalDocument = (globalThis as any).document;
  (globalThis as any).document = {
    createElement: (tagName: string) =>
      tagName.toLowerCase() === 'template' ? new FakeTemplateElement() : new FakeNode(tagName),
  };
});
afterEach(() => {
  (globalThis as any).document = originalDocument;
});

const TEMPLATE = 'div';

/**
 * A component root holding a static node before the directive, the directive's two anchors, the
 * pre-rendered content between them (`shown` names its root nodes), and a static node after.
 */
const setup = (shown: string[] = []) => {
  const root = new FakeNode('section');
  root.appendChild(new FakeNode('before'));
  const start = root.appendChild(new FakeNode('start'));
  const pre = shown.map((name) => root.appendChild(new FakeNode(name)));
  const end = root.appendChild(new FakeNode('end'));
  root.appendChild(new FakeNode('after'));
  let inits = 0;
  let cleanups = 0;
  const initNested = (first: Node) => {
    const n = ++inits;
    ops.push(`init ${n} on ${(first as unknown as FakeNode).name}`);
    const cleanup = (suffix: string) => () => {
      ops.push(`cleanup ${n}${suffix}`);
      cleanups++;
    };
    return [cleanup('a'), cleanup('b')];
  };
  /** The names between the anchors */
  const range = () => {
    const names: string[] = [];
    for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) names.push(n.name);
    return names;
  };
  const at = { start: start as unknown as Node, end: end as unknown as Node };
  return { root, start, end, pre, at, initNested, range, inits: () => inits, cleanups: () => cleanups };
};

describe('__bindIf: initial state', () => {
  test('nothing between the anchors, false condition: nothing is initialised and the DOM is untouched', () => {
    const { at, initNested, inits, range } = setup();
    __bindIf(at.start, at.end, signal(false), TEMPLATE, initNested);
    expect(inits()).toBe(0);
    expect(range()).toEqual([]);
    expect(ops).toEqual([]);
  });

  test('nothing between the anchors, true condition: the content is inserted and initialised once while binding', () => {
    const { at, initNested, range } = setup();
    __bindIf(at.start, at.end, signal(true), TEMPLATE, initNested);
    expect(ops).toEqual(['insert div', 'init 1 on div']);
    expect(range()).toEqual(['div']);
  });

  test('pre-rendered content, true condition: the content is initialised in place, once', () => {
    const { at, initNested, range, pre } = setup(['div']);
    __bindIf(at.start, at.end, signal(true), TEMPLATE, initNested);
    expect(ops).toEqual(['init 1 on div']);
    expect(range()).toEqual(['div']);
    expect(pre[0]!.parentNode).not.toBeNull();
  });

  test('pre-rendered content, false condition: initialised, then removed and cleaned up while binding', () => {
    const { at, initNested, range } = setup(['div']);
    __bindIf(at.start, at.end, signal(false), TEMPLATE, initNested);
    expect(ops).toEqual(['init 1 on div', 'remove div', 'cleanup 1a', 'cleanup 1b']);
    expect(range()).toEqual([]);
  });

  test('the condition is the truthiness of the signal value', () => {
    for (const [value, shown] of [
      [0, false],
      ['', false],
      [null, false],
      [undefined, false],
      [NaN, false],
      [1, true],
      ['no', true],
      [{}, true],
      [[], true],
    ] as const) {
      const { at, initNested, range } = setup();
      __bindIf(at.start, at.end, signal<unknown>(value), TEMPLATE, initNested);
      expect([value, range()]).toEqual([value, shown ? ['div'] : []]);
    }
  });
});

describe('__bindIf: toggling', () => {
  test('show → hide → show: fresh nodes each time, initNested once per show, cleanups once per hide', () => {
    const { root, at, initNested, range, inits, cleanups } = setup();
    const show = signal(false);
    __bindIf(at.start, at.end, show, TEMPLATE, initNested);

    show(true);
    const first = at.start.nextSibling;
    show(false);
    expect(range()).toEqual([]);
    show(true);
    const second = at.start.nextSibling;

    expect(ops).toEqual([
      'insert div',
      'init 1 on div',
      'remove div',
      'cleanup 1a',
      'cleanup 1b',
      'insert div',
      'init 2 on div',
    ]);
    expect(inits()).toBe(2);
    expect(cleanups()).toBe(2);
    expect(second).not.toBe(first);
    // The nodes around the directive are left alone
    expect(root.childNodes.map((n) => n.name)).toEqual(['before', 'start', 'div', 'end', 'after']);
  });

  test('the node handed to initNested is the first node placed between the anchors', () => {
    const { at } = setup();
    const show = signal(false);
    const seen: unknown[] = [];
    __bindIf(at.start, at.end, show, TEMPLATE, (first) => {
      seen.push(first);
      return [];
    });
    show(true);
    expect(seen).toEqual([at.start.nextSibling]);
  });

  test('a change that keeps the truthiness does nothing', () => {
    const { at, initNested } = setup();
    const show = signal<number>(0);
    __bindIf(at.start, at.end, show, TEMPLATE, initNested);
    show(1);
    show(2);
    show(3);
    expect(ops).toEqual(['insert div', 'init 1 on div']);
  });

  test('toggled on and back off inside a batch: one notification, no DOM change', () => {
    const { at, initNested, range } = setup();
    const show = signal(false);
    __bindIf(at.start, at.end, show, TEMPLATE, initNested);
    batch(() => {
      show(true);
      show(false);
    });
    expect(ops).toEqual([]);
    expect(range()).toEqual([]);
  });

  test('content with several roots is inserted and removed whole', () => {
    const { at, initNested, range } = setup();
    const show = signal(false);
    __bindIf(at.start, at.end, show, 'b i', initNested);
    show(true);
    expect(range()).toEqual(['b', 'i']);
    show(false);
    expect(range()).toEqual([]);
    expect(ops).toEqual(['insert b+i', 'init 1 on b', 'remove b', 'remove i', 'cleanup 1a', 'cleanup 1b']);
  });

  test('text-only content that starts hidden is inserted like any other', () => {
    const { at, initNested, range } = setup();
    const show = signal(false);
    __bindIf(at.start, at.end, show, '#text', initNested);
    show(true);
    expect(range()).toEqual(['#text']);
    show(false);
    show(true);
    expect(ops).toEqual([
      'insert #text',
      'init 1 on #text',
      'remove #text',
      'cleanup 1a',
      'cleanup 1b',
      'insert #text',
      'init 2 on #text',
    ]);
  });

  test('hiding removes everything between the anchors, also nodes added after the content was shown', () => {
    const { root, at, initNested, range } = setup();
    const show = signal(true);
    __bindIf(at.start, at.end, show, 'ul', initNested);
    // A list at the branch's top level puts its rows between the anchors
    root.insertBefore(new FakeNode('row1'), at.end as unknown as FakeNode);
    root.insertBefore(new FakeNode('row2'), at.end as unknown as FakeNode);
    ops = [];
    show(false);
    expect(range()).toEqual([]);
    expect(ops).toEqual(['remove ul', 'remove row1', 'remove row2', 'cleanup 1a', 'cleanup 1b']);
  });

  test('empty content: nothing is inserted, and showing again is not a second show', () => {
    const { at, initNested, range } = setup();
    const show = signal(false);
    __bindIf(at.start, at.end, show, '', initNested);
    show(true);
    show(true);
    expect(range()).toEqual([]);
    expect(ops).toEqual(['insert (nothing)', 'init 1 on end']);
  });
});

describe('__bindIf: dispose', () => {
  test('dispose while shown: runs the current cleanups and leaves the content in place', () => {
    const { at, initNested, range } = setup();
    const show = signal(true);
    const dispose = __bindIf(at.start, at.end, show, TEMPLATE, initNested);
    ops = [];
    dispose();
    expect(ops).toEqual(['cleanup 1a', 'cleanup 1b']);
    expect(range()).toEqual(['div']);

    show(false);
    show(true);
    expect(ops).toEqual(['cleanup 1a', 'cleanup 1b']);
  });

  test('dispose while shown unsubscribes before the cleanups run', () => {
    const { at, range } = setup();
    const show = signal(true);
    const dispose = __bindIf(at.start, at.end, show, TEMPLATE, () => [() => show(false)]);
    dispose();
    // The cleanup's write reaches no subscriber: the content stays
    expect(range()).toEqual(['div']);
  });

  test('dispose while hidden: nothing runs, and later changes are ignored', () => {
    const { at, initNested, range } = setup();
    const show = signal(false);
    const dispose = __bindIf(at.start, at.end, show, TEMPLATE, initNested);
    show(true);
    show(false);
    ops = [];
    dispose();
    expect(ops).toEqual([]);
    show(true);
    expect(ops).toEqual([]);
    expect(range()).toEqual([]);
  });

  test('a second dispose runs nothing', () => {
    const { at, initNested } = setup();
    const show = signal(true);
    const dispose = __bindIf(at.start, at.end, show, TEMPLATE, initNested);
    dispose();
    ops = [];
    dispose();
    expect(ops).toEqual([]);
  });

  test('the anchors stay after a hide, so a later binding over them starts from the empty range', () => {
    const { at, initNested } = setup(['div']);
    const show = signal(true);
    const dispose = __bindIf(at.start, at.end, show, TEMPLATE, initNested);
    show(false);
    dispose();
    ops = [];
    __bindIf(at.start, at.end, signal(true), TEMPLATE, initNested);
    expect(ops).toEqual(['insert div', 'init 2 on div']);
  });
});

describe('__bindIfExpr', () => {
  test('subscribes to every listed signal and re-evaluates the expression on each change', () => {
    const { at, initNested, range } = setup();
    const a = signal(1);
    const b = signal(1);
    let evaluations = 0;
    __bindIfExpr(
      at.start,
      at.end,
      [a, b],
      () => {
        evaluations++;
        return a() + b() > 3;
      },
      TEMPLATE,
      initNested,
    );
    expect(evaluations).toBe(1);
    a(2);
    expect(range()).toEqual([]);
    b(2);
    expect(range()).toEqual(['div']);
    a(0);
    expect(range()).toEqual([]);
    expect(evaluations).toBe(4);
    expect(ops).toEqual(['insert div', 'init 1 on div', 'remove div', 'cleanup 1a', 'cleanup 1b']);
  });

  test('a batch that changes two listed signals evaluates once per notified signal', () => {
    const { at, initNested } = setup();
    const a = signal(0);
    const b = signal(0);
    let evaluations = 0;
    __bindIfExpr(
      at.start,
      at.end,
      [a, b],
      () => {
        evaluations++;
        return a() + b() === 2;
      },
      TEMPLATE,
      initNested,
    );
    evaluations = 0;
    batch(() => {
      a(1);
      b(1);
    });
    expect(evaluations).toBe(2);
    expect(ops).toEqual(['insert div', 'init 1 on div']);
  });

  test('a signal the expression reads but that is not listed does not trigger an update', () => {
    const { at, initNested, range } = setup();
    const listed = signal(0);
    const unlisted = signal(false);
    __bindIfExpr(at.start, at.end, [listed], () => unlisted(), TEMPLATE, initNested);
    unlisted(true);
    expect(range()).toEqual([]);
    listed(1);
    expect(range()).toEqual(['div']);
  });

  test('the expression result is used for its truthiness', () => {
    const { at, initNested, range } = setup();
    const s = signal<unknown>('');
    __bindIfExpr(at.start, at.end, [s], () => s() as boolean, TEMPLATE, initNested);
    expect(range()).toEqual([]);
    s('x');
    expect(range()).toEqual(['div']);
  });

  test('dispose unsubscribes from every listed signal', () => {
    const { at, initNested } = setup();
    const a = signal(false);
    const b = signal(false);
    const dispose = __bindIfExpr(at.start, at.end, [a, b], () => a() || b(), TEMPLATE, initNested);
    dispose();
    a(true);
    b(true);
    expect(ops).toEqual([]);
  });

  test('two branches share the middle anchor of a when(): each changes only its own range', () => {
    const root = new FakeNode('section');
    const start = root.appendChild(new FakeNode('start'));
    const middle = root.appendChild(new FakeNode('middle'));
    const end = root.appendChild(new FakeNode('end'));
    const on = signal(true);
    const init = (name: string) => (first: Node) => {
      ops.push(`init ${name} on ${(first as unknown as FakeNode).name}`);
      return [() => ops.push(`cleanup ${name}`)];
    };
    const [s, m, e] = [start, middle, end] as unknown as Node[];
    __bindIfExpr(s!, m!, [on], () => on(), 'then', init('then'));
    __bindIfExpr(m!, e!, [on], () => !on(), 'else1 else2', init('else'));
    expect(root.childNodes.map((n) => n.name)).toEqual(['start', 'then', 'middle', 'end']);
    on(false);
    expect(root.childNodes.map((n) => n.name)).toEqual(['start', 'middle', 'else1', 'else2', 'end']);
    on(true);
    expect(root.childNodes.map((n) => n.name)).toEqual(['start', 'then', 'middle', 'end']);
    expect(ops).toEqual([
      'insert then',
      'init then on then',
      'remove then',
      'cleanup then',
      'insert else1+else2',
      'init else on else1',
      'insert then',
      'init then on then',
      'remove else1',
      'remove else2',
      'cleanup else',
    ]);
  });
});
