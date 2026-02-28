export type ReadonlySignal<T> = {
  (): T;
  subscribe: (callback: (value: T) => void, skipInitial?: boolean) => () => void;
};

export type Signal<T> = ReadonlySignal<T> & {
  (newValue: T): T;
};
export type ComponentRoot = HTMLElement;
