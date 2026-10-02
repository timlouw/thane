export type ReadonlySignal<T> = {
  (): T;
  subscribe: (callback: (value: T) => void, skipInitial?: boolean) => () => void;
};

declare const writable: unique symbol;

/**
 * A signal: read it with `signal()`, set it with `signal(value)`. A ReadonlySignal (a computed) is not one: the brand,
 * which exists only in the types, keeps one from being passed where a signal is written (`bind:value`, a
 * `Signal<T>` prop).
 */
export type Signal<T> = ReadonlySignal<T> & {
  (newValue: T): T;
  readonly [writable]: true;
};
export type ComponentRoot = HTMLElement;
