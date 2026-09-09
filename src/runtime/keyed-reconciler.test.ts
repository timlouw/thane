import { describe, expect, test } from 'bun:test';
import { createKeyedReconciler } from './dom-binding.js';

/**
 * A minimal DOM stand-in: enough of Node/Element for the keyed reconciler, which only
 * inserts, removes and walks siblings.
 */
class FakeNode {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  removals = 0;
  constructor(public readonly name: string) {}

  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get nextElementSibling(): FakeNode | null {
    return this.nextSibling;
  }
  get previousElementSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }
  get firstElementChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  set textContent(_value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
  }
  appendChild(child: FakeNode): FakeNode {
    return this.insertBefore(child, null);
  }
  insertBefore(child: FakeNode, ref: FakeNode | null): FakeNode {
    child.remove();
    child.parentNode = this;
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at === -1) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    return child;
  }
  remove(): void {
    if (!this.parentNode) return;
    this.removals++;
    const siblings = this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
}

interface Row {
  id: number;
  label: string;
}

const setup = () => {
  const table = new FakeNode('table');
  const tbody = new FakeNode('tbody');
  const anchor = new FakeNode('anchor');
  table.appendChild(tbody);
  tbody.appendChild(anchor);

  const created: Row[] = [];
  const updated: Row[] = [];
  const reconciler = createKeyedReconciler<Row>(
    tbody as unknown as ParentNode & Element,
    anchor as unknown as Element,
    (item, _index, refNode) => {
      created.push(item);
      const el = new FakeNode(`row:${item.id}`);
      tbody.insertBefore(el, refNode as unknown as FakeNode);
      return {
        el: el as unknown as Element,
        cleanups: [],
        value: item,
        update: (next: Row) => {
          updated.push(next);
        },
      };
    },
    'id',
  );

  const order = () => tbody.childNodes.map((n) => n.name);
  return { table, tbody, anchor, reconciler, created, updated, order };
};

/** Like setup(), but with a counting key function so tests can see how often keys are derived. */
const setupCountingKeys = () => {
  const tbody = new FakeNode('tbody');
  const anchor = new FakeNode('anchor');
  tbody.appendChild(anchor);
  let keyCalls = 0;
  const updated: Row[] = [];
  const reconciler = createKeyedReconciler<Row>(
    tbody as unknown as ParentNode & Element,
    anchor as unknown as Element,
    (item, _index, refNode) => {
      const el = new FakeNode(`row:${item.id}`);
      tbody.insertBefore(el, refNode as unknown as FakeNode);
      return { el: el as unknown as Element, cleanups: [], value: item, update: (next: Row) => updated.push(next) };
    },
    (item) => {
      keyCalls++;
      return item.id;
    },
  );
  const order = () => tbody.childNodes.map((n) => n.name);
  return { reconciler, updated, order, keyCalls: () => keyCalls, resetKeyCalls: () => (keyCalls = 0) };
};

const rows = (...ids: number[]): Row[] => ids.map((id) => ({ id, label: `row ${id}` }));

describe('createKeyedReconciler — append fast path', () => {
  test('appending creates only the new rows, in order, before the anchor', () => {
    const { reconciler, created, updated, order } = setup();
    const first = rows(1, 2, 3);
    reconciler.reconcile(first);
    expect(created.map((r) => r.id)).toEqual([1, 2, 3]);

    reconciler.reconcile([...first, ...rows(4, 5)]);
    expect(created.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(updated).toEqual([]);
    expect(order()).toEqual(['row:1', 'row:2', 'row:3', 'row:4', 'row:5', 'anchor']);
  });

  test('changed objects in the retained prefix are updated, unchanged ones are not', () => {
    const { reconciler, updated, order } = setup();
    const first = rows(1, 2, 3);
    reconciler.reconcile(first);

    const changedSecond = { id: 2, label: 'row 2 (edited)' };
    reconciler.reconcile([first[0]!, changedSecond, first[2]!, ...rows(4)]);
    expect(updated).toEqual([changedSecond]);
    expect(order()).toEqual(['row:1', 'row:2', 'row:3', 'row:4', 'anchor']);
  });

  test('the container stays attached while rows are appended to a non-empty list', () => {
    const { table, tbody, reconciler } = setup();
    reconciler.reconcile(rows(1, 2));
    // The initial fill detaches the container once so the browser skips per-insert style work
    expect(tbody.removals).toBe(1);
    expect(tbody.parentNode).toBe(table);

    reconciler.reconcile(rows(1, 2, 3, 4));
    expect(tbody.removals).toBe(1);
    expect(tbody.parentNode).toBe(table);
  });

  test('growth that is not a pure append still reconciles correctly', () => {
    const { reconciler, created, order } = setup();
    reconciler.reconcile(rows(2, 3));
    // Prepend: the first key differs, so the general path handles it
    reconciler.reconcile(rows(1, 2, 3, 4));
    expect(created.map((r) => r.id)).toEqual([2, 3, 1, 4]);
    expect(order()).toEqual(['row:1', 'row:2', 'row:3', 'row:4', 'anchor']);
  });

  test('get() resolves rows by key and forgets removed ones', () => {
    const { reconciler } = setup();
    reconciler.reconcile(rows(1, 2, 3));
    expect((reconciler.get(2)!.el as unknown as FakeNode).name).toBe('row:2');
    reconciler.reconcile(rows(1, 3));
    expect(reconciler.get(2)).toBeUndefined();
    reconciler.clearAll();
    expect(reconciler.get(1)).toBeUndefined();
  });
});

describe('in-place updates with unchanged keys and order', () => {
  test('updates only the rows whose item changed and derives keys only for those', () => {
    const { reconciler, updated, order, keyCalls, resetKeyCalls } = setupCountingKeys();
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, label: `r${i + 1}` }));
    reconciler.reconcile(rows);
    resetKeyCalls();

    const next = rows.map((row, i) => (i % 10 === 0 ? { ...row, label: row.label + '!' } : row));
    reconciler.reconcile(next);

    expect(updated.map((r) => r.id)).toEqual([1, 11, 21, 31, 41, 51, 61, 71, 81, 91]);
    expect(keyCalls()).toBe(10);
    expect(order()).toEqual([...rows.map((r) => `row:${r.id}`), 'anchor']);
  });

  test('an identical array is a no-op without deriving any key', () => {
    const { reconciler, updated, keyCalls, resetKeyCalls } = setupCountingKeys();
    const rows = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ];
    reconciler.reconcile(rows);
    resetKeyCalls();
    reconciler.reconcile([...rows]);
    expect(updated).toEqual([]);
    expect(keyCalls()).toBe(0);
  });

  test('a moved row hands over to the keyed path and the DOM order follows', () => {
    const { reconciler, updated, order } = setupCountingKeys();
    const a = { id: 1, label: 'a' },
      b = { id: 2, label: 'b' },
      c = { id: 3, label: 'c' };
    reconciler.reconcile([a, b, c]);
    const c2 = { ...c, label: 'c2' };
    reconciler.reconcile([a, c2, b]);
    expect(order()).toEqual(['row:1', 'row:3', 'row:2', 'anchor']);
    expect(updated).toEqual([c2]);
  });

  test('an updated row followed by a swap updates each changed row exactly once', () => {
    const { reconciler, updated, order } = setupCountingKeys();
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, label: `r${i + 1}` }));
    reconciler.reconcile(rows);
    const next = [...rows];
    next[0] = { ...rows[0]!, label: 'first!' };
    [next[2], next[4]] = [next[4]!, next[2]!];
    reconciler.reconcile(next);
    expect(updated).toEqual([next[0]!]);
    expect(order()).toEqual(['row:1', 'row:2', 'row:5', 'row:4', 'row:3', 'row:6', 'anchor']);
  });
});
