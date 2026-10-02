/**
 * The template markers: the `html` and `css` template tags and the `when()` and `repeat()` directives. The
 * compiler turns each of them into DOM code, so none of them runs in a built app; they are imported so that
 * editors, tests and the type checker know them as real symbols. Nothing is bundled for them: a component's
 * use of them is compiled away, and the import then goes unused.
 *
 * Called at run time, which only happens outside a compiled component template (in a file the
 * compiler does not compile, or under another name than the marker's own), they throw.
 */

const compiledAway = (marker: string): never => {
  throw new Error(
    `[thane] ${marker} runs only inside a component's template, which the compiler turns into DOM code. ` +
      'Use it in the template a defineComponent() setup returns, under its own name.',
  );
};

declare const fragmentBrand: unique symbol;

/**
 * An html template as a value: a component's template, a fragment of one, a row's or a branch's, a child
 * component call, a directive in a template. The compiler turns each into DOM code where it is used, so a
 * fragment has nothing to read or call; it goes where a template goes.
 */
export interface Fragment {
  readonly [fragmentBrand]: true;
}

/** What a directive takes as a template: an html template, or a plain template literal of markup */
type DirectiveTemplate = Fragment | string;

/**
 * A directive's condition: any value, read for its truthiness, but not a function. A signal is a function, and
 * one passed without its call would always be truthy and never update: `when(open())`, not `when(open)`.
 */
type Condition<T> = T extends (...args: never[]) => unknown ? never : T;

/** A value that passed a truthiness check: without `null`, `undefined`, `false`, `0` and `''` */
export type Truthy<T> = Exclude<T, null | undefined | false | 0 | 0n | ''>;

/** An HTML template: a component's markup, or a row's or a branch's. */
export function html(_strings: TemplateStringsArray, ..._values: any[]): Fragment {
  return compiledAway('html``');
}

/** A CSS template: a component's scoped styles. */
export function css(_strings: TemplateStringsArray, ..._values: any[]): string {
  return compiledAway('css``');
}

/**
 * In an element's tag, shows the element while `condition` is truthy: `<p ${when(open())}>…</p>`.
 */
export function when<T>(condition: Condition<T>): string;
/**
 * In content, shows `then` while `value` is truthy and `otherwise` (nothing when left out) while it is not:
 * `${when(open(), html`<p>Open</p>`, html`<p>Closed</p>`)}`. A function as `then` receives the value, without
 * `null` and `undefined`: `${when(user(), (u) => html`<p>${u.name}</p>`)}`.
 */
export function when<T>(
  value: Condition<T>,
  then: DirectiveTemplate | ((value: Truthy<T>) => DirectiveTemplate),
  otherwise?: DirectiveTemplate,
): Fragment;
export function when(_value: unknown, _then?: unknown, _otherwise?: unknown): Fragment | string {
  return compiledAway('when()');
}

/**
 * The names of an item's properties that can key a row: the ones whose values are strings or numbers. An item
 * that is a string or a number has none (a mapped type over a primitive would give its methods' types).
 */
type KeyProperty<T> = T extends object
  ? { [K in keyof T]-?: T[K] extends string | number ? K : never }[keyof T]
  : never;

/** How `repeat()` keys its rows and what it shows while the list is empty */
export interface RepeatOptions<T> {
  /**
   * What identifies a row's item across updates: the name of one of its properties (`'id'`), or a function of
   * the item. Without a key, rows are matched by their index.
   */
  key?: KeyProperty<T> | ((item: T, index: number) => string | number);
  /** Shown while the list is empty: one element, `html\`<li>No items</li>\`` */
  empty?: DirectiveTemplate;
}

/**
 * A list: one row per item, `${repeat(items(), (item) => html`<li>${item.name}</li>`, { key: 'id' })}`.
 */
export function repeat<T>(
  _items: readonly T[],
  _row: (item: T, index: number) => DirectiveTemplate,
  _options?: RepeatOptions<T>,
): Fragment {
  return compiledAway('repeat()');
}
