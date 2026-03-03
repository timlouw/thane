/**
 * Signal — core reactive primitive.
 *
 * Memory model:
 *   - Shared subscribe function (one closure for all signals)
 *   - Per-signal state via properties on the function object (_v, _s, _nc)
 *
 * Notification model:
 *   - Depth counter (_nc) instead of array snapshot → zero-allocation hot path
 *   - Mid-notification unsubscribes null the slot; compaction after outermost notify
 *
 * Batching:
 *   - Writes apply immediately; notifications deferred until outermost batch ends
 *   - Critical for glitch-free computed signals and atomic multi-signal updates
 *
 * Computed:
 *   - Pull-on-read + dirty-marking prevents diamond glitches
 *   - Re-evaluation is lazy: only on the next read after a dependency changes
 */

import type { Signal, ReadonlySignal } from './types.js';

/** @internal */
type SignalInternal<T> = Signal<T> & {
  _v: T; // current value
  _s: ((val: T) => void)[]; // subscribers (may contain nulls mid-notification)
  _nc: number; // notification depth counter (0 = idle)
};

/** Shared subscribe — uses `this` to access the signal's _v, _s, _nc state. */
function sharedSubscribe<T>(this: SignalInternal<T>, callback: (val: T) => void, skipInitial?: boolean): () => void {
  this._s.push(callback);

  if (!skipInitial) {
    callback(this._v);
  }

  const self = this;
  return () => {
    const subs = self._s;
    const idx = subs.indexOf(callback);
    if (idx !== -1) {
      if (self._nc > 0) {
        // Mid-notification: null the slot so the iteration index stays valid.
        // The notification loop skips null entries and the outermost level
        // compacts the array when it finishes.
        (subs as (((val: T) => void) | null)[])[idx] = null;
      } else {
        subs.splice(idx, 1);
      }
    }
  };
}

/** Create a reactive signal with an initial value. */
export const signal = <T>(initialValue: T): Signal<T> => {
  const fn = function reactiveFunction(newValue?: T): T {
    if (arguments.length === 0) {
      const tracker = _activeTracker;
      if (tracker !== null) tracker._track(fn as unknown as Signal<unknown>);
      return fn._v;
    }

    if (!Object.is(fn._v, newValue)) {
      fn._v = newValue!;

      if (_batchDepth > 0 || _notificationDepth > 0) {
        _pendingSignals.add(fn as unknown as SignalInternal<unknown>);
        return fn._v;
      }

      _notifySubscribers(fn);
    }
    return fn._v;
  } as SignalInternal<T>;

  fn._v = initialValue;
  fn._s = [];
  fn._nc = 0;

  fn.subscribe = sharedSubscribe;

  return fn as Signal<T>;
};

/** @internal — cascading updates are auto-batched via notification depth. */
let _notificationDepth = 0;

/**
 * Hook for computed-signal deferred-notification flush.
 * Stays null (tree-shaken) when `computed()` is never imported.
 * @internal
 */
let _computedFlushHook: (() => void) | null = null;

/** @internal — called once by `computed()` to wire into the notification loop. */
export function _installComputedFlush(hook: () => void): void {
  _computedFlushHook = hook;
}

function _notifySubscribers<T>(fn: SignalInternal<T>): void {
  const subs = fn._s;
  const len = subs.length;
  if (len > 0) {
    _notificationDepth++;
    fn._nc++;
    for (let i = 0; i < len; i++) {
      const cb = subs[i];
      if (cb != null) {
        try {
          cb(fn._v);
        } catch (err) {
          // Re-throw asynchronously to avoid interrupting the notification loop
          queueMicrotask(() => {
            throw err;
          });
        }
      }
    }
    if (--fn._nc === 0) {
      // Compact null slots from mid-notification unsubscribes
      const curLen = subs.length;
      let r = 0;
      while (r < curLen && subs[r] !== null) r++;
      if (r < curLen) {
        let w = r;
        for (++r; r < curLen; r++) {
          if (subs[r] !== null) (subs as any[])[w++] = subs[r];
        }
        subs.length = w;
      }
    }
    if (--_notificationDepth === 0) {
      // Flush deferred cascade signals (cap iterations to catch circular deps)
      let flushIterations = 0;
      while (_pendingSignals.size > 0) {
        if (++flushIterations > 100) {
          _pendingSignals.clear();
          throw new Error('Circular signal dependency');
        }
        const pending = Array.from(_pendingSignals);
        _pendingSignals.clear();
        for (let i = 0; i < pending.length; i++) {
          _notifySubscribers(pending[i]!);
        }
      }
      // Flush deferred computed notifications
      if (_computedFlushHook) _computedFlushHook();
    }
  }
}

/**
 * Notify computed subscribers with local depth tracking.
 * @internal
 */
function _notifyComputedSubs<T>(
  subscribers: ((val: T) => void)[],
  value: T,
  notifyCount: number,
  setNotifyCount: (nc: number) => void,
): void {
  const len = subscribers.length;
  const depth = notifyCount + 1;
  setNotifyCount(depth);
  for (let i = 0; i < len; i++) {
    const cb = subscribers[i];
    if (cb != null) {
      try {
        cb(value);
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
    }
  }
  setNotifyCount(depth - 1);
  if (depth - 1 === 0) {
    // Compact null slots left by mid-notification unsubscribes
    const curLen = subscribers.length;
    let r = 0;
    while (r < curLen && subscribers[r] !== null) r++;
    if (r < curLen) {
      let w = r;
      for (++r; r < curLen; r++) {
        if (subscribers[r] !== null) (subscribers as any[])[w++] = subscribers[r];
      }
      subscribers.length = w;
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Batching
// ─────────────────────────────────────────────────────────────

let _batchDepth = 0;

/**
 * Signals whose values changed during the current batch.
 * @internal
 */
const _pendingSignals = new Set<SignalInternal<unknown>>();

/**
 * Batch multiple signal updates — notifications fire once after the batch completes.
 * Batches nest; flush happens when the outermost batch ends.
 *
 * @example
 * batch(() => {
 *   firstName('Jane');
 *   lastName('Doe');
 * });
 * // Subscribers fire once with final values
 */
export function batch(fn: () => void): void {
  _batchDepth++;
  try {
    fn();
  } finally {
    if (--_batchDepth === 0) {
      const pending = Array.from(_pendingSignals);
      _pendingSignals.clear();
      for (let i = 0; i < pending.length; i++) {
        _notifySubscribers(pending[i]!);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Computed
// ─────────────────────────────────────────────────────────────

/** @internal */
let _activeTracker: { _track: (sig: Signal<unknown>) => void } | null = null;

/**
 * Lazily initialised state for computed flush hook — lives inside
 * `computed()`'s tree-shakable scope.
 */
let _computedFlushInstalled = false;
let _computedPendingQueue: (() => void)[] = [];

/**
 * Create a derived signal that auto-tracks dependencies and re-evaluates lazily.
 *
 * Uses dirty-marking + pull-on-read to prevent diamond glitches.
 * Returned value is a ReadonlySignal with `.dispose()` to unsubscribe.
 *
 * @example
 * const firstName = signal('John');
 * const lastName = signal('Doe');
 * const fullName = computed(() => `${firstName()} ${lastName()}`);
 * fullName(); // 'John Doe'
 */
export function computed<T>(derivation: () => T): ReadonlySignal<T> & { dispose: () => void } {
  // Install deferred-notification flush hook on first computed creation
  if (!_computedFlushInstalled) {
    _computedFlushInstalled = true;
    const q: (() => void)[] = [];
    _computedPendingQueue = q;
    _installComputedFlush(() => {
      while (q.length > 0) {
        const cbs = q.splice(0);
        for (let i = 0; i < cbs.length; i++) cbs[i]!();
      }
    });
  }

  let value: T = undefined as T;
  let dirty = true;
  let disposed = false;
  let error: unknown = undefined;
  let hasError = false;
  // Dep map: signal → unsubscribe fn (supports O(1) differential updates)
  const depUnsubs = new Map<Signal<unknown>, () => void>();
  const subscribers: ((val: T) => void)[] = [];
  let notifyCount = 0;

  // Deps set populated during evaluation (null outside evaluate)
  let _evalDeps: Set<Signal<unknown>> | null = null;
  const tracker = {
    _track: (sig: Signal<unknown>) => {
      _evalDeps!.add(sig);
    },
  };

  /**
   * Mark dirty and schedule notification.
   * During a notification cascade, defers to the computed pending queue.
   */
  let pendingNotify = false;
  const markDirty = () => {
    if (disposed) return;
    dirty = true;
    if (subscribers.length === 0) return;
    // During a cascade, defer notification
    if (_notificationDepth > 0) {
      if (!pendingNotify) {
        pendingNotify = true;
        _computedPendingQueue.push(notifyIfChanged);
      }
      return;
    }
    notifyIfChanged();
  };

  /** Re-evaluate if value changed and notify subscribers. */
  const notifyIfChanged = () => {
    pendingNotify = false;
    if (disposed || subscribers.length === 0) return;
    const oldVal = value;
    evaluate();
    if (hasError || !Object.is(oldVal, value)) {
      _notifyComputedSubs(subscribers, value, notifyCount, (nc) => {
        notifyCount = nc;
      });
    }
  };

  /** Unsubscribe from all tracked dependencies and clear the map */
  const unsubscribeAll = () => {
    for (const unsub of depUnsubs.values()) unsub();
    depUnsubs.clear();
  };

  /**
   * Evaluate with differential dependency tracking.
   *
   * Diffs old deps against newly-tracked deps — only subscribes/unsubscribes
   * the delta. When the dep set is stable (common case), this is O(0) work.
   */
  const evaluate = () => {
    const newDeps = new Set<Signal<unknown>>();
    _evalDeps = newDeps;
    const prev = _activeTracker;
    _activeTracker = tracker;
    try {
      const newVal = derivation();
      error = undefined;
      hasError = false;
      dirty = false;
      // Only update downstream if value actually changed
      if (!Object.is(value, newVal)) {
        value = newVal;
      }
    } catch (err) {
      error = err;
      hasError = true;
      dirty = false;
    } finally {
      _activeTracker = prev;
      _evalDeps = null;
    }

    // Subscribe to newly-added deps
    for (const dep of newDeps) {
      if (!depUnsubs.has(dep)) {
        depUnsubs.set(dep, dep.subscribe(markDirty, true));
      }
    }
    // Unsubscribe from removed deps
    for (const [dep, unsub] of depUnsubs) {
      if (!newDeps.has(dep)) {
        unsub();
        depUnsubs.delete(dep);
      }
    }
  };

  // Initial evaluation
  evaluate();

  // The computed signal function — read-only
  const fn = (() => {
    if (disposed) return value;

    // Register with parent tracker (computed / effect) if one exists
    const parentTracker = _activeTracker;
    if (parentTracker !== null) {
      // Create a temporary signal-like object for tracking
      parentTracker._track(fn as unknown as Signal<unknown>);
    }

    if (dirty) {
      evaluate();
    }
    if (hasError) throw error;
    return value;
  }) as unknown as ReadonlySignal<T> & { dispose: () => void };

  // Subscribe method — mimics signal.subscribe interface
  fn.subscribe = (cb: (val: T) => void, skipInitial?: boolean): (() => void) => {
    subscribers.push(cb);
    const unsubscribe = () => {
      const idx = subscribers.indexOf(cb);
      if (idx !== -1) {
        if (notifyCount > 0) {
          (subscribers as any[])[idx] = null;
        } else {
          subscribers.splice(idx, 1);
        }
      }
    };
    if (!skipInitial) {
      // Re-evaluate if dirty before calling subscriber
      if (dirty && !disposed) evaluate();
      if (hasError) {
        // Clean up the subscriber before throwing so no orphan subscription leaks.
        // The caller catches the error and knows the subscribe failed cleanly.
        unsubscribe();
        throw error;
      } else {
        cb(value);
      }
    }
    return unsubscribe;
  };

  // Dispose method — unsubscribe from all dependencies
  fn.dispose = () => {
    disposed = true;
    unsubscribeAll();
    subscribers.length = 0;
  };

  return fn;
}

// ─────────────────────────────────────────────────────────────
//  Effect
// ─────────────────────────────────────────────────────────────

/**
 * Auto-tracked side effect that re-runs when any read signal changes.
 * Returns a dispose function.
 *
 * @example
 * const name = signal('world');
 * const dispose = effect(() => console.log(`Hello, ${name()}!`));
 * name('Thane'); // logs: "Hello, Thane!"
 * dispose();
 */
export function effect(fn: () => void): () => void {
  const unsubs: (() => void)[] = [];
  let disposed = false;

  // Reusable tracking objects
  const deps = new Set<Signal<unknown>>();
  const tracker = {
    _track: (sig: Signal<unknown>) => {
      deps.add(sig);
    },
  };

  const run = () => {
    if (disposed) return;

    // Unsubscribe from old deps
    for (let i = 0; i < unsubs.length; i++) unsubs[i]!();
    unsubs.length = 0;

    // Track new deps
    deps.clear();
    const prev = _activeTracker;
    _activeTracker = tracker;
    try {
      fn();
    } catch (err) {
      // Surface error without killing the effect — re-subscription below
      // keeps it alive for recovery on next dependency change
      queueMicrotask(() => {
        throw err;
      });
    } finally {
      _activeTracker = prev;
    }

    // Subscribe to tracked deps (MUST run even after error)
    for (const dep of deps) {
      unsubs.push(dep.subscribe(run, true));
    }
  };

  run();

  return () => {
    disposed = true;
    for (let i = 0; i < unsubs.length; i++) unsubs[i]!();
    unsubs.length = 0;
  };
}

// ─────────────────────────────────────────────────────────────
//  Untrack
// ─────────────────────────────────────────────────────────────

/**
 * Read signals without tracking. Use inside computed/effect
 * to avoid creating a dependency.
 *
 * @example
 * const display = computed(() => {
 *   const labelText = untrack(() => label());
 *   return `${labelText}: ${count()}`;
 * });
 */
export function untrack<T>(fn: () => T): T {
  const prev = _activeTracker;
  _activeTracker = null;
  try {
    return fn();
  } finally {
    _activeTracker = prev;
  }
}
