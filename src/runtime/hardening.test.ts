/**
 * Signal defects, each fixed and kept as a regression test.
 *
 * Each test asserts the correct behaviour. The compile-time defects are in
 * src/compiler/hardening.test.ts, the runtime ones in e2e/tests/hardening.spec.ts.
 */
import { describe, expect, test } from 'bun:test';
import { computed, effect, signal } from './signal.js';

/** Live subscribers of a signal: its subscriber slots minus the unsubscribed (null) ones. */
const liveSubscribers = (sig: unknown): number => (sig as { _s: unknown[] })._s.filter((cb) => cb != null).length;

describe('signal defects', () => {
  test('an effect that disposes itself during a run keeps no subscription', () => {
    const source = signal(0);
    let runs = 0;
    let stop: () => void = () => {};
    stop = effect(() => {
      runs++;
      if (source() > 0) stop();
    });
    expect(liveSubscribers(source)).toBe(1);

    source(1); // this run disposes the effect
    expect(liveSubscribers(source)).toBe(0);
    source(2);
    expect(runs).toBe(2);
    expect(liveSubscribers(source)).toBe(0);
  });

  test('a computed disposed inside its own derivation keeps no subscription on its dependency', () => {
    const source = signal(0);
    let derived: ReturnType<typeof computed<number>> | undefined;
    derived = computed(() => {
      const value = source();
      if (value > 0) derived?.dispose();
      return value;
    });
    derived.subscribe(() => {}, true);
    expect(liveSubscribers(source)).toBe(1);

    source(1); // this evaluation disposes the computed
    expect(liveSubscribers(source)).toBe(0);
  });
});
