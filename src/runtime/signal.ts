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
 *   - A write inside a subscriber (a cascade) is applied at once and notified after the current
 *     notification; each waiting signal then drains its own cascades before the next one
 *   - Cycle detection in development builds only: a cascade that never settles throws a clear
 *     error there; a production build has no check (it would cost every app bytes) and overflows
 *
 * Batching:
 *   - Writes apply immediately; notifications deferred until outermost batch ends
 *   - Each changed signal is notified once, with its final value (atomic multi-signal updates)
 *
 * Computed:
 *   - Dirty-marked when a dependency notifies; re-evaluated lazily, on the next read
 *   - A diamond notifies the join once, with the final value
 *   - Reads are fresh: read inside a notification pass or a batch() function, where a source may have
 *     changed without notifying yet, a computed computes again when any signal was written since
 */

import type { Signal, ReadonlySignal } from './types.js';

/**
 * False in a production build (`thane build --prod` defines it), which leaves the development checks
 * out. Undefined everywhere else, which keeps them.
 */
declare const __THANE_DEV__: boolean | undefined;

/**
 * Development builds: how deeply cascade drains are nested. Signals that keep setting each other nest
 * one drain inside the last until the stack overflows, after which writes can stop being notified; the
 * check stops them long before that. No real cascade is nested this deep.
 */
let _drainDepth = 0;
const MAX_DRAIN_DEPTH = 500;

/** Development builds: count one more nested drain, or stop a cycle with an error that says what it is */
function _enterDrain(): void {
  if (++_drainDepth > MAX_DRAIN_DEPTH) {
    // What is still queued would start the cycle again: dropped, so that later writes notify as usual
    _pendingSignals.clear();
    _computedPendingQueue.length = 0;
    throw new Error(
      "[thane] Signals keep setting each other: a subscriber's write triggers itself again, " +
        MAX_DRAIN_DEPTH +
        ' cascades deep. Look for two signals (or a computed and its source) whose subscribers set each other.',
    );
  }
}

/** @internal */
type SignalInternal<T> = Signal<T> & {
  _v: T; // current value
  _s: (((val: T) => void) | null)[]; // subscribers; null slots are unsubscribed entries awaiting compaction
  _nc: number; // notification depth counter (0 = idle)
  _nn: number; // number of null slots in _s
};

/** Subscriber slots, shared by signals and computeds. @internal */
type Slots<T> = Pick<SignalInternal<T>, '_s' | '_nc' | '_nn'>;

/** Drop the null slots left by unsubscribes. Only called while the signal is not notifying. */
function _compact<T>(fn: Slots<T>): void {
  const subs = fn._s;
  const len = subs.length;
  let w = 0;
  for (let r = 0; r < len; r++) {
    const cb = subs[r];
    if (cb != null) subs[w++] = cb;
  }
  subs.length = w;
  fn._nn = 0;
}

/**
 * Shared subscribe — uses `this` to access the signal's _v, _s, _nc, _nn state.
 *
 * Unsubscribing nulls the entry's slot in place, which is constant time and keeps the
 * notification loop's indices valid, instead of splicing it out (which moved every later
 * entry and made tearing down N subscribers O(N²)). The closure remembers the slot it was
 * pushed into; it only scans when a compaction has moved the entry since.
 */
function sharedSubscribe<T>(this: SignalInternal<T>, callback: (val: T) => void, skipInitial?: boolean): () => void {
  const self = this;
  const subs = self._s;
  // An idle signal whose array is mostly dead slots (a list cleared and rebuilt with no
  // notification in between) is compacted before the new entry goes in, so the array
  // cannot grow without bound.
  if (self._nn > 0 && self._nc === 0 && self._nn > subs.length >> 1) _compact(self);
  const slot = subs.length;
  subs.push(callback);

  if (!skipInitial) {
    callback(self._v);
  }

  return () => {
    const s = self._s;
    const idx = s[slot] === callback ? slot : s.indexOf(callback);
    if (idx !== -1) {
      s[idx] = null;
      self._nn++;
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
      _writes++;

      if (_notificationDepth) {
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
  fn._nn = 0;

  fn.subscribe = sharedSubscribe;

  return fn as Signal<T>;
};

/** @internal — above 0 while subscribers or a batch() function run; a write then waits in _pendingSignals. */
let _notificationDepth = 0;

/** @internal — counts the writes that changed a value: a computed read in a notification pass compares it */
let _writes = 0;

/**
 * Hook for computed-signal deferred-notification flush.
 * Stays null (tree-shaken) when `computed()` is never imported.
 * @internal
 */
let _computedFlushHook: (() => void) | null = null;

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
    // Compact the slots nulled by unsubscribes once the outermost notification is done
    if (--fn._nc === 0 && fn._nn > 0) _compact(fn);
    if (--_notificationDepth === 0) {
      // Flush deferred cascade signals
      if (_pendingSignals.size > 0) _flushPending();
      // Flush deferred computed notifications
      if (_computedFlushHook) _computedFlushHook();
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

/** @internal — one pass: at depth 0 each pending signal drains its own cascades before the next. */
function _flushPending(): void {
  if (typeof __THANE_DEV__ === 'undefined' || __THANE_DEV__) {
    // The same drain, counted (development builds). A production build keeps only the loop below,
    // byte for byte as it was
    _enterDrain();
    try {
      const pending = Array.from(_pendingSignals);
      _pendingSignals.clear();
      for (let i = 0; i < pending.length; i++) _notifySubscribers(pending[i]!);
    } finally {
      _drainDepth--;
    }
    return;
  }
  const pending = Array.from(_pendingSignals);
  _pendingSignals.clear();
  for (let i = 0; i < pending.length; i++) {
    _notifySubscribers(pending[i]!);
  }
}

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
  // fn()'s writes wait as a subscriber's do; the depth is back before the flush
  _notificationDepth++;
  try {
    fn();
  } finally {
    _notificationDepth--;
    if (!--_batchDepth) _flushPending();
  }
}

// ─────────────────────────────────────────────────────────────
//  Ownership
// ─────────────────────────────────────────────────────────────

/**
 * The cleanups of what is running now: a component's setup or `onMount`, or a run of an effect. A `computed()`
 * or an `effect()` created while it runs adds its dispose, and `onCleanup()` adds its function; the component
 * runs them when it is destroyed, the effect before its next run and when it is disposed. Null anywhere else
 * (an event handler, a store module), where what is created lives until it is disposed.
 */
let _owner: (() => void)[] | null = null;

/** Runs `fn` with `owner` as the owner of what it creates, and returns its value. @internal */
export const __owning = <T>(owner: (() => void)[], fn: () => T): T => {
  const prev = _owner;
  _owner = owner;
  try {
    return fn();
  } finally {
    _owner = prev;
  }
};

/**
 * Registers `fn` to run when what is running now ends: the component whose setup or `onMount` is running, when it
 * is destroyed, or the effect whose run this is, before its next run and when it is disposed.
 *
 * @example
 * onMount: () => {
 *   window.addEventListener('resize', layout);
 *   onCleanup(() => window.removeEventListener('resize', layout));
 * },
 */
export function onCleanup(fn: () => void): void {
  if (_owner) _owner.push(fn);
  else if (typeof __THANE_DEV__ === 'undefined' || __THANE_DEV__) {
    throw new Error(
      "[thane] onCleanup() is called while a component's setup or onMount runs, or inside an effect: here nothing would call it.",
    );
  }
}

// ─────────────────────────────────────────────────────────────
//  Computed
// ─────────────────────────────────────────────────────────────

/** @internal */
let _activeTracker: { _track: (sig: Signal<unknown>) => void } | null = null;

/** Deferred computed notifications; dropped by tree-shaking when `computed()` is never imported. */
const _computedPendingQueue: (() => void)[] = [];

/**
 * Create a derived signal that auto-tracks dependencies and re-evaluates lazily.
 *
 * Dirty-marked by its sources and computed again on the next read, which is always fresh; a diamond
 * notifies the join once, with the final value.
 * Returned value is a ReadonlySignal with `.dispose()` to unsubscribe. One created in a component's setup is
 * disposed with the component, and one created in an effect's run before the effect runs again.
 *
 * @example
 * const firstName = signal('John');
 * const lastName = signal('Doe');
 * const fullName = computed(() => `${firstName()} ${lastName()}`);
 * fullName(); // 'John Doe'
 */
export function computed<T>(derivation: () => T): ReadonlySignal<T> & { dispose: () => void } {
  // Install deferred-notification flush hook on first computed creation
  _computedFlushHook ??= () => {
    if (typeof __THANE_DEV__ === 'undefined' || __THANE_DEV__) {
      // Counted, as the pending-signal drain is: a computed whose subscriber sets the computed's own
      // source runs this hook again from inside itself
      _enterDrain();
      try {
        while (_computedPendingQueue.length > 0) {
          const cbs = _computedPendingQueue.splice(0);
          for (let i = 0; i < cbs.length; i++) cbs[i]!();
        }
      } finally {
        _drainDepth--;
      }
      return;
    }
    while (_computedPendingQueue.length > 0) {
      const cbs = _computedPendingQueue.splice(0);
      for (let i = 0; i < cbs.length; i++) cbs[i]!();
    }
  };

  let value: T = undefined as T;
  let dirty = true;
  let disposed = false;
  let error: unknown = undefined;
  let hasError = false;
  // Dep map: signal → unsubscribe fn (supports O(1) differential updates)
  const depUnsubs = new Map<Signal<unknown>, () => void>();
  // Subscriber slots, kept like a signal's (sharedSubscribe, _compact); notification stays separate
  const slots: Slots<T> = { _s: [], _nc: 0, _nn: 0 };
  // The write count when the value was computed: read inside a notification pass or a batch()
  // function, where a dependency may have changed without notifying yet, a computed whose count is
  // behind computes again, so the read is fresh
  let computedAt = -1;
  // The value the subscribers were last given: a change is measured against it, not against the
  // value, which a fresh read may already have updated
  let notified: T = undefined as T;
  const notifySubs = () => {
    notified = value;
    const subscribers = slots._s;
    const len = subscribers.length;
    slots._nc++;
    for (let i = 0; i < len; i++) {
      const cb = subscribers[i]!;
      if (cb !== null) {
        try {
          cb(value);
        } catch (err) {
          queueMicrotask(() => {
            throw err;
          });
        }
      }
    }
    if (--slots._nc === 0 && slots._nn > 0) _compact(slots);
  };

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
    if (slots._s.length === slots._nn) return;
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

  /** Re-evaluate, and notify the subscribers when the value is not the one they were last given. */
  const notifyIfChanged = () => {
    pendingNotify = false;
    if (disposed || slots._s.length === slots._nn) return;
    if (dirty || computedAt !== _writes) evaluate();
    if (hasError || !Object.is(notified, value)) notifySubs();
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
    computedAt = _writes;
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
    if (disposed) return;

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
  notified = value;

  // The computed signal function — read-only
  const fn = (() => {
    if (disposed) return value;

    // Register with parent tracker (computed / effect) if one exists
    const parentTracker = _activeTracker;
    if (parentTracker !== null) {
      // Create a temporary signal-like object for tracking
      parentTracker._track(fn as unknown as Signal<unknown>);
    }

    if (dirty || (_notificationDepth > 0 && computedAt !== _writes)) {
      evaluate();
    }
    if (hasError) throw error;
    return value;
  }) as unknown as ReadonlySignal<T> & { dispose: () => void };

  // Subscribe method — mimics signal.subscribe interface
  fn.subscribe = (cb: (val: T) => void, skipInitial?: boolean): (() => void) => {
    const unsubscribe = (sharedSubscribe<T>).call(slots as SignalInternal<T>, cb, true);
    if (!skipInitial) {
      // Re-evaluate if dirty before calling subscriber
      if (dirty && !disposed) evaluate();
      notified = value;
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
    slots._s.length = 0;
    slots._nn = 0;
  };
  _owner?.push(fn.dispose);

  return fn;
}

// ─────────────────────────────────────────────────────────────
//  Effect
// ─────────────────────────────────────────────────────────────

/**
 * Auto-tracked side effect that re-runs when any read signal changes.
 * Returns a dispose function. The function may return a cleanup, which runs before the next run and when the
 * effect is disposed, as do the `onCleanup()` functions, computeds and effects of the run. An effect created in a
 * component's setup is disposed with the component.
 *
 * @example
 * const name = signal('world');
 * const dispose = effect(() => console.log(`Hello, ${name()}!`));
 * name('Thane'); // logs: "Hello, Thane!"
 * dispose();
 *
 * effect(() => {
 *   const id = setInterval(tick, delay());
 *   return () => clearInterval(id);
 * });
 */
export function effect(fn: () => void | (() => void)): () => void {
  // What the current run made, run before the next run and on dispose: first what the run created (its
  // cleanup, its onCleanup() functions, its computeds' and effects' disposes), then its dependencies' unsubscribes
  const unsubs: (() => void)[] = [];
  let disposed = false;

  // Reusable tracking objects
  const deps = new Set<Signal<unknown>>();
  const tracker = {
    _track: (sig: Signal<unknown>) => {
      deps.add(sig);
    },
  };

  const stop = () => {
    for (let i = 0; i < unsubs.length; i++) unsubs[i]!();
    unsubs.length = 0;
  };

  const run = () => {
    if (disposed) return;
    stop();

    // Track new deps
    deps.clear();
    const prev = _activeTracker;
    _activeTracker = tracker;
    try {
      const cleanup = __owning(unsubs, fn);
      if (typeof cleanup === 'function') unsubs.push(cleanup);
    } catch (err) {
      // Surface error without killing the effect — re-subscription below
      // keeps it alive for recovery on next dependency change
      queueMicrotask(() => {
        throw err;
      });
    } finally {
      _activeTracker = prev;
    }
    // Disposed by its own run: what the run made goes now
    if (disposed) return stop();

    // Subscribe to tracked deps (MUST run even after error)
    for (const dep of deps) {
      unsubs.push(dep.subscribe(run, true));
    }
  };

  run();

  const dispose = (): void => {
    disposed = true;
    stop();
  };
  _owner?.push(dispose);
  return dispose;
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
