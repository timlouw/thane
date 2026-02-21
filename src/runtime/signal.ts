/**
 * Signal implementation - core reactive primitive
 *
 * A signal is a reactive value container. Calling with no args returns the value,
 * calling with an arg sets the value and notifies subscribers.
 *
 * Uses a shared subscribe function to reduce per-signal memory allocation.
 * Instead of creating a new closure per signal, all signals share one subscribe
 * function that reads state from properties on the signal function object.
 *
 * Notification loop uses a depth counter (_nc) instead of array snapshot
 * (.slice()) so the hot path is zero-allocation.  Mid-notification unsubscribes
 * null the slot instead of splicing; compaction happens once the outermost
 * notification finishes and only if the array was actually mutated.
 *
 * Batching: when batch() is active, signal writes are applied immediately
 * (the value changes) but subscriber notifications are deferred until the
 * outermost batch completes. This is critical for glitch-free computed
 * signals and atomic multi-signal updates.
 *
 * Computed: uses a pull-on-read + dirty-marking model to prevent glitches.
 * When a dependency changes, the computed is marked dirty but NOT re-evaluated.
 * Re-evaluation happens lazily on the next read, ensuring all dependencies
 * have settled before the derivation runs.
 */

import type { Signal, ReadonlySignal } from './types.js';

/**
 * Internal shape of a signal function object.
 * @internal
 */
type SignalInternal<T> = Signal<T> & {
  _v: T; // current value
  _s: ((val: T) => void)[]; // subscribers (may contain nulls mid-notification)
  _nc: number; // notification depth counter (0 = idle)
};

/**
 * Shared subscribe function — assigned to every signal, uses `this` to access
 * the signal's internal state (_v for value, _s for subscribers array).
 */
function sharedSubscribe<T>(this: SignalInternal<T>, callback: (val: T) => void, skipInitial?: boolean): () => void {
  this._s.push(callback);

  // Call with current value unless skipInitial is true
  if (!skipInitial) {
    callback(this._v);
  }

  // Return unsubscribe function — capture `this` via local
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

/**
 * Create a reactive signal with an initial value
 *
 * @param initialValue - The initial value of the signal
 * @returns A signal function that gets/sets the value
 */
export const signal = <T>(initialValue: T): Signal<T> => {
  const fn = function reactiveFunction(newValue?: T): T {
    // Get value when called with no arguments
    if (arguments.length === 0) {
      // Register with active tracker (computed / effect) if one exists
      const tracker = _activeTracker;
      if (tracker !== null) tracker._track(fn as unknown as Signal<unknown>);
      return fn._v;
    }

    // Set value and notify subscribers when value changes
    // Use Object.is for equality — handles NaN, -0/+0 correctly
    if (!Object.is(fn._v, newValue)) {
      fn._v = newValue!;

      // If inside a batch or a notification cascade, defer notification
      if (_batchDepth > 0 || _notificationDepth > 0) {
        _pendingSignals.add(fn as unknown as SignalInternal<unknown>);
        return fn._v;
      }

      _notifySubscribers(fn);
    }
    return fn._v;
  } as SignalInternal<T>;

  // Per-signal state stored as properties instead of closure variables
  fn._v = initialValue;
  fn._s = [];
  fn._nc = 0;

  // Shared subscribe function — one function object referenced by all signals
  fn.subscribe = sharedSubscribe;

  return fn as Signal<T>;
};

/**
 * Internal: notify all subscribers of a signal.
 * Extracted to be reusable by both direct set and batch flush.
 *
 * Uses a global notification depth to auto-batch cascading updates:
 * if a subscriber callback sets another signal, that signal's
 * notification is deferred until the current notification cycle completes.
 * This prevents diamond glitch in computed signals.
 * @internal
 */
let _notificationDepth = 0;

/**
 * Hook for computed-signal deferred notification flush.
 *
 * Starts as null — `computed()` installs a real flush function on first use
 * via `_installComputedFlush`.  If `computed()` is never imported, this
 * stays null and `_notifySubscribers` skips the call entirely — esbuild
 * tree-shakes the computed flush infrastructure from the bundle.
 * @internal
 */
let _computedFlushHook: (() => void) | null = null;

/**
 * Called once by `computed()` to install its deferred-notification
 * flush callback into the core notification loop.
 * @internal
 */
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
          // Re-throw asynchronously so the error surfaces in devtools
          // without interrupting the notification loop. Using throw instead
          // of console.error ensures it survives prod minifier stripping.
          queueMicrotask(() => {
            throw err;
          });
        }
      }
    }
    if (--fn._nc === 0) {
      // Compact null slots left by mid-notification unsubscribes
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
      // Flush signals that were deferred during the notification cascade.
      // Guard against infinite loops from circular dependencies — if a
      // subscriber write triggers another write that cycles back, the
      // pending set never empties. Cap iterations to surface the bug.
      let flushIterations = 0;
      while (_pendingSignals.size > 0) {
        if (++flushIterations > 100) {
          _pendingSignals.clear();
          throw new Error(
            'Thane: Circular signal dependency detected — a subscriber notification ' +
            'triggered an infinite write cycle. Review your signal subscriptions for loops.',
          );
        }
        const pending = Array.from(_pendingSignals);
        _pendingSignals.clear();
        for (let i = 0; i < pending.length; i++) {
          _notifySubscribers(pending[i]!);
        }
      }
      // Flush computed notifications deferred during the cascade
      if (_computedFlushHook) _computedFlushHook();
    }
  }
}

/**
 * Helper to notify subscribers of a computed signal.
 * Uses a local depth counter to correctly track nested notification depth.
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
//  Batching — defers subscriber notifications until batch ends
// ─────────────────────────────────────────────────────────────

/** Active batch depth counter — 0 means not batching */
let _batchDepth = 0;

/**
 * Set of signals whose values changed during the current batch.
 * Using a Set ensures each signal is notified at most once even if
 * written multiple times within a batch.
 * @internal
 */
const _pendingSignals = new Set<SignalInternal<unknown>>();

/**
 * Batch multiple signal updates so subscriber notifications fire only once
 * after the batch completes. Batches can be nested; notifications flush
 * when the outermost batch ends.
 *
 * The value of each signal is updated immediately (so reads inside the
 * batch see the new value), but subscriber callbacks are deferred.
 *
 * Tree-shakable: if your app never imports `batch`, this code is eliminated.
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
      // Flush all pending signals. Copy into an array first so that
      // if a subscriber triggers another signal write it enters a new
      // implicit "non-batch" context and fires synchronously (no stale
      // iteration issues).
      const pending = Array.from(_pendingSignals);
      _pendingSignals.clear();
      for (let i = 0; i < pending.length; i++) {
        _notifySubscribers(pending[i]!);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Computed — derived signal that auto-tracks dependencies
// ─────────────────────────────────────────────────────────────

/**
 * Currently executing computed/effect tracker — used for auto-tracking.
 * @internal
 */
let _activeTracker: { _track: (sig: Signal<unknown>) => void } | null = null;

/**
 * Module-local state for the computed flush hook — lazily initialised by the
 * first `computed()` call so that the pending queue + flush loop live inside
 * `computed`'s tree-shakable scope.
 */
let _computedFlushInstalled = false;
let _computedPendingQueue: (() => void)[] = [];

/**
 * Create a computed (derived) signal that automatically tracks its
 * signal dependencies and re-evaluates when any of them change.
 *
 * Uses a dirty-marking + pull-on-read model to prevent diamond glitches:
 * when a dependency changes, the computed is marked dirty but NOT
 * re-evaluated immediately. Re-evaluation happens lazily on the next
 * read, ensuring all dependencies have settled first.
 *
 * The returned value is a ReadonlySignal — calling it returns the
 * current derived value. It has a `.dispose()` method to unsubscribe
 * from all dependencies and prevent further re-evaluation.
 *
 * Error handling: if the derivation throws, the error is cached and
 * re-thrown on every read until a dependency changes and the derivation
 * succeeds again.
 *
 * Tree-shakable: if your app never imports `computed`, this code is
 * eliminated by esbuild.
 *
 * @param derivation - Function that reads one or more signals and returns a derived value
 * @returns A ReadonlySignal containing the derived value, with `.dispose()`
 *
 * @example
 * const firstName = signal('John');
 * const lastName = signal('Doe');
 * const fullName = computed(() => `${firstName()} ${lastName()}`);
 * fullName(); // 'John Doe'
 * firstName('Jane');
 * fullName(); // 'Jane Doe'
 */
export function computed<T>(derivation: () => T): ReadonlySignal<T> & { dispose: () => void } {
  // Install the deferred-notification flush hook the first time any
  // computed signal is created.  This keeps the flush infrastructure out
  // of the bundle when `computed` is never imported.
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
  const unsubs: (() => void)[] = [];
  const subscribers: ((val: T) => void)[] = [];
  let notifyCount = 0;

  // Dependencies tracked during last evaluation
  const deps = new Set<Signal<unknown>>();
  const tracker = {
    _track: (sig: Signal<unknown>) => {
      deps.add(sig);
    },
  };

  /**
   * Mark dirty and notify subscribers that value *may* have changed.
   * If we're inside a notification cascade (another signal is being
   * notified), defer by just marking dirty. The cascade flush will
   * eventually reach us.
   */
  let pendingNotify = false;
  const markDirty = () => {
    if (disposed) return;
    dirty = true;
    if (subscribers.length === 0) return;
    // If we're inside a notification cascade, schedule deferred notification
    if (_notificationDepth > 0) {
      if (!pendingNotify) {
        pendingNotify = true;
        _computedPendingQueue.push(notifyIfChanged);
      }
      return;
    }
    notifyIfChanged();
  };

  /** Check if value actually changed and notify subscribers */
  const notifyIfChanged = () => {
    pendingNotify = false;
    if (disposed || subscribers.length === 0) return;
    const oldVal = value;
    evaluate();
    if (hasError || !Object.is(oldVal, value)) {
      _notifyComputedSubs(subscribers, value, notifyCount, (nc) => { notifyCount = nc; });
    }
  };

  /** Subscribe to all tracked dependencies */
  const subscribeToDeps = () => {
    for (const dep of deps) {
      unsubs.push(dep.subscribe(markDirty, true));
    }
  };

  /** Unsubscribe from all current dependencies */
  const unsubscribeAll = () => {
    for (let i = 0; i < unsubs.length; i++) unsubs[i]!();
    unsubs.length = 0;
  };

  /** Evaluate the derivation, tracking dependencies */
  const evaluate = () => {
    unsubscribeAll();
    deps.clear();
    const prev = _activeTracker;
    _activeTracker = tracker;
    try {
      const newVal = derivation();
      error = undefined;
      hasError = false;
      dirty = false;
      // Only notify downstream if value actually changed
      if (!Object.is(value, newVal)) {
        value = newVal;
      }
    } catch (err) {
      error = err;
      hasError = true;
      dirty = false;
    } finally {
      _activeTracker = prev;
    }
    subscribeToDeps();
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
    if (!skipInitial) {
      // Re-evaluate if dirty before calling subscriber
      if (dirty && !disposed) evaluate();
      if (hasError) {
        throw error;
      } else {
        cb(value);
      }
    }
    return () => {
      const idx = subscribers.indexOf(cb);
      if (idx !== -1) {
        if (notifyCount > 0) {
          (subscribers as any[])[idx] = null;
        } else {
          subscribers.splice(idx, 1);
        }
      }
    };
  };

  // Dispose method — unsubscribe from all dependencies
  fn.dispose = () => {
    disposed = true;
    unsubscribeAll();
    deps.clear();
    subscribers.length = 0;
  };

  return fn;
}

// ─────────────────────────────────────────────────────────────
//  Effect — auto-tracked side effect
// ─────────────────────────────────────────────────────────────

/**
 * Run a side-effect function that automatically tracks which signals it
 * reads and re-runs whenever any of those signals change.
 *
 * Returns a dispose function that unsubscribes from all tracked signals.
 *
 * Tree-shakable: if your app never imports `effect`, this code is
 * eliminated by esbuild.
 *
 * @param fn - Side-effect function that reads signals
 * @returns A dispose function to stop the effect
 *
 * @example
 * const name = signal('world');
 * const dispose = effect(() => {
 *   console.log(`Hello, ${name()}!`);
 * });
 * // logs: "Hello, world!"
 * name('Thane');
 * // logs: "Hello, Thane!"
 * dispose(); // stops the effect
 */
export function effect(fn: () => void): () => void {
  const unsubs: (() => void)[] = [];
  let disposed = false;

  // Reusable tracking objects — same optimization as computed().
  const deps = new Set<Signal<unknown>>();
  const tracker = {
    _track: (sig: Signal<unknown>) => {
      deps.add(sig);
    },
  };

  const run = () => {
    if (disposed) return;

    // Unsubscribe from old dependencies
    for (let i = 0; i < unsubs.length; i++) unsubs[i]!();
    unsubs.length = 0;

    // Track new dependencies (reuse existing Set)
    deps.clear();
    const prev = _activeTracker;
    _activeTracker = tracker;
    try {
      fn();
    } catch (err) {
      // Surface the error without killing the effect — re-subscription
      // below keeps the effect alive so it can recover on the next
      // dependency change (matching _notifySubscribers error semantics).
      queueMicrotask(() => {
        throw err;
      });
    } finally {
      _activeTracker = prev;
    }

    // Subscribe to all tracked dependencies — pass `run` directly.
    // This MUST run even after an error so the effect re-fires when
    // the dependency that caused the failure changes.
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
//  Untrack — escape hatch to read signals without tracking
// ─────────────────────────────────────────────────────────────

/**
 * Run a function without tracking any signal reads. Use this inside
 * computed() or effect() when you need to read a signal's value
 * without creating a dependency on it.
 *
 * Tree-shakable: if your app never imports `untrack`, this code is
 * eliminated by esbuild.
 *
 * @param fn - Function to run without tracking
 * @returns The return value of `fn`
 *
 * @example
 * const count = signal(0);
 * const label = signal('Count');
 * const display = computed(() => {
 *   // Re-evaluates when count changes, but NOT when label changes
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
