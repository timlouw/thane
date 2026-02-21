/**
 * Thane Runtime Type Definitions
 * These types define the public API that developers use.
 */

/**
 * Read-only reactive primitive. Calling with no args returns the value.
 * Cannot be set directly — used for computed signals.
 */
export type ReadonlySignal<T> = {
  (): T; // Get value
  subscribe: (callback: (value: T) => void, skipInitial?: boolean) => () => void; // Returns unsubscribe
};

/**
 * Core reactive primitive. Calling with no args returns the value,
 * calling with an arg sets the value and notifies subscribers.
 */
export type Signal<T> = ReadonlySignal<T> & {
  (newValue: T): T; // Set value
};

/**
 * The root element for component rendering.
 */
export type ComponentRoot = HTMLElement;
