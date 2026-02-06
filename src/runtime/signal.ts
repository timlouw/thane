/**
 * Signal implementation - core reactive primitive
 * 
 * A signal is a reactive value container. Calling with no args returns the value,
 * calling with an arg sets the value and notifies subscribers.
 */

import type { Signal } from './types.js';

/**
 * Create a reactive signal with an initial value
 * 
 * @param initialValue - The initial value of the signal
 * @returns A signal function that gets/sets the value
 */
export const signal = <T>(initialValue: T): Signal<T> => {
  let value = initialValue;
  let subscribers: ((val: T) => void)[] | null = null;

  // Use rest parameter to detect "no argument" calls. V8 optimizes rest
  // parameters well (unlike the `arguments` object which deoptimizes).
  const sig = (...args: [] | [T]): T => {
    // Get value when called with no arguments
    if (args.length === 0) {
      return value;
    }
    
    const newValue = args[0] as T;
    // Set value and notify subscribers when value changes
    if (value !== newValue) {
      value = newValue;
      if (subscribers) {
        const subs = subscribers;
        for (let i = 0, len = subs.length; i < len; i++) {
          subs[i]!(value);
        }
      }
    }
    return value;
  };

  /**
   * Subscribe to value changes
   * 
   * @param callback - Function to call when value changes
   * @param skipInitial - If true, don't call callback with current value immediately
   * @returns Unsubscribe function
   */
  (sig as Signal<T>).subscribe = (
    callback: (val: T) => void, 
    skipInitial?: boolean
  ): (() => void) => {
    if (!subscribers) subscribers = [];
    subscribers.push(callback);
    
    // Call with current value unless skipInitial is true
    if (!skipInitial) {
      callback(value);
    }
    
    // Return unsubscribe function — uses O(1) swap-and-pop instead of
    // O(n) splice, since subscriber notification order is not guaranteed.
    return () => {
      if (subscribers) {
        const idx = subscribers.indexOf(callback);
        if (idx !== -1) {
          const last = subscribers.length - 1;
          if (idx !== last) subscribers[idx] = subscribers[last]!;
          subscribers.length = last;
        }
      }
    };
  };

  return sig as Signal<T>;
};
