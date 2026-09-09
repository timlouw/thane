import { describe, expect, test } from 'bun:test';
import { signal, computed } from './signal.js';

/** The subscriber array behind a signal (internal, for asserting on compaction). */
const slots = (sig: unknown): unknown[] => (sig as { _s: unknown[] })._s;

describe('signal unsubscribe — constant time, order preserving', () => {
  test('tearing down many subscribers leaves the rest notified in subscription order', () => {
    const count = signal(0);
    const calls: number[] = [];
    const unsubs = Array.from({ length: 1000 }, (_, i) => count.subscribe(() => calls.push(i), true));

    // Remove the first 990 in order — the pattern a cleared list produces
    for (let i = 0; i < 990; i++) unsubs[i]!();
    count(1);
    expect(calls).toEqual([990, 991, 992, 993, 994, 995, 996, 997, 998, 999]);
    // The notification compacted the dead slots away
    expect(slots(count).length).toBe(10);
  });

  test('repeated subscribe and unsubscribe without notifications keeps the array bounded', () => {
    const count = signal(0);
    for (let cycle = 0; cycle < 20; cycle++) {
      const unsubs = Array.from({ length: 100 }, () => count.subscribe(() => {}, true));
      for (const unsub of unsubs) unsub();
    }
    // Dead slots are compacted lazily on subscribe once they outnumber live entries
    expect(slots(count).length).toBeLessThan(300);
  });

  test('an unsubscribe issued after a compaction still removes the right callback', () => {
    const count = signal(0);
    const seen: string[] = [];
    const unsubA = count.subscribe(() => seen.push('a'), true);
    const unsubB = count.subscribe(() => seen.push('b'), true);
    const unsubC = count.subscribe(() => seen.push('c'), true);

    unsubA();
    count(1); // compacts: b and c move to slots 0 and 1
    expect(seen).toEqual(['b', 'c']);

    unsubC(); // its remembered slot now holds a different callback
    count(2);
    expect(seen).toEqual(['b', 'c', 'b']);

    unsubB();
    count(3);
    expect(seen).toEqual(['b', 'c', 'b']);
  });

  test('unsubscribing twice is harmless and does not remove another subscriber', () => {
    const count = signal(0);
    const seen: string[] = [];
    const unsubA = count.subscribe(() => seen.push('a'), true);
    count.subscribe(() => seen.push('b'), true);
    unsubA();
    unsubA();
    count(1);
    expect(seen).toEqual(['b']);
  });

  test('unsubscribing during a notification skips the removed subscriber from then on', () => {
    const count = signal(0);
    const seen: string[] = [];
    let unsubB: () => void = () => {};
    count.subscribe(() => {
      seen.push('a');
      unsubB();
    }, true);
    unsubB = count.subscribe(() => seen.push('b'), true);
    count.subscribe(() => seen.push('c'), true);

    count(1);
    expect(seen).toEqual(['a', 'c']);
    count(2);
    expect(seen).toEqual(['a', 'c', 'a', 'c']);
  });
});

describe('computed unsubscribe — constant time, order preserving', () => {
  const setup = () => {
    const base = signal(0);
    const doubled = computed(() => base() * 2);
    return { base, doubled };
  };

  test('tearing down many subscribers leaves the rest notified in subscription order', () => {
    const { base, doubled } = setup();
    const calls: number[] = [];
    const unsubs = Array.from({ length: 1000 }, (_, i) => doubled.subscribe(() => calls.push(i), true));
    for (let i = 0; i < 990; i++) unsubs[i]!();
    base(1);
    expect(calls).toEqual([990, 991, 992, 993, 994, 995, 996, 997, 998, 999]);
  });

  test('unsubscribing in reverse order and then re-subscribing keeps notifications correct', () => {
    const { base, doubled } = setup();
    const seen: string[] = [];
    const unsubs = ['a', 'b', 'c', 'd'].map((name) => doubled.subscribe(() => seen.push(name), true));
    for (let i = unsubs.length - 1; i >= 0; i--) unsubs[i]!();
    base(1);
    expect(seen).toEqual([]);
    doubled.subscribe(() => seen.push('e'), true);
    base(2);
    expect(seen).toEqual(['e']);
  });

  test('an unsubscribe issued after a compaction still removes the right callback', () => {
    const { base, doubled } = setup();
    const seen: string[] = [];
    const unsubA = doubled.subscribe(() => seen.push('a'), true);
    const unsubB = doubled.subscribe(() => seen.push('b'), true);
    const unsubC = doubled.subscribe(() => seen.push('c'), true);
    unsubA();
    base(1); // compacts: b and c move down a slot
    expect(seen).toEqual(['b', 'c']);
    unsubC();
    base(2);
    expect(seen).toEqual(['b', 'c', 'b']);
    unsubB();
    base(3);
    expect(seen).toEqual(['b', 'c', 'b']);
  });

  test('a computed whose subscribers all left no longer re-evaluates on change', () => {
    const base = signal(0);
    let evaluations = 0;
    const doubled = computed(() => {
      evaluations++;
      return base() * 2;
    });
    const unsub = doubled.subscribe(() => {}, true);
    const before = evaluations;
    unsub();
    base(1);
    expect(evaluations).toBe(before);
    expect(doubled()).toBe(2);
  });

  test('unsubscribing twice is harmless and does not remove another subscriber', () => {
    const { base, doubled } = setup();
    const seen: string[] = [];
    const unsubA = doubled.subscribe(() => seen.push('a'), true);
    doubled.subscribe(() => seen.push('b'), true);
    unsubA();
    unsubA();
    base(1);
    expect(seen).toEqual(['b']);
  });

  test('unsubscribing during a notification skips the removed subscriber from then on', () => {
    const { base, doubled } = setup();
    const seen: string[] = [];
    let unsubB: () => void = () => {};
    doubled.subscribe(() => {
      seen.push('a');
      unsubB();
    }, true);
    unsubB = doubled.subscribe(() => seen.push('b'), true);
    doubled.subscribe(() => seen.push('c'), true);
    base(1);
    expect(seen).toEqual(['a', 'c']);
    base(2);
    expect(seen).toEqual(['a', 'c', 'a', 'c']);
  });
});
