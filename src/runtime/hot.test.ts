/**
 * Hot swapping (hot.ts), over fake hosts: a selector's first registration returns a handle that mounts
 * its newest code; a later one mounts every live instance again with the new code, into the same host
 * with the same props, after running the old code's cleanups. The instance object a parent holds stays,
 * and destroying it runs the newest cleanups and forgets it. The instance mounted again keeps its state:
 * its setup's signals start from the old instance's of their names, and its children's from the old children's.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { __hotSignal, hotRegister, type HotRuntime } from './hot.js';
import { signal } from './signal.js';
import type { Signal } from './types.js';

let log: string[] = [];

/** A host element: its content, and whether it is in the page */
const host = (connected = true) => ({ innerHTML: '', isConnected: connected }) as unknown as HTMLElement;

/** A factory whose instances log their mount and cleanups under `version` */
const factory = (version: string) => ({
  __f: (target: HTMLElement, props?: { n: number }) => {
    target.innerHTML = `${version}:${props?.n}`;
    log.push(`mount ${version} ${props?.n}`);
    return {
      root: target,
      __bindingsCleanup: () => log.push(`bindings ${version} ${props?.n}`),
      __onDestroy: () => log.push(`destroy ${version} ${props?.n}`),
    };
  },
});

/** What a parent does to destroy a child it holds (`__dc`) */
const destroy = (instance: {
  __bindingsCleanup?: (() => void) | undefined;
  __onDestroy?: (() => void) | undefined;
}) => {
  instance.__bindingsCleanup?.();
  instance.__onDestroy?.();
};

describe('hot swapping', () => {
  test('a registration again mounts every live instance with the new code, in place', () => {
    log = [];
    const hot: HotRuntime = {};
    const handle = hotRegister(hot, 'x-card', factory('v1'));
    const [a, b] = [host(), host()];
    const first = handle.__f(a, { n: 1 });
    handle.__f(b, { n: 2 });
    expect(log).toEqual(['mount v1 1', 'mount v1 2']);

    log = [];
    expect(hotRegister(hot, 'x-card', factory('v2'))).toBe(handle);
    expect(log).toEqual(['bindings v1 1', 'destroy v1 1', 'mount v2 1', 'bindings v1 2', 'destroy v1 2', 'mount v2 2']);
    expect(a.innerHTML).toBe('v2:1');

    // The parent's instance runs the new code's cleanups, and is forgotten
    log = [];
    destroy(first);
    expect(log).toEqual(['bindings v2 1', 'destroy v2 1']);
    hotRegister(hot, 'x-card', factory('v3'));
    expect(log).toEqual(['bindings v2 1', 'destroy v2 1', 'bindings v2 2', 'destroy v2 2', 'mount v3 2']);
  });

  test('a new mount after a swap runs the newest code; other selectors are untouched', () => {
    log = [];
    const hot: HotRuntime = {};
    const card = hotRegister(hot, 'x-card', factory('card'));
    hotRegister(hot, 'x-other', factory('other')).__f(host(), { n: 9 });
    hotRegister(hot, 'x-card', factory('card2'));
    card.__f(host(), { n: 3 });
    expect(log).toEqual(['mount other 9', 'mount card2 3']);
  });

  test('an instance whose host left the page without being destroyed is forgotten', () => {
    log = [];
    const hot: HotRuntime = {};
    const target = host();
    hotRegister(hot, 'x-card', factory('v1')).__f(target, { n: 1 });
    (target as unknown as { isConnected: boolean }).isConnected = false;
    log = [];
    hotRegister(hot, 'x-card', factory('v2'));
    expect(log).toEqual([]);
    expect(hot.components!.get('x-card')!.live.size).toBe(0);
  });
});

describe('a swapped instance keeps its state', () => {
  /** A host in a fake page: the host it is in, and its place in the page */
  interface PageHost {
    innerHTML: string;
    isConnected: boolean;
    parentElement: PageHost | null;
    at: number;
    compareDocumentPosition(other: PageHost): number;
  }
  let place = 0;
  const pageHost = (parent: HTMLElement | null = null): HTMLElement => {
    const self: PageHost = {
      innerHTML: '',
      isConnected: true,
      parentElement: parent as unknown as PageHost | null,
      at: place++,
      // Node.DOCUMENT_POSITION_FOLLOWING or PRECEDING
      compareDocumentPosition: (other) => (other.at > self.at ? 4 : 2),
    };
    return self as unknown as HTMLElement;
  };

  /** The page's hot state, set as the dev server's page script sets it */
  const page = (): HotRuntime => ((globalThis as { __thaneHot?: HotRuntime }).__thaneHot = {});
  afterEach(() => delete (globalThis as { __thaneHot?: HotRuntime }).__thaneHot);

  /** The signals of a setup, by name */
  type Signals = Partial<Record<'count' | 'label' | 'added' | 'picked' | 'name' | 'after', Signal<any>>>;
  /** The signals each mount's setup made, by its version, in mount order */
  let made: { version: string; signals: Signals }[] = [];
  const latest = (version: string) => made.filter((m) => m.version === version).map((m) => m.signals);

  /**
   * A factory whose setup declares `signals` (name → initial value) as `thane dev` compiles them, then mounts
   * `children` into hosts of its own, which its destroy destroys
   */
  const component = (
    version: string,
    signals: { [name in keyof Signals]?: unknown },
    children: () => { __f: (target: HTMLElement) => any }[] = () => [],
  ) => ({
    __f: (target: HTMLElement) => {
      const own: Signals = {};
      for (const [name, initial] of Object.entries(signals)) {
        own[name as keyof Signals] = __hotSignal(signal(initial), name);
      }
      made.push({ version, signals: own });
      const mounted = children().map((child) => child.__f(pageHost(target)));
      return { root: target, __onDestroy: () => mounted.forEach(destroy) };
    },
  });

  test("its setup's signals start from the old instance's values, by name; a new one from its initial value", () => {
    const hot = page();
    made = [];
    const handle = hotRegister(hot, 'x-count', component('v1', { count: 0, label: 'a' }));
    handle.__f(pageHost());
    handle.__f(pageHost());
    const [first, second] = latest('v1');
    first!.count!(5);
    second!.count!(7);
    first!.label!('b');

    hotRegister(hot, 'x-count', component('v2', { count: 0, label: 'a', added: true }));
    expect(latest('v2').map((s) => [s.count!(), s.label!(), s.added!()])).toEqual([
      [5, 'b', true],
      [7, 'a', true],
    ]);
    // And again, from the second version's signals
    latest('v2')[0]!.count!(6);
    hotRegister(hot, 'x-count', component('v3', { count: 0 }));
    expect(latest('v3').map((s) => s.count!())).toEqual([6, 7]);
  });

  test('a value of another type than the new initial one is dropped; null and undefined pass either way', () => {
    const hot = page();
    made = [];
    hotRegister(hot, 'x-typed', component('v1', { count: 0, picked: null, name: 'n' })).__f(pageHost());
    const [old] = latest('v1');
    old!.count!(3);
    old!.picked!('item');
    old!.name!(null);
    hotRegister(hot, 'x-typed', component('v2', { count: '', picked: null, name: 'n' }));
    const [now] = latest('v2');
    expect([now!.count!(), now!.picked!(), now!.name!()]).toEqual(['', 'item', null]);
  });

  test("children mounted as the parent mounts again take the old children's state: by selector, in page order", () => {
    const hot = page();
    made = [];
    const item = hotRegister(hot, 'x-item', component('item', { count: 0 }));
    const other = hotRegister(hot, 'x-other', component('other', { count: 0 }));
    const parent = hotRegister(
      hot,
      'x-parent',
      component('p1', { count: 0 }, () => [item, item, other]),
    );
    parent.__f(pageHost());
    const [a, b] = latest('item');
    a!.count!(1);
    b!.count!(2);
    latest('other')[0]!.count!(9);

    // The new parent mounts the other child first: each item still takes the state of the item in its place
    made = [];
    hotRegister(
      hot,
      'x-parent',
      component('p2', { count: 0 }, () => [other, item, item]),
    );
    expect(latest('item').map((s) => s.count!())).toEqual([1, 2]);
    expect(latest('other').map((s) => s.count!())).toEqual([9]);
    // A third item has no old one to take from
    made = [];
    hotRegister(
      hot,
      'x-parent',
      component('p3', { count: 0 }, () => [item, item, item]),
    );
    expect(latest('item').map((s) => s.count!())).toEqual([1, 2, 0]);
  });

  test('a child mounted after its parent mounted (a branch shown later) is found by its host', () => {
    const hot = page();
    made = [];
    const item = hotRegister(hot, 'x-late', component('late', { count: 0 }));
    const parent = hotRegister(hot, 'x-holder', component('h1', {}));
    const host = pageHost();
    parent.__f(host);
    item.__f(pageHost(host));
    latest('late')[0]!.count!(4);
    made = [];
    hotRegister(
      hot,
      'x-holder',
      component('h2', {}, () => [item]),
    );
    expect(latest('late').map((s) => s.count!())).toEqual([4]);
  });

  test("a parent's signal declared after its children mounted is still its own", () => {
    const hot = page();
    made = [];
    const child = hotRegister(hot, 'x-leaf', component('leaf', { count: 0 }));
    const late = (version: string) => ({
      __f: (target: HTMLElement) => {
        const mounted = child.__f(pageHost(target));
        made.push({ version, signals: { after: __hotSignal(signal(0), 'after') } });
        return { root: target, __onDestroy: () => destroy(mounted) };
      },
    });
    hotRegister(hot, 'x-after', late('a1')).__f(pageHost());
    latest('a1')[0]!.after!(8);
    latest('leaf')[0]!.count!(2);
    made = [];
    hotRegister(hot, 'x-after', late('a2'));
    expect(latest('a2')[0]!.after!()).toBe(8);
    expect(latest('leaf')[0]!.count!()).toBe(2);
  });

  test("a component file's own signals keep their values when the file runs again, by module and name", () => {
    page();
    const total = __hotSignal(signal(0), 'total', 'src/a.ts');
    total(4);
    expect(__hotSignal(signal(0), 'total', 'src/a.ts')()).toBe(4);
    expect(__hotSignal(signal(0), 'total', 'src/b.ts')()).toBe(0);
  });

  test('without the hot state, or outside a mount, a signal is left as it is', () => {
    const created = signal(1);
    expect(__hotSignal(created, 'count')).toBe(created);
    const hot = page();
    expect(__hotSignal(signal(2), 'count')()).toBe(2);
    expect(hot.mounting).toBeUndefined();
  });
});
