/**
 * The modifiers of an event attribute, `@keydown.enter.prevent=${…}`: the compiler checks them when it parses the
 * template (THANE015), and compiles each into the listener.
 */

/** Key modifiers, and the `KeyboardEvent.key` values each one stands for */
export const KEY_MODIFIERS: Readonly<Record<string, readonly string[]>> = {
  enter: ['Enter'],
  tab: ['Tab'],
  delete: ['Backspace', 'Delete'],
  esc: ['Escape'],
  escape: ['Escape'],
  space: [' '],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
};

/** Modifiers that are options of the listener (`addEventListener(type, listener, { once: true })`) */
export const LISTENER_OPTIONS: readonly string[] = ['once', 'passive', 'capture'];

/** Every modifier: the guards (`prevent`, `stop`, `self`), the listener options and the keys */
export const EVENT_MODIFIERS: readonly string[] = [
  'prevent',
  'stop',
  'self',
  ...LISTENER_OPTIONS,
  ...Object.keys(KEY_MODIFIERS),
];

/** The key modifiers of a list */
export const keyModifiers = (modifiers: readonly string[]): string[] => modifiers.filter((m) => m in KEY_MODIFIERS);

/** The listener options argument a list asks for, after a comma (`, { once: true }`), or '' */
export const listenerOptions = (modifiers: readonly string[]): string => {
  const options = LISTENER_OPTIONS.filter((option) => modifiers.includes(option));
  return options.length > 0 ? `, { ${options.map((option) => `${option}: true`).join(', ')} }` : '';
};

/**
 * Whether a list row's handler with these modifiers is a listener on its element rather than the list's one
 * delegated listener: `.self` compares the event's target with the element, and the listener options apply to
 * a listener of the element's own
 */
export const needsOwnListener = (modifiers: readonly string[]): boolean =>
  modifiers.some((m) => m === 'self' || LISTENER_OPTIONS.includes(m));
