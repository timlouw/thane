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
  /** Set on clones so a test can tell them from the template */
  clonedFrom: FakeNode | null = null;
  constructor(public readonly name: string) {}

  get ownerDocument(): { createDocumentFragment: () => FakeNode } {
    return { createDocumentFragment: () => new FakeNode('#fragment') };
  }
  cloneNode(deep: boolean): FakeNode {
    const copy = new FakeNode(this.name);
    copy.clonedFrom = this;
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }

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
    if (child.name === '#fragment') {
      // A fragment's children move into the parent, as in the DOM
      for (const node of [...child.childNodes]) this.insertBefore(node, ref);
      return child;
    }
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

describe('batch row creation', () => {
  const setupBatch = (size: number) => {
    const tbody = new FakeNode('tbody');
    const anchor = new FakeNode('anchor');
    tbody.appendChild(anchor);
    const template = new FakeNode('tr');
    template.appendChild(new FakeNode('td'));
    const bound: Array<{ el: FakeNode; item: Row; index: number }> = [];
    const singles: Row[] = [];
    const reconciler = createKeyedReconciler<Row>(
      tbody as unknown as ParentNode & Element,
      anchor as unknown as Element,
      (item, _index, refNode) => {
        singles.push(item);
        const el = template.cloneNode(true);
        tbody.insertBefore(el, refNode as unknown as FakeNode);
        return { el: el as unknown as Element, cleanups: [], value: item, update: () => {} };
      },
      'id',
      {
        size,
        row: template as unknown as Node,
        bind: (el, item, index) => {
          bound.push({ el: el as unknown as FakeNode, item, index });
          return { el, cleanups: [], value: item, update: () => {} };
        },
      },
    );
    const order = () => tbody.childNodes.map((n) => n.name);
    return { tbody, anchor, template, reconciler, bound, singles, order };
  };
  const rows = (from: number, to: number): Row[] =>
    Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i, label: `r${from + i}` }));

  test('creates whole batches through bind and the remainder through the single-row factory', () => {
    const { reconciler, bound, singles, order, anchor, tbody } = setupBatch(4);
    reconciler.reconcile(rows(1, 10));
    // Two batches of four, then two single rows, all before the anchor
    expect(bound.map((b) => b.item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bound.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(singles.map((r) => r.id)).toEqual([9, 10]);
    expect(order()).toEqual([...Array(10).fill('tr'), 'anchor']);
    expect(tbody.childNodes[tbody.childNodes.length - 1]).toBe(anchor);
    // Every bound row is its own clone carrying the template's children
    expect(new Set(bound.map((b) => b.el)).size).toBe(8);
    for (const b of bound) expect(b.el.childNodes.map((n) => n.name)).toEqual(['td']);
    // Rows are registered by key in creation order
    expect(reconciler.get(6)!.el).toBe(bound[5]!.el as unknown as Element);
  });

  test('a list shorter than one batch uses only the single-row factory', () => {
    const { reconciler, bound, singles } = setupBatch(4);
    reconciler.reconcile(rows(1, 3));
    expect(bound).toEqual([]);
    expect(singles.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  test('appending reuses the batch path for the new rows and keeps existing rows', () => {
    const { reconciler, bound, singles, order } = setupBatch(4);
    reconciler.reconcile(rows(1, 5));
    bound.length = 0;
    singles.length = 0;
    reconciler.reconcile(rows(1, 14));
    // Nine new rows: two batches, one single
    expect(bound.map((b) => b.item.id)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
    expect(bound.map((b) => b.index)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(singles.map((r) => r.id)).toEqual([14]);
    expect(order()).toEqual([...Array(14).fill('tr'), 'anchor']);
    expect(reconciler.get(1)).toBeDefined();
    expect(reconciler.get(14)).toBeDefined();
  });

  test('clearing and recreating clones from the cached batch fragment', () => {
    const { reconciler, bound, order, template } = setupBatch(4);
    reconciler.reconcile(rows(1, 8));
    reconciler.reconcile([]);
    expect(order()).toEqual(['anchor']);
    bound.length = 0;
    reconciler.reconcile(rows(20, 27));
    expect(bound.map((b) => b.item.id)).toEqual([20, 21, 22, 23, 24, 25, 26, 27]);
    // Clones of clones: the batch fragment was built from the template once
    expect(bound.every((b) => b.el.clonedFrom !== template)).toBe(true);
    expect(order()).toEqual([...Array(8).fill('tr'), 'anchor']);
  });
});

describe('shared update function for lean rows', () => {
  test('is called with the record, the new item and the current index, after value is updated', () => {
    const tbody = new FakeNode('tbody');
    const anchor = new FakeNode('anchor');
    tbody.appendChild(anchor);
    const template = new FakeNode('tr');
    const calls: Array<{ id: number; index: number; valueId: number; p0: string }> = [];
    const reconciler = createKeyedReconciler<Row>(
      tbody as unknown as ParentNode & Element,
      anchor as unknown as Element,
      (item, _index, refNode) => {
        const el = template.cloneNode(true);
        tbody.insertBefore(el, refNode as unknown as FakeNode);
        return { el: el as unknown as Element, cleanups: [], value: item, p0: item.label } as never;
      },
      'id',
      {
        size: 100,
        row: template as unknown as Node,
        bind: (el, item) => ({ el, cleanups: [], value: item, p0: item.label }) as never,
        update: (managed, item, index) => {
          const record = managed as unknown as { value: Row; p0: string };
          calls.push({ id: item.id, index, valueId: record.value.id, p0: record.p0 });
          record.p0 = item.label;
        },
      },
    );
    const rows = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ];
    reconciler.reconcile(rows);
    reconciler.reconcile([rows[0]!, { id: 2, label: 'b2' }, rows[2]!]);
    expect(calls).toEqual([{ id: 2, index: 1, valueId: 2, p0: 'b' }]);
    // Records have no per-row update closure
    expect((reconciler.get(2) as unknown as { update?: unknown }).update).toBeUndefined();
    // Append path also updates changed existing rows through the shared function
    reconciler.reconcile([rows[0]!, { id: 2, label: 'b3' }, rows[2]!, { id: 4, label: 'd' }]);
    expect(calls[1]).toEqual({ id: 2, index: 1, valueId: 2, p0: 'b2' });
  });
});
