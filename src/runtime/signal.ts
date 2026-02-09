/**
 * Signal implementation - core reactive primitive
 * 
 * A signal is a reactive value container. Calling with no args returns the value,
 * calling with an arg sets the value and notifies subscribers.
 * 
 * Uses a shared subscribe function to reduce per-signal memory allocation.
 * Instead of creating a new closure per signal, all signals share one subscribe
 * function that reads state from properties on the signal function object.
 */

import type { Signal } from './types.js';

/**
 * Shared subscribe function — assigned to every signal, uses `this` to access
 * the signal's internal state (_v for value, _s for subscribers array).
 */
function sharedSubscribe<T>(
  this: Signal<T> & { _v: T; _s: ((val: T) => void)[] | null },
  callback: (val: T) => void,
  skipInitial?: boolean
): () => void {
  if (!this._s) this._s = [];
  this._s.push(callback);

  // Call with current value unless skipInitial is true
  if (!skipInitial) {
    callback(this._v);
  }

  // Return unsubscribe function — capture `this` via arrow or local
  const self = this;
  return () => {
    if (self._s) {
      const idx = self._s.indexOf(callback);
      if (idx !== -1) self._s.splice(idx, 1);
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
      return fn._v;
    }
    
    // Set value and notify subscribers when value changes
    if (fn._v !== newValue) {
      fn._v = newValue!;
      if (fn._s) {
        const subs = fn._s;
        const len = subs.length;
        if (len === 1) {
          subs[0]!(fn._v);
        } else {
          for (let i = 0; i < len; i++) {
            subs[i]!(fn._v);
          }
        }
      }
    }
    return fn._v;
  } as Signal<T> & { _v: T; _s: ((val: T) => void)[] | null };

  // Per-signal state stored as properties instead of closure variables
  fn._v = initialValue;
  fn._s = null;

  // Shared subscribe function — one function object referenced by all signals
  fn.subscribe = sharedSubscribe;

  return fn as Signal<T>;
};
