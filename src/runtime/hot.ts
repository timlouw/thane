/**
 * Hot swapping for a page the development server serves (`thane dev`). The server's page script sets
 * `globalThis.__thaneHot` before the app loads, and every component registered while it is set is
 * registered here too, by its selector. When a component file changes, the server sends the file,
 * compiled; it runs in the page, its components register again, and each live instance of one is
 * mounted again with the new code, into its own host with its own props. The rest of the page keeps
 * its state. A built app never sets the flag, and a production build leaves all of this out.
 *
 * The instance mounted again keeps its state: `thane dev` compiles each `const name = signal(…)` at the
 * top level of a component's setup as `__hotSignal(signal(…), 'name')`, and the new instance's signal of
 * a name the old one had starts from the old one's value. The children it mounts as it mounts take
 * theirs from the old instance's children: by selector, in the order they were on the page.
 * @internal
 */

import { untrack } from './signal.js';
import type { Signal } from './types.js';

/** A component's factory, as `__registerComponent` returns it */
interface Factory {
  __f: (target: HTMLElement, props?: any, extras?: any) => Instance;
}

/** A mounted component, as its parent (or a mount handle) holds it to destroy it */
interface Instance {
  root: HTMLElement;
  __bindingsCleanup?: (() => void) | undefined;
  __onDestroy?: (() => void) | undefined;
}

/** A live instance: where it is mounted, the cleanups of the code it runs now, and its setup's signals */
interface Live {
  selector: string;
  target: HTMLElement;
  props: any;
  extras: any;
  instance: Instance;
  bindings?: (() => void) | undefined;
  destroy?: (() => void) | undefined;
  signals: Map<string, Signal<unknown>>;
}

/** A selector's newest factory, the handle every file holds, and its live instances */
interface Entry {
  current: Factory;
  handle: Factory;
  live: Set<Live>;
}

/** What an instance passes on to the one mounted in its place: its signals, and its children's, in page order */
interface Seed {
  signals: Map<string, Signal<unknown>>;
  children: { selector: string; seed: Seed }[];
}

/** The mount that runs now: the signals its setup keeps, and what the instance it replaces passes on */
interface Mounting {
  kept: Map<string, Signal<unknown>>;
  seed: Seed | undefined;
}

/** The page's hot state, `globalThis.__thaneHot` */
export interface HotRuntime {
  components?: Map<string, Entry>;
  sheets?: Map<string, CSSStyleSheet>;
  mounting?: Mounting | undefined;
  /** The signals at the top level of component files, by module key and name */
  moduleSignals?: Map<string, Signal<unknown>>;
}

/** The hot state of a page the development server serves, or undefined */
export const hotRuntime = (): HotRuntime | undefined => (globalThis as { __thaneHot?: HotRuntime }).__thaneHot;

/**
 * A signal's value passes to the signal that replaces it, unless the two hold values of different types
 * (`0` and `'0'`): then the code changed what it holds, and the new signal keeps its initial value.
 */
const carry = (from: Signal<unknown>, to: Signal<unknown>): void => {
  const value = untrack(from);
  const initial = untrack(to);
  if (value == null || initial == null || typeof value === typeof initial) to(value);
};

/**
 * `thane dev` compiles `const count = signal(0)` at the top level of a component's setup into
 * `const count = __hotSignal(signal(0), 'count')`, and one at the top level of a component file into
 * `__hotSignal(signal(0), 'count', 'src/counter.ts')`. A signal of a name the replaced instance had, or
 * that the module had when it last ran, starts from that signal's value.
 * @internal
 */
export const __hotSignal = <T>(created: Signal<T>, name: string, module?: string): Signal<T> => {
  const hot = hotRuntime();
  const signal = created as unknown as Signal<unknown>;
  let previous: Signal<unknown> | undefined;
  if (hot && module !== undefined) {
    const kept = (hot.moduleSignals ??= new Map());
    previous = kept.get(`${module}#${name}`);
    kept.set(`${module}#${name}`, signal);
  } else if (hot?.mounting) {
    previous = hot.mounting.seed?.signals.get(name);
    hot.mounting.kept.set(name, signal);
  }
  if (previous) carry(previous, signal);
  return created;
};

/**
 * What `live` passes on: its signals, and its children's. Its children are the live instances whose
 * nearest instance host up the page is its own, in page order.
 */
const seedOf = (hot: HotRuntime, live: Live): Seed => {
  const all = [...hot.components!.values()].flatMap((entry) => [...entry.live]);
  const byHost = new Map(all.map((other) => [other.target, other]));
  const children = new Map<Live, Live[]>();
  for (const other of all) {
    let host = other.target.parentElement;
    while (host && !byHost.has(host)) host = host.parentElement;
    const parent = host && byHost.get(host);
    if (!parent) continue;
    const list = children.get(parent);
    if (list) list.push(other);
    else children.set(parent, [other]);
  }
  const seed = (of: Live): Seed => ({
    signals: of.signals,
    children: (children.get(of) ?? [])
      // 4: Node.DOCUMENT_POSITION_FOLLOWING, the other is after this one
      .sort((a, b) => (a.target.compareDocumentPosition(b.target) & 4 ? -1 : 1))
      .map((child) => ({ selector: child.selector, seed: seed(child) })),
  });
  return seed(live);
};

/**
 * Mount `factory`'s code into `target`: its setup's signals start from `seed`'s, and the children it
 * mounts meanwhile take their seeds from `seed`'s children. Returns the instance and the signals it keeps.
 */
const mountSeeded = (
  hot: HotRuntime,
  factory: Factory,
  target: HTMLElement,
  props: any,
  extras: any,
  seed: Seed | undefined,
): { fresh: Instance; kept: Map<string, Signal<unknown>> } => {
  const outer = hot.mounting;
  const mounting: Mounting = { kept: new Map(), seed };
  hot.mounting = mounting;
  try {
    return { fresh: factory.__f(target, props, extras), kept: mounting.kept };
  } finally {
    hot.mounting = outer;
  }
};

/**
 * The instance's cleanups become the ones of the code it runs now. Its parent destroys the instance
 * object it holds, so the object stays and its cleanups are replaced; running one forgets the instance.
 */
const adopt = (entry: Entry, live: Live, fresh: Instance): void => {
  live.bindings = fresh.__bindingsCleanup;
  live.destroy = fresh.__onDestroy;
  live.instance.__bindingsCleanup = () => {
    entry.live.delete(live);
    live.bindings?.();
  };
  live.instance.__onDestroy = () => {
    entry.live.delete(live);
    live.destroy?.();
  };
};

/**
 * Register a component: the first registration of a selector returns a handle that mounts the newest
 * code and keeps track of each instance; a later one (the same file, changed) makes its factory the
 * newest and mounts every live instance again with it, each from its own state.
 */
export const hotRegister = (hot: HotRuntime, selector: string, factory: Factory): Factory => {
  const components = (hot.components ??= new Map());
  const existing = components.get(selector);
  if (!existing) {
    const entry: Entry = {
      current: factory,
      live: new Set(),
      handle: {
        __f: (target, props, extras) => {
          // A child that a parent mounts as it mounts again takes the seed of the parent's old child of its
          // selector: the first one not taken yet
          const siblings = hot.mounting?.seed?.children;
          const at = siblings ? siblings.findIndex((child) => child.selector === selector) : -1;
          const seed = at === -1 ? undefined : siblings!.splice(at, 1)[0]!.seed;
          const { fresh, kept } = mountSeeded(hot, entry.current, target, props, extras, seed);
          const live: Live = { selector, target, props, extras, instance: { root: fresh.root }, signals: kept };
          entry.live.add(live);
          adopt(entry, live, fresh);
          return live.instance;
        },
      },
    };
    components.set(selector, entry);
    return entry.handle;
  }
  existing.current = factory;
  for (const live of [...existing.live]) {
    // An instance inside one swapped before it (a component that nests itself) was mounted again with it
    if (!existing.live.has(live)) continue;
    // An instance whose host left the page without being destroyed is forgotten
    if (!live.target.isConnected) {
      existing.live.delete(live);
      continue;
    }
    const seed = seedOf(hot, live);
    live.bindings?.();
    live.destroy?.();
    live.target.innerHTML = '';
    const { fresh, kept } = mountSeeded(hot, factory, live.target, live.props, live.extras, seed);
    live.signals = kept;
    adopt(existing, live, fresh);
  }
  return existing.handle;
};

/** A selector's stylesheet: added once, and replaced when the component's file changes */
export const hotStyles = (hot: HotRuntime, selector: string, scopedCss: string): void => {
  const sheets = (hot.sheets ??= new Map());
  let sheet = sheets.get(selector);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheets.set(selector, sheet);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(scopedCss);
};
