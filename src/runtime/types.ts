/**
 * Thane Runtime Type Definitions
 * These types define the public API that developers use.
 */

/**
 * Core reactive primitive. Calling with no args returns the value,
 * calling with an arg sets the value and notifies subscribers.
 */
export type Signal<T> = {
  (): T;                                                    // Get value
  (newValue: T): T;                                         // Set value
  subscribe: (
    callback: (value: T) => void, 
    skipInitial?: boolean
  ) => () => void;                                          // Returns unsubscribe
};

/**
 * The root element for binding lookups (element with getElementById)
 */
export type ComponentRoot = HTMLElement & { 
  getElementById(id: string): HTMLElement | null 
};


