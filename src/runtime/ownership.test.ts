/**
 * Ownership: a `computed()`, an `effect()` and an `onCleanup()` function created while a component's setup or
 * onMount runs, or while an effect runs, are disposed when that ends: the component when it is destroyed, the
 * effect before its next run and when it is disposed. An effect's function may return its cleanup. Here a setup
 * is run by hand (`__owning`), as the component factory runs it; component-factory.test.ts shows the factory,
 * and e2e/tests/hardening.spec.ts ("ownership") the browser.
 */
import { describe, expect, test } from 'bun:test';
import { signal, computed, effect, onCleanup, __owning } from './signal.js';

/** The live subscribers of a signal */
const subscribers = (sig: unknown): number => (sig as { _s: unknown[] })._s.filter((s) => s !== null).length;

/** Runs `fn` as a component's setup would: with a fresh owner, whose cleanups are returned */
const asSetup = (fn: () => void): (() => void)[] => {
  const owned: (() => void)[] = [];
  __owning(owned, fn);
  return owned;
};

/** Runs what a setup owns, each once, as the component's destroy does */
const destroy = (owned: (() => void)[]): void => {
  for (const cleanup of owned.splice(0)) cleanup();
};

describe('a setup owns the computeds and effects it creates', () => {
  test('five visits to a page that derives from a store leave no subscribers on the store', () => {
    const products = signal([1, 2, 3]);
    for (let visit = 0; visit < 5; visit++) {
      const owned = asSetup(() => {
        const count = computed(() => products().length);
        effect(() => void count());
      });
      expect(owned).toHaveLength(2);
      destroy(owned);
    }
    expect(subscribers(products)).toBe(0);
  });

  test('a disposed computed and effect stop following their sources', () => {
    const source = signal(1);
    const runs: number[] = [];
    let doubled!: ReturnType<typeof computed<number>>;
    const owned = asSetup(() => {
      doubled = computed(() => source() * 2);
      effect(() => void runs.push(doubled()));
    });
    source(2);
    expect(runs).toEqual([2, 4]);
    destroy(owned);
    source(3);
    expect(runs).toEqual([2, 4]);
    expect(doubled()).toBe(4);
  });

  test('outside a setup, nothing owns them: they live until disposed', () => {
    const source = signal(1);
    const count = computed(() => source());
    const stop = effect(() => void count());
    expect(subscribers(source)).toBe(1);
    count.dispose();
    stop();
    expect(subscribers(source)).toBe(0);
  });

  test('onCleanup adds a function the owner runs, in the order they were added', () => {
    const order: string[] = [];
    const owned = asSetup(() => {
      onCleanup(() => order.push('first'));
      onCleanup(() => order.push('second'));
    });
    expect(order).toEqual([]);
    destroy(owned);
    expect(order).toEqual(['first', 'second']);
    // Each runs once
    destroy(owned);
    expect(order).toEqual(['first', 'second']);
  });

  test('onCleanup with no owner throws in development: nothing would call it', () => {
    expect(() => onCleanup(() => {})).toThrow(
      "[thane] onCleanup() is called while a component's setup or onMount runs, or inside an effect: here nothing would call it.",
    );
  });
});

describe("an effect's run owns what it creates", () => {
  test('the cleanup the function returns runs before the next run and when the effect is disposed', () => {
    const delay = signal(100);
    const log: string[] = [];
    const stop = effect(() => {
      const ms = delay();
      log.push(`start ${ms}`);
      return () => log.push(`stop ${ms}`);
    });
    delay(200);
    expect(log).toEqual(['start 100', 'stop 100', 'start 200']);
    stop();
    expect(log).toEqual(['start 100', 'stop 100', 'start 200', 'stop 200']);
    stop();
    expect(log).toHaveLength(4);
  });

  test('onCleanup in a run runs before the next run', () => {
    const n = signal(0);
    const log: string[] = [];
    const stop = effect(() => {
      const value = n();
      onCleanup(() => log.push(`cleanup ${value}`));
    });
    n(1);
    n(2);
    expect(log).toEqual(['cleanup 0', 'cleanup 1']);
    stop();
    expect(log).toEqual(['cleanup 0', 'cleanup 1', 'cleanup 2']);
  });

  test('an effect created in a run is disposed before the next run: re-runs do not pile up inner effects', () => {
    const outer = signal(0);
    const inner = signal(0);
    let innerRuns = 0;
    const stop = effect(() => {
      outer();
      effect(() => {
        inner();
        innerRuns++;
      });
    });
    for (let i = 1; i <= 5; i++) outer(i);
    expect(subscribers(inner)).toBe(1);
    innerRuns = 0;
    inner(1);
    expect(innerRuns).toBe(1);
    stop();
    expect(subscribers(inner)).toBe(0);
  });

  test("an effect created in a setup is the setup's: disposing the owner disposes it and runs its cleanup", () => {
    const log: string[] = [];
    const owned = asSetup(() => {
      effect(() => () => log.push('effect cleanup'));
    });
    destroy(owned);
    expect(log).toEqual(['effect cleanup']);
  });

  test("the owner is the setup's again after an effect it creates has run", () => {
    const log: string[] = [];
    const owned = asSetup(() => {
      effect(() => {});
      onCleanup(() => log.push('setup cleanup'));
    });
    expect(owned).toHaveLength(2);
    destroy(owned);
    expect(log).toEqual(['setup cleanup']);
  });
});

describe('the owner after an error', () => {
  test('a setup that throws leaves the owner as it was: onCleanup outside it still throws', () => {
    expect(() =>
      asSetup(() => {
        throw new Error('setup failed');
      }),
    ).toThrow('setup failed');
    expect(() => onCleanup(() => {})).toThrow('[thane] onCleanup() is called');
  });

  test("an effect's run that throws keeps what it created before the error, for its next run to clean up", () => {
    const n = signal(0);
    const log: string[] = [];
    const errors: unknown[] = [];
    const original = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        errors.push(err);
      }
    };
    try {
      const stop = effect(() => {
        const value = n();
        onCleanup(() => log.push(`cleanup ${value}`));
        if (value === 0) throw new Error('first run failed');
      });
      n(1);
      stop();
    } finally {
      globalThis.queueMicrotask = original;
    }
    expect(errors.map((e) => (e as Error).message)).toEqual(['first run failed']);
    expect(log).toEqual(['cleanup 0', 'cleanup 1']);
  });

  test('an effect disposed by its own run cleans up what the run made, and runs no more', () => {
    const n = signal(0);
    const log: string[] = [];
    let stop: () => void = () => {};
    stop = effect(() => {
      if (n() === 0) return;
      onCleanup(() => log.push('cleanup'));
      stop();
      return () => log.push('returned cleanup');
    });
    n(1);
    expect(log).toEqual(['cleanup', 'returned cleanup']);
    n(2);
    expect(log).toHaveLength(2);
    expect(subscribers(n)).toBe(0);
  });
});
