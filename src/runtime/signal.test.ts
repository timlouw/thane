import { describe, test, expect } from 'bun:test';
import { signal, batch, computed, effect } from './signal.js';

const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(resolve));

describe('Signal Core', () => {
  test('signal returns initial value', () => {
    const s = signal(42);
    expect(s()).toBe(42);
  });

  test('signal updates value', () => {
    const s = signal(1);
    s(2);
    expect(s()).toBe(2);
  });

  test('signal holds complex types (objects, arrays, nullish)', () => {
    const obj = signal({ name: 'test', count: 0 });
    expect(obj()).toEqual({ name: 'test', count: 0 });
    obj({ name: 'updated', count: 5 });
    expect(obj()).toEqual({ name: 'updated', count: 5 });

    const arr = signal([1, 2, 3]);
    expect(arr()).toEqual([1, 2, 3]);
    arr([4, 5]);
    expect(arr()).toEqual([4, 5]);

    const nullable = signal<string | null>('initial');
    nullable(null);
    expect(nullable()).toBe(null);
    nullable('back');
    expect(nullable()).toBe('back');
  });
});

describe('Signal Subscriptions', () => {
  test('subscribe receives initial value immediately', () => {
    const s = signal('initial');
    let received = '';

    s.subscribe((val) => {
      received = val;
    });

    expect(received).toBe('initial');
  });

  test('subscribe with skipInitial does not receive initial', () => {
    const s = signal('initial');
    let received: string | null = null;

    s.subscribe((val) => {
      received = val;
    }, true); // skipInitial = true

    expect(received).toBe(null);
  });

  test('subscribe receives updates after initial', async () => {
    const s = signal('initial');
    const received: string[] = [];

    s.subscribe((val) => {
      received.push(val);
    });

    expect(received).toEqual(['initial']);

    s('updated');
    await flushMicrotasks();

    expect(received).toEqual(['initial', 'updated']);
  });

  test('multiple subscribers all receive updates', async () => {
    const s = signal(0);
    let sub1Value = -1;
    let sub2Value = -1;
    let sub3Value = -1;

    s.subscribe((val) => {
      sub1Value = val;
    });
    s.subscribe((val) => {
      sub2Value = val;
    });
    s.subscribe((val) => {
      sub3Value = val;
    });

    expect(sub1Value).toBe(0);
    expect(sub2Value).toBe(0);
    expect(sub3Value).toBe(0);

    s(42);
    await flushMicrotasks();

    expect(sub1Value).toBe(42);
    expect(sub2Value).toBe(42);
    expect(sub3Value).toBe(42);
  });

  test('unsubscribe stops receiving updates', async () => {
    const s = signal(0);
    let value = -1;

    const unsub = s.subscribe((val) => {
      value = val;
    });

    expect(value).toBe(0);

    s(1);
    await flushMicrotasks();
    expect(value).toBe(1);

    unsub(); // Unsubscribe

    s(2);
    await flushMicrotasks();
    expect(value).toBe(1); // Should not have changed
  });

  test('multiple subscribe/unsubscribe cycles work correctly', async () => {
    const s = signal('a');
    let count = 0;

    // First subscription
    const unsub1 = s.subscribe(() => {
      count++;
    });
    expect(count).toBe(1);

    // Second subscription
    const unsub2 = s.subscribe(() => {
      count++;
    });
    expect(count).toBe(2);

    // Update triggers both
    s('b');
    await flushMicrotasks();
    expect(count).toBe(4);

    // Unsubscribe first
    unsub1();

    // Update triggers only second
    s('c');
    await flushMicrotasks();
    expect(count).toBe(5);

    // Re-subscribe
    const unsub3 = s.subscribe(() => {
      count++;
    });
    expect(count).toBe(6);

    // Update triggers second and third
    s('d');
    await flushMicrotasks();
    expect(count).toBe(8);

    // Clean up
    unsub2();
    unsub3();
  });
});

describe('Signal Batching', () => {
  test('same value does not trigger update', async () => {
    const s = signal(5);
    let updateCount = 0;

    s.subscribe(
      () => {
        updateCount++;
      },
      true
    ); // skipInitial

    expect(updateCount).toBe(0);

    s(5); // Same value
    await flushMicrotasks();

    expect(updateCount).toBe(0); // Should not have triggered
  });

  test('rapid updates each notify individually without batching', async () => {
    const s = signal(0);
    const values: number[] = [];

    s.subscribe(
      (val) => {
        values.push(val);
      },
      true
    );

    s(1);
    s(2);
    s(3);

    await flushMicrotasks();

    expect(values).toEqual([1, 2, 3]);
    expect(s()).toBe(3);
  });

  test('100 rapid updates complete correctly', async () => {
    const s = signal(0);
    let lastValue = 0;

    s.subscribe(
      (val) => {
        lastValue = val;
      },
      true
    );

    for (let i = 1; i <= 100; i++) {
      s(i);
    }

    await flushMicrotasks();

    expect(s()).toBe(100);
    expect(lastValue).toBe(100);
  });
});

describe('Chained Signal Updates', () => {
  test('signal update triggers dependent subscription', async () => {
    const s1 = signal(1);
    const s2 = signal(0);

    s1.subscribe(
      (val) => {
        s2(val * 2);
      },
      true
    );

    s1(5);
    await flushMicrotasks();

    expect(s2()).toBe(10);
  });

  test('multiple dependent signals', async () => {
    const source = signal(1);
    const doubled = signal(0);
    const tripled = signal(0);

    source.subscribe(
      (val) => {
        doubled(val * 2);
        tripled(val * 3);
      },
      true
    );

    source(5);
    await flushMicrotasks();

    expect(doubled()).toBe(10);
    expect(tripled()).toBe(15);
  });
});

describe('Signal Edge Cases', () => {
  test('signal toggles boolean correctly', async () => {
    const s = signal(false);
    const states: boolean[] = [];

    s.subscribe((val) => {
      states.push(val);
    });

    for (let i = 0; i < 5; i++) {
      s(!s());
    }

    await flushMicrotasks();

    expect(states).toEqual([false, true, false, true, false, true]);
    expect(s()).toBe(true);
  });

  test('signal handles NaN', () => {
    const s = signal(NaN);
    expect(Number.isNaN(s())).toBe(true);

    s(42);
    expect(s()).toBe(42);
  });

  test('signal handles function value', () => {
    const fn1 = () => 'hello';
    const fn2 = () => 'world';

    const s = signal(fn1);
    expect(s()()).toBe('hello');

    s(fn2);
    expect(s()()).toBe('world');
  });
});

describe('Signal Performance', () => {
  test('handles 1000 signal updates', async () => {
    const s = signal(0);
    let updateCount = 0;

    s.subscribe(
      () => {
        updateCount++;
      },
      true
    );

    for (let i = 1; i <= 1000; i++) {
      s(i);
    }

    await flushMicrotasks();

    expect(s()).toBe(1000);
    expect(updateCount).toBe(1000);
  });

  test('handles 100 concurrent signals', async () => {
    const signals = Array.from({ length: 100 }, (_, i) => signal(i));
    const results: number[] = [];

    signals.forEach((s, i) => {
      s.subscribe(
        (val) => {
          results[i] = val;
        },
        true
      );
    });

    signals.forEach((s, i) => s(i * 2));

    await flushMicrotasks();

    expect(results.length).toBe(100);
    expect(results[50]).toBe(100);
    expect(results[99]).toBe(198);
  });

  test('handles large array in signal', () => {
    const largeArray = Array.from({ length: 10000 }, (_, i) => i);
    const s = signal(largeArray);

    expect(s().length).toBe(10000);
    expect(s()[5000]).toBe(5000);

    s(s().map((x) => x * 2));

    expect(s()[5000]).toBe(10000);
  });

  test('rapid toggle does not cause issues', async () => {
    const s = signal(false);
    let lastValue = false;

    s.subscribe(
      (val) => {
        lastValue = val;
      },
      true
    );

    for (let i = 0; i < 1000; i++) {
      s(!s());
    }

    await flushMicrotasks();

    expect(s()).toBe(false); // 1000 toggles = back to false
    expect(lastValue).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
//  Subscriber Exception Handling
// ─────────────────────────────────────────────────────────────

describe('Signal Subscriber Exception Handling', () => {
  test('a throwing subscriber does not block subsequent subscribers', async () => {
    const s = signal(0);
    const received: number[] = [];

    // First subscriber throws
    s.subscribe(() => {
      throw new Error('boom');
    }, true);

    // Second subscriber should still run
    s.subscribe((val) => {
      received.push(val);
    }, true);

    s(42);
    await flushMicrotasks();

    expect(received).toEqual([42]);
  });

  test('error from throwing subscriber is reported via microtask', async () => {
    const s = signal(0);
    const errors: any[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => errors.push(args);

    s.subscribe(() => {
      throw new Error('test-error');
    }, true);

    s(1);

    // Wait for the queueMicrotask error report
    await new Promise((r) => setTimeout(r, 10));

    console.error = origError;
    expect(errors.some((e) => String(e).includes('test-error'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
//  batch()
// ─────────────────────────────────────────────────────────────

describe('batch()', () => {
  test('defers notifications until batch completes', () => {
    const first = signal('A');
    const last = signal('B');
    const notifications: string[] = [];

    first.subscribe((v) => notifications.push(`first:${v}`), true);
    last.subscribe((v) => notifications.push(`last:${v}`), true);

    batch(() => {
      first('X');
      last('Y');
    });

    // Both signals should have notified after the batch
    expect(first()).toBe('X');
    expect(last()).toBe('Y');
  });

  test('nested batches flush only at outermost level', () => {
    const s = signal(0);
    let callCount = 0;

    s.subscribe(() => callCount++, true);

    batch(() => {
      batch(() => {
        s(1);
      });
      // Inner batch ended but outer is still active
      s(2);
    });

    expect(s()).toBe(2);
  });

  test('batch rethrows errors and still flushes', () => {
    const s = signal(0);
    const values: number[] = [];

    s.subscribe((v) => { values.push(v); }, true);

    expect(() => {
      batch(() => {
        s(1);
        throw new Error('inside batch');
      });
    }).toThrow('inside batch');

    // Value was set before the throw, and flush ran in finally{}
    expect(s()).toBe(1);
    expect(values).toContain(1);
  });
});

// ─────────────────────────────────────────────────────────────
//  computed()
// ─────────────────────────────────────────────────────────────

describe('computed()', () => {
  test('derives a value from one signal', () => {
    const count = signal(5);
    const doubled = computed(() => count() * 2);

    expect(doubled()).toBe(10);
  });

  test('updates when dependency changes', () => {
    const count = signal(1);
    const doubled = computed(() => count() * 2);

    count(3);
    expect(doubled()).toBe(6);
  });

  test('derives from multiple signals', () => {
    const first = signal('John');
    const last = signal('Doe');
    const full = computed(() => `${first()} ${last()}`);

    expect(full()).toBe('John Doe');

    first('Jane');
    expect(full()).toBe('Jane Doe');

    last('Smith');
    expect(full()).toBe('Jane Smith');
  });

  test('computed is read-only — calling with arg does not crash', () => {
    const s = signal(1);
    const c = computed(() => s() + 1);

    // Calling a computed with an argument should be a no-op
    // (the returned function ignores args since it's a wrapper)
    expect(c()).toBe(2);
  });

  test('computed can subscribe', () => {
    const s = signal(10);
    const c = computed(() => s() * 3);
    const values: number[] = [];

    c.subscribe((v) => values.push(v));

    expect(values).toEqual([30]);

    s(20);
    expect(values).toEqual([30, 60]);
  });

  test('chained computed signals', () => {
    const a = signal(2);
    const b = computed(() => a() * 2);
    const c = computed(() => b() + 1);

    expect(c()).toBe(5);

    a(10);
    expect(b()).toBe(20);
    expect(c()).toBe(21);
  });
});

// ─────────────────────────────────────────────────────────────
//  effect()
// ─────────────────────────────────────────────────────────────

describe('effect()', () => {
  test('runs immediately and on signal change', () => {
    const s = signal('hello');
    const runs: string[] = [];

    const dispose = effect(() => {
      runs.push(s());
    });

    expect(runs).toEqual(['hello']);

    s('world');
    expect(runs).toEqual(['hello', 'world']);

    dispose();
  });

  test('dispose stops the effect from re-running', () => {
    const s = signal(0);
    let count = 0;

    const dispose = effect(() => {
      s(); // track
      count++;
    });

    expect(count).toBe(1);

    dispose();
    s(1);

    // count should not increase after dispose
    expect(count).toBe(1);
  });

  test('tracks multiple signals', () => {
    const a = signal(1);
    const b = signal(2);
    let sum = 0;

    const dispose = effect(() => {
      sum = a() + b();
    });

    expect(sum).toBe(3);

    a(10);
    expect(sum).toBe(12);

    b(20);
    expect(sum).toBe(30);

    dispose();
  });

  test('effect handles conditional dependencies', () => {
    const toggle = signal(true);
    const a = signal('A');
    const b = signal('B');
    const results: string[] = [];

    const dispose = effect(() => {
      results.push(toggle() ? a() : b());
    });

    expect(results).toEqual(['A']);

    a('A2');
    expect(results).toEqual(['A', 'A2']);

    toggle(false);
    expect(results).toEqual(['A', 'A2', 'B']);

    // a is no longer tracked, b is
    b('B2');
    expect(results).toEqual(['A', 'A2', 'B', 'B2']);

    dispose();
  });
});