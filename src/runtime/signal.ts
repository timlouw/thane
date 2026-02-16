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
 */

import type { Signal } from './types.js';

/**
 * Internal shape of a signal function object.
 * @internal
 */
type SignalInternal<T> = Signal<T> & {
  _v: T;                          // current value
  _s: ((val: T) => void)[];       // subscribers (may contain nulls mid-notification)
  _nc: number;                    // notification depth counter (0 = idle)
};

/**
 * Shared subscribe function — assigned to every signal, uses `this` to access
 * the signal's internal state (_v for value, _s for subscribers array).
 */
function sharedSubscribe<T>(
  this: SignalInternal<T>,
  callback: (val: T) => void,
  skipInitial?: boolean,
): () => void {
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
    if (fn._v !== newValue) {
      fn._v = newValue!;
      const subs = fn._s;
      const len = subs.length;
      if (len > 0) {
        // Increment depth counter — allows nested signal updates (subscriber
        // sets another signal which re-enters this code path) while keeping
        // the unsubscribe null-slot strategy safe.
        fn._nc++;
        for (let i = 0; i < len; i++) {
          const cb = subs[i];
          if (cb != null) {
            try {
              cb(fn._v);
            } catch (err) {
              // Prevent one failing subscriber from killing subsequent ones.
              // Queue error report on the microtask to avoid swallowing it.
              queueMicrotask(() => {
                console.error('[thane] Signal subscriber threw:', err);
              });
            }
          }
        }
        if (--fn._nc === 0) {
          // Outermost notification finished — compact null slots left by
          // mid-notification unsubscribes.  Skip leading live entries so the
          // common case (no mutations) exits immediately without any writes.
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
      }
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

// ─────────────────────────────────────────────────────────────
//  Batching — defers subscriber notifications until batch ends
// ─────────────────────────────────────────────────────────────

/** Active batch depth counter — 0 means not batching */
let _batchDepth = 0;

/** Pending signal flush callbacks queued during a batch */
const _pendingFlushes: (() => void)[] = [];

/**
 * Batch multiple signal updates so subscriber notifications fire only once
 * after the batch completes. Batches can be nested; notifications flush
 * when the outermost batch ends.
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
    _batchDepth--;
    if (_batchDepth === 0) {
      const fns = _pendingFlushes.splice(0);
      for (let i = 0; i < fns.length; i++) {
        fns[i]!();
      }
    }
  }
}

/**
 * Internal: check if currently inside a batch.
 * @internal
 */
export function _isBatching(): boolean {
  return _batchDepth > 0;
}

/**
 * Internal: queue a flush callback during a batch.
 * @internal
 */
export function _queueFlush(fn: () => void): void {
  _pendingFlushes.push(fn);
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
 * Called by signal reads during tracking to register a dependency.
 * @internal
 */
export function _getActiveTracker(): { _track: (sig: Signal<unknown>) => void } | null {
  return _activeTracker;
}

/**
 * Create a computed (derived) signal that automatically tracks its
 * signal dependencies and re-evaluates when any of them change.
 *
 * The returned value is a read-only signal — calling it returns the
 * current derived value but does not accept a setter argument.
 *
 * Tree-shakable: if your app never imports `computed`, this code is
 * eliminated by esbuild.
 *
 * @param derivation - Function that reads one or more signals and returns a derived value
 * @returns A read-only Signal containing the derived value
 *
 * @example
 * const firstName = signal('John');
 * const lastName = signal('Doe');
 * const fullName = computed(() => `${firstName()} ${lastName()}`);
 * fullName(); // 'John Doe'
 * firstName('Jane');
 * fullName(); // 'Jane Doe'
 */
export function computed<T>(derivation: () => T): Signal<T> {
  const inner = signal<T>(undefined as T);
  const unsubs: (() => void)[] = [];

  // Reusable tracking objects — allocated once, reused on every recompute.
  // Avoids creating a new Set, tracker object, and arrow functions on each
  // re-evaluation, which matters for deeply nested component trees where
  // computed values re-evaluate frequently.
  const deps = new Set<Signal<unknown>>();
  const tracker = { _track: (sig: Signal<unknown>) => { deps.add(sig); } };

  const recompute = () => {
    // Unsubscribe from old dependencies
    for (let i = 0; i < unsubs.length; i++) unsubs[i]!();
    unsubs.length = 0;

    // Track new dependencies (reuse existing Set)
    deps.clear();
    const prev = _activeTracker;
    _activeTracker = tracker;
    try {
      inner(derivation());
    } finally {
      _activeTracker = prev;
    }

    // Subscribe to all tracked dependencies — pass `recompute` directly
    // instead of wrapping in `() => recompute()` to avoid one closure per dep.
    for (const dep of deps) {
      unsubs.push(dep.subscribe(recompute, true));
    }
  };

  recompute();

  // Return a read-only wrapper that proxies to inner
  const readOnly = (() => inner()) as Signal<T>;
  readOnly.subscribe = (cb: (val: T) => void, skipInitial?: boolean) => inner.subscribe(cb, skipInitial);
  return readOnly;
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
  const tracker = { _track: (sig: Signal<unknown>) => { deps.add(sig); } };

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
    } finally {
      _activeTracker = prev;
    }

    // Subscribe to all tracked dependencies — pass `run` directly
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
