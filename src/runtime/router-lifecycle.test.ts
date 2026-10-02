/**
 * Characterisation of the router's lifecycle, scroll restoration and route context with a fake
 * browser.
 *
 * router.ts has little other unit coverage; the e2e router suite covers it in a
 * browser, but only with `scrollRestoration: true`. These tests pin, as an operation log over a fake
 * `window` / `document`, what `startRouter`, `navigate`, popstate and `stopRouter` do for every
 * shape of the scroll-restoration option (`normalizeScrollRestoration`), for every shape
 * of `history.state` (`readScrollPositionFromHistoryState`), the globals the router
 * installs, the route-context provider, and the two router mounts: `mount(Shell, { routes })` and `mount(Routes)`.
 *
 * Not pinned on purpose: a scroll state whose `__thaneScroll` is a function. History states are
 * structured clones, which cannot hold functions.
 *
 * Every test restores the module state it touched: `teardown()` stops the router with an empty
 * path and title, so `currentPath()` is '' again for router.test.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { __registerComponentLean, mount } from './component.js';
import { defineRoutes, navigate, navigateBack, startRouter, stopRouter, currentPath } from './router.js';
import type { Route, RoutesMap } from './router.js';
import { searchFlag, searchNumber, searchOneOf, searchString } from './router-search.js';

// ─────────────────────────────────────────────────────────────
//  Fake browser with an operation log
// ─────────────────────────────────────────────────────────────

let log: string[] = [];
let rafs: Array<() => void> = [];
const g = globalThis as any;

class FakeElement {
  private _className = '';
  private _innerHTML = '';
  children = new Map<string, FakeElement>();
  classList = {
    add: (cls: string): void => {
      this._className = this._className ? `${this._className} ${cls}` : cls;
    },
  };
  constructor(public name: string) {}
  get className(): string {
    return this._className;
  }
  set className(v: string) {
    this._className = v;
  }
  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(v: string) {
    log.push(`${this.name}.innerHTML = ${JSON.stringify(v)}`);
    this._innerHTML = v;
  }
  querySelector(sel: string): FakeElement | null {
    return this.children.get(sel) ?? null;
  }
}

interface Browser {
  window: any;
  document: any;
  listeners: Map<string, Array<(e?: any) => void>>;
  setUrl(url: string): void;
}

const fmt = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === 'number' && Number.isNaN(x) ? 'NaN' : x));

const install = (url: string, state: unknown = null, scroll = { x: 11, y: 22 }): Browser => {
  const location = { href: '', pathname: '', search: '', hash: '' };
  const setUrl = (u: string) => {
    const next = new URL(u, location.href || 'http://app.test/');
    location.href = next.href;
    location.pathname = next.pathname;
    location.search = next.search;
    location.hash = next.hash;
  };
  setUrl(url);
  let scrollRestoration = 'auto';
  const history = {
    state,
    get scrollRestoration() {
      return scrollRestoration;
    },
    set scrollRestoration(v: string) {
      log.push(`history.scrollRestoration = ${v}`);
      scrollRestoration = v;
    },
    pushState(s: unknown, _t: string, u: string) {
      log.push(`pushState ${fmt(s)} ${u}`);
      history.state = structuredClone(s);
      setUrl(u);
    },
    replaceState(s: unknown, _t: string, u: string) {
      log.push(`replaceState ${fmt(s)} ${u}`);
      history.state = structuredClone(s);
      setUrl(u);
    },
    back() {
      log.push('history.back');
    },
  };
  const listeners = new Map<string, Array<(e?: any) => void>>();
  const window = {
    location,
    history,
    scrollX: scroll.x,
    scrollY: scroll.y,
    addEventListener(type: string, fn: (e?: any) => void, opts?: unknown) {
      log.push(`addEventListener ${type}${opts ? ` ${fmt(opts)}` : ''}`);
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: (e?: any) => void) {
      log.push(`removeEventListener ${type}`);
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn),
      );
    },
    scrollTo(opts: unknown) {
      log.push(`scrollTo ${fmt(opts)}`);
    },
  };
  const elements = new Map<string, FakeElement>();
  const document = {
    title: 'Doc',
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelector: (selector: string) => elements.get(selector) ?? null,
    elements,
  };
  g.window = window;
  g.document = document;
  g.requestAnimationFrame = (fn: () => void) => {
    rafs.push(fn);
    return rafs.length;
  };
  return { window, document, listeners, setUrl };
};

/** Stops the router with an empty path and title (the state router.test.ts expects) and removes the fakes. */
const teardown = () => {
  if (g.window) {
    g.window.location.pathname = '';
    g.window.location.search = '';
    g.window.location.hash = '';
    g.document.title = '';
    stopRouter();
  }
  delete g.window;
  delete g.document;
  delete g.requestAnimationFrame;
  rafs = [];
  log = [];
};

afterEach(teardown);

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

const runRafs = () => {
  const pending = rafs;
  rafs = [];
  for (const fn of pending) fn();
};

/** A page component that logs its mount (with the route it received) and its destroy. */
const page = (name: string, seen?: { route?: any }) =>
  ({
    __f: (target: any, _props: unknown, extras?: { route?: any }) => {
      log.push(`mount ${name} into ${target.name}`);
      if (seen) seen.route = extras?.route;
      target.classList.add(name);
      return { root: target, __onDestroy: () => log.push(`destroy ${name}`) };
    },
  }) as any;

const routes = (): { routes: RoutesMap; notFound: Route } => ({
  routes: { '/a': { component: page('A') }, '/b': { component: page('B') } },
  notFound: { component: page('NF') },
});

/** Start at /a, navigate to /b, then go back to /a with the given popstate state. */
const scenario = async (routerConfig: unknown, popState: unknown = null): Promise<string[]> => {
  const b = install('http://app.test/a');
  const outlet = new FakeElement('outlet');
  if (routerConfig === 'none') startRouter(routes(), outlet as any);
  else startRouter(routes(), outlet as any, routerConfig as any);
  await settle();
  log.push('--- navigate /b');
  navigate('/b');
  await settle();
  log.push('--- back to /a');
  b.setUrl('/a');
  b.window.history.state = popState;
  for (const fn of b.listeners.get('popstate') ?? []) fn({ state: popState });
  await settle();
  log.push('--- rafs');
  runRafs();
  log.push('--- stop');
  stopRouter();
  const out = log;
  log = [];
  return out;
};

// ─────────────────────────────────────────────────────────────
//  Scroll-restoration option
// ─────────────────────────────────────────────────────────────

describe('scroll restoration option', () => {
  const enabledDefault = [
    'history.scrollRestoration = manual',
    'replaceState {"__thaneScroll":{"left":11,"top":22}} http://app.test/a',
    'addEventListener scroll {"passive":true}',
    'addEventListener popstate',
    'addEventListener click',
    'outlet.innerHTML = ""',
    'mount A into outlet',
    '--- navigate /b',
    'replaceState {"__thaneScroll":{"left":11,"top":22}} http://app.test/a',
    'pushState {"__thaneScroll":{"left":0,"top":0}} /b',
    'destroy A',
    'outlet.innerHTML = ""',
    'outlet.innerHTML = ""',
    'mount B into outlet',
    'scrollTo {"left":0,"top":0,"behavior":"auto"}',
    '--- back to /a',
    'destroy B',
    'outlet.innerHTML = ""',
    'outlet.innerHTML = ""',
    'mount A into outlet',
    'scrollTo {"left":11,"top":22,"behavior":"auto"}',
    '--- rafs',
    'scrollTo {"left":11,"top":22,"behavior":"auto"}',
    '--- stop',
    'destroy A',
    'outlet.innerHTML = ""',
    'outlet.innerHTML = ""',
    'removeEventListener popstate',
    'removeEventListener click',
    'removeEventListener scroll',
    'history.scrollRestoration = auto',
  ];

  test('no router config, undefined, true and {} all give the enabled defaults', async () => {
    for (const config of ['none', undefined, { scrollRestoration: undefined }, { scrollRestoration: true }, {}]) {
      expect(await scenario(config)).toEqual(enabledDefault);
    }
    expect(await scenario({ scrollRestoration: {} })).toEqual(enabledDefault);
  });

  test('false: nothing is saved, reset or restored, and navigate pushes no scroll state', async () => {
    expect(await scenario({ scrollRestoration: false })).toEqual([
      'addEventListener popstate',
      'addEventListener click',
      'outlet.innerHTML = ""',
      'mount A into outlet',
      '--- navigate /b',
      'pushState null /b',
      'destroy A',
      'outlet.innerHTML = ""',
      'outlet.innerHTML = ""',
      'mount B into outlet',
      '--- back to /a',
      'destroy B',
      'outlet.innerHTML = ""',
      'outlet.innerHTML = ""',
      'mount A into outlet',
      '--- rafs',
      '--- stop',
      'destroy A',
      'outlet.innerHTML = ""',
      'outlet.innerHTML = ""',
      'removeEventListener popstate',
      'removeEventListener click',
    ]);
  });

  test('custom offsets and behaviour are used for the reset and the pushed state', async () => {
    const out = await scenario({ scrollRestoration: { behavior: 'smooth', left: 5, top: 7 } });
    expect(out.filter((l) => l.startsWith('pushState') || l.startsWith('scrollTo'))).toEqual([
      'pushState {"__thaneScroll":{"left":5,"top":7}} /b',
      'scrollTo {"left":5,"top":7,"behavior":"smooth"}',
      'scrollTo {"left":11,"top":22,"behavior":"smooth"}',
      'scrollTo {"left":11,"top":22,"behavior":"smooth"}',
    ]);
  });

  test('explicit zeros and undefined fields keep the defaults', async () => {
    const out = await scenario({ scrollRestoration: { left: 0, top: undefined, behavior: undefined } });
    expect(out).toEqual(enabledDefault);
  });

  test('resetOnNavigate: false keeps the offset on navigate; back/forward still restores', async () => {
    const out = await scenario({ scrollRestoration: { resetOnNavigate: false, left: 3 } });
    expect(out.filter((l) => l.startsWith('pushState') || l.startsWith('scrollTo'))).toEqual([
      'pushState {"__thaneScroll":{"left":3,"top":0}} /b',
      'scrollTo {"left":11,"top":22,"behavior":"auto"}',
      'scrollTo {"left":11,"top":22,"behavior":"auto"}',
    ]);
  });

  test('restoreOnBackForward: false resets on navigate and does nothing on back/forward', async () => {
    const out = await scenario({ scrollRestoration: { restoreOnBackForward: false } });
    expect(out.filter((l) => l.startsWith('pushState') || l.startsWith('scrollTo'))).toEqual([
      'pushState {"__thaneScroll":{"left":0,"top":0}} /b',
      'scrollTo {"left":0,"top":0,"behavior":"auto"}',
    ]);
  });

  test('both flags false: an enabled router that never scrolls', async () => {
    const out = await scenario({ scrollRestoration: { restoreOnBackForward: false, resetOnNavigate: false } });
    expect(out.filter((l) => l.startsWith('scrollTo'))).toEqual([]);
    expect(out).toContain('history.scrollRestoration = manual');
    expect(out).toContain('addEventListener scroll {"passive":true}');
  });

  test('a non-object, non-boolean value counts as enabled with the defaults', async () => {
    expect(await scenario({ scrollRestoration: 1 })).toEqual(enabledDefault);
    expect(await scenario({ scrollRestoration: 'yes' })).toEqual(enabledDefault);
  });

  test('null counts as enabled with the defaults', async () => {
    expect(await scenario({ scrollRestoration: null })).toEqual(enabledDefault);
  });

  test('after stopRouter the defaults apply again', async () => {
    await scenario({ scrollRestoration: { left: 5, top: 7, behavior: 'smooth' } });
    install('http://app.test/a');
    navigate('/z');
    expect(log).toEqual([
      'replaceState {"__thaneScroll":{"left":11,"top":22}} http://app.test/a',
      'pushState {"__thaneScroll":{"left":0,"top":0}} /z',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
//  history.state shapes
// ─────────────────────────────────────────────────────────────

describe('scroll position read from history.state', () => {
  // Where back/forward to /a scrolls for a popstate carrying the state: {11,22} is the position
  // saved when /a was left, used whenever the state holds no valid position.
  const cases: Array<[string, unknown, string]> = [
    ['null', null, '{"left":11,"top":22}'],
    ['undefined', undefined, '{"left":11,"top":22}'],
    ['a string', 'x', '{"left":11,"top":22}'],
    ['a number', 42, '{"left":11,"top":22}'],
    ['an object without the key', { other: 1 }, '{"left":11,"top":22}'],
    ['key null', { __thaneScroll: null }, '{"left":11,"top":22}'],
    ['key a number', { __thaneScroll: 0 }, '{"left":11,"top":22}'],
    ['key a string', { __thaneScroll: 'x' }, '{"left":11,"top":22}'],
    ['key an array', { __thaneScroll: [1, 2] }, '{"left":11,"top":22}'],
    ['key {}', { __thaneScroll: {} }, '{"left":11,"top":22}'],
    ['left only', { __thaneScroll: { left: 1 } }, '{"left":11,"top":22}'],
    ['left a string', { __thaneScroll: { left: '1', top: 2 } }, '{"left":11,"top":22}'],
    ['top a string', { __thaneScroll: { left: 1, top: '2' } }, '{"left":11,"top":22}'],
    ['numbers', { __thaneScroll: { left: 1, top: 2 } }, '{"left":1,"top":2}'],
    ['numbers and more keys', { __thaneScroll: { left: 1, top: 2, extra: true }, other: 3 }, '{"left":1,"top":2}'],
    ['NaN is a number', { __thaneScroll: { left: Number.NaN, top: 0 } }, '{"left":"NaN","top":0}'],
    ['inherited key', Object.create({ __thaneScroll: { left: 3, top: 4 } }), '{"left":3,"top":4}'],
  ];

  for (const [name, state, target] of cases) {
    test(name, async () => {
      const out = await scenario(undefined, state);
      const afterBack = out.slice(out.indexOf('--- back to /a') + 1, out.indexOf('--- stop'));
      expect(afterBack.filter((l) => l.startsWith('scrollTo'))).toEqual([
        `scrollTo ${target.slice(0, -1)},"behavior":"auto"}`,
        `scrollTo ${target.slice(0, -1)},"behavior":"auto"}`,
      ]);
    });
  }

  test('a popstate event without a state (event undefined) falls back to the saved position', async () => {
    const b = install('http://app.test/a');
    startRouter(routes(), new FakeElement('outlet') as any);
    await settle();
    navigate('/b');
    await settle();
    b.setUrl('/a');
    log = [];
    for (const fn of b.listeners.get('popstate') ?? []) fn(undefined);
    await settle();
    expect(log.filter((l) => l.startsWith('scrollTo'))).toEqual(['scrollTo {"left":11,"top":22,"behavior":"auto"}']);
  });

  test('a valid state at start restores on the initial load (rAF and a 100 ms timer too)', async () => {
    install('http://app.test/a', { __thaneScroll: { left: 7, top: 8 } });
    startRouter(routes(), new FakeElement('outlet') as any);
    await settle();
    expect(log.filter((l) => l.startsWith('scrollTo'))).toEqual(['scrollTo {"left":7,"top":8,"behavior":"auto"}']);
    runRafs();
    await new Promise((r) => setTimeout(r, 120));
    expect(log.filter((l) => l.startsWith('scrollTo'))).toEqual([
      'scrollTo {"left":7,"top":8,"behavior":"auto"}',
      'scrollTo {"left":7,"top":8,"behavior":"auto"}',
      'scrollTo {"left":7,"top":8,"behavior":"auto"}',
    ]);
  });

  test('an invalid state at start is an ordinary initial load (no scroll)', async () => {
    install('http://app.test/a', { __thaneScroll: { left: 'x', top: 8 } });
    startRouter(routes(), new FakeElement('outlet') as any);
    await settle();
    runRafs();
    expect(log.filter((l) => l.startsWith('scrollTo'))).toEqual([]);
  });

  test('the state written at start keeps the other keys of history.state', async () => {
    install('http://app.test/a?q=1#h', { app: 'x' });
    startRouter(routes(), new FakeElement('outlet') as any);
    expect(log[1]).toBe('replaceState {"app":"x","__thaneScroll":{"left":11,"top":22}} http://app.test/a?q=1#h');
  });
});

// ─────────────────────────────────────────────────────────────
//  Lifecycle and globals
// ─────────────────────────────────────────────────────────────

describe('router lifecycle', () => {
  test('the router installs no globals: navigate, navigateBack and currentPath are imported from thane/router', async () => {
    install('http://app.test/a');
    startRouter(routes(), new FakeElement('outlet') as any);
    await settle();
    expect('navigate' in g || 'navigateBack' in g || 'currentPath' in g).toBe(false);
    expect(currentPath()).toBe('/a');
    stopRouter();
    expect('navigate' in g || 'navigateBack' in g || 'currentPath' in g).toBe(false);
  });

  test('a second startRouter warns and changes nothing', async () => {
    install('http://app.test/a');
    startRouter(routes(), new FakeElement('outlet') as any);
    await settle();
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    try {
      log = [];
      startRouter(routes(), new FakeElement('other') as any, { scrollRestoration: false });
    } finally {
      console.warn = warn;
    }
    expect(warnings).toEqual(['[thane-router] Router already started — only one instance is allowed.']);
    expect(log).toEqual([]);
  });

  test('stopRouter when not started does nothing', () => {
    install('http://app.test/a');
    stopRouter();
    expect(log).toEqual([]);
  });

  test('stopRouter resets currentPath to the location', async () => {
    const b = install('http://app.test/a');
    startRouter(routes(), new FakeElement('outlet') as any);
    await settle();
    b.setUrl('/elsewhere');
    stopRouter();
    expect(currentPath()).toBe('/elsewhere');
  });

  test('navigateBack calls history.back', () => {
    install('http://app.test/a');
    navigateBack();
    expect(log).toEqual(['history.back']);
  });

  test('navigate to the current URL does nothing', async () => {
    install('http://app.test/a?q=1#h');
    startRouter(routes(), new FakeElement('outlet') as any, { scrollRestoration: false });
    await settle();
    log = [];
    navigate('/a?q=1#h');
    expect(log).toEqual([]);
  });

  test('a scroll event schedules one save per frame', async () => {
    const b = install('http://app.test/a');
    startRouter(routes(), new FakeElement('outlet') as any);
    await settle();
    log = [];
    for (const fn of b.listeners.get('scroll') ?? []) fn();
    for (const fn of b.listeners.get('scroll') ?? []) fn();
    expect(rafs.length).toBe(1);
    b.window.scrollY = 99;
    runRafs();
    expect(log).toEqual(['replaceState {"__thaneScroll":{"left":11,"top":99}} http://app.test/a']);
  });
});

// ─────────────────────────────────────────────────────────────
//  Route context
// ─────────────────────────────────────────────────────────────

describe('route context', () => {
  test('a routed page receives the route: params, path, pattern, query, hash, title, state', async () => {
    const seen: { route?: any } = {};
    install('http://app.test/users/42?x=1#h', { k: 1 });
    startRouter(
      {
        routes: { '/users/:id': { component: page('U', seen), meta: { title: 'User' } } },
        notFound: { component: page('NF') },
      },
      new FakeElement('outlet') as any,
      { scrollRestoration: false },
    );
    await settle();
    const r = seen.route;
    expect(Object.keys(r)).toEqual([
      'params',
      'path',
      'pattern',
      'searchParams',
      'search',
      'hash',
      'title',
      'state',
      'error',
    ]);
    expect(r.search).toEqual({});
    expect(r.error).toBeUndefined();
    expect(r.params).toEqual({ id: '42' });
    expect(r.path).toBe('/users/42');
    expect(r.pattern).toBe('/users/:id');
    expect(r.searchParams.toString()).toBe('x=1');
    expect(r.hash).toBe('#h');
    expect(r.title).toBe('User');
    expect(r.state).toEqual({ k: 1 });
    expect(g.document.title).toBe('User');
  });

  test('navigate(pattern, params) pushes the filled-in path, and the page gets the params back decoded', async () => {
    const seen: { route?: any } = {};
    install('http://app.test/');
    startRouter(
      {
        routes: { '/': { component: page('H') }, '/users/:id/posts/:post': { component: page('P', seen) } },
        notFound: { component: page('NF') },
      },
      new FakeElement('outlet') as any,
      { scrollRestoration: false },
    );
    await settle();
    log = [];
    navigate('/users/:id/posts/:post', { id: 'a b/c', post: 7 });
    await settle();
    expect(log[0]).toBe('pushState null /users/a%20b%2Fc/posts/7');
    expect(seen.route.params).toEqual({ id: 'a b/c', post: '7' });
    expect(seen.route.pattern).toBe('/users/:id/posts/:post');
  });

  test('a route without a title reports the document title and leaves it alone', async () => {
    const seen: { route?: any } = {};
    install('http://app.test/a');
    startRouter(
      { routes: { '/a': { component: page('A', seen) } }, notFound: { component: page('NF') } },
      new FakeElement('outlet') as any,
      { scrollRestoration: false },
    );
    await settle();
    expect(seen.route.title).toBe('Doc');
    expect(g.document.title).toBe('Doc');
  });

  test('the notFound route has pattern "notFound"', async () => {
    const seen: { route?: any } = {};
    install('http://app.test/nope');
    startRouter(
      { routes: { '/a': { component: page('A') } }, notFound: { component: page('NF', seen), meta: { title: '404' } } },
      new FakeElement('outlet') as any,
      { scrollRestoration: false },
    );
    await settle();
    expect(seen.route.pattern).toBe('notFound');
    expect(seen.route.title).toBe('404');
    expect(seen.route.params).toEqual({});
  });

  describe('the error route', () => {
    const errors: unknown[][] = [];
    const consoleError = console.error;
    const capture = () => {
      errors.length = 0;
      console.error = (...args: unknown[]) => errors.push(args);
    };
    afterEach(() => {
      console.error = consoleError;
    });

    const mounts = () => log.filter((line) => line.startsWith('mount') || line.startsWith('destroy'));

    const throwing = (name: string) =>
      ({
        __f: () => {
          log.push(`mount ${name}`);
          throw new Error(`${name} failed`);
        },
      }) as any;

    test('a chunk that fails to load shows the error route, given the error, with its head', async () => {
      capture();
      const seen: { route?: any } = {};
      const failure = new Error('chunk failed');
      install('http://app.test/a');
      startRouter(
        {
          routes: { '/a': { component: () => Promise.reject(failure), meta: { title: 'A' } } },
          notFound: { component: page('NF') },
          error: { component: page('ERR', seen), meta: { title: 'Something went wrong' } },
        },
        new FakeElement('outlet') as any,
        { scrollRestoration: false },
      );
      await settle();
      await settle();
      expect(log).toContain('mount ERR into outlet');
      expect(seen.route.pattern).toBe('error');
      expect(seen.route.error).toBe(failure);
      expect(seen.route.path).toBe('/a');
      expect(g.document.title).toBe('Something went wrong');
      expect(errors[0]).toEqual(['[thane-router] Failed to load route:', failure]);
    });

    test('a component that throws while mounting shows the error route too, and the next route is normal again', async () => {
      capture();
      const seen: { route?: any } = {};
      install('http://app.test/a');
      startRouter(
        {
          routes: { '/a': { component: throwing('A') }, '/b': { component: page('B', seen) } },
          notFound: { component: page('NF') },
          error: { component: () => Promise.resolve({ default: page('ERR') }) },
        },
        new FakeElement('outlet') as any,
        { scrollRestoration: false },
      );
      await settle();
      await settle();
      expect(mounts()).toEqual(['mount A', 'mount ERR into outlet']);
      navigate('/b');
      await settle();
      expect(log).toContain('destroy ERR');
      expect(log).toContain('mount B into outlet');
      expect(seen.route.pattern).toBe('/b');
      expect(seen.route.error).toBeUndefined();
    });

    test('without an error route the outlet stays empty, and the failure is reported', async () => {
      capture();
      install('http://app.test/a');
      const outlet = new FakeElement('outlet');
      startRouter(
        { routes: { '/a': { component: throwing('A') } }, notFound: { component: page('NF') } },
        outlet as any,
        { scrollRestoration: false },
      );
      await settle();
      expect(mounts()).toEqual(['mount A']);
      expect(errors.map((e) => e[0])).toEqual(['[thane-router] Failed to load route:']);
    });
  });

  describe('redirects and guards', () => {
    const mounts = () => log.filter((line) => /^(mount|destroy|replaceState|pushState)/.test(line));
    const start = (routeMap: Record<string, Route>, url = 'http://app.test/a') => {
      install(url);
      startRouter({ routes: routeMap, notFound: { component: page('NF') } }, new FakeElement('outlet') as any, {
        scrollRestoration: false,
      });
    };

    test('redirectTo replaces the history entry and loads the target', async () => {
      start({ '/old': { redirectTo: '/new' }, '/new': { component: page('New') } }, 'http://app.test/old');
      await settle();
      expect(mounts()).toEqual(['replaceState null /new', 'mount New into outlet']);
      expect(g.window.location.pathname).toBe('/new');
      expect(currentPath()).toBe('/new');
    });

    test('a redirectTo function gets the route, with its parameters', async () => {
      const seen: { route?: any } = {};
      start(
        {
          '/u/:id': { redirectTo: (r) => `/users/${r.params['id']}` },
          '/users/:id': { component: page('User', seen) },
        },
        'http://app.test/u/7',
      );
      await settle();
      expect(mounts()).toEqual(['replaceState null /users/7', 'mount User into outlet']);
      expect(seen.route.params).toEqual({ id: '7' });
    });

    test('canEnter: true enters, a path redirects, and the guard gets the route it guards', async () => {
      const guarded: string[] = [];
      start({
        '/a': { component: page('A') },
        '/open/:id': {
          component: page('Open'),
          canEnter: (r) => (guarded.push(`${r.pattern} ${r.params['id']}`), true),
        },
        '/admin': { component: page('Admin'), canEnter: () => '/a' },
      });
      await settle();
      navigate('/open/3');
      await settle();
      expect(guarded).toEqual(['/open/:id 3']);
      expect(log).toContain('mount Open into outlet');
      log = [];
      navigate('/admin');
      await settle();
      expect(mounts()).toEqual([
        'pushState null /admin',
        'replaceState null /a',
        'destroy Open',
        'mount A into outlet',
      ]);
    });

    test('canEnter false keeps the page on screen, and the address bar shows its URL again', async () => {
      start({ '/a': { component: page('A') }, '/locked': { component: page('Locked'), canEnter: () => false } });
      await settle();
      log = [];
      navigate('/locked');
      await settle();
      expect(mounts()).toEqual(['pushState null /locked', 'replaceState null /a']);
      expect(currentPath()).toBe('/a');
      expect(log).not.toContain('mount Locked into outlet');
    });

    test('canEnter false on the first load shows the notFound route', async () => {
      start({ '/locked': { component: page('Locked'), canEnter: () => false } }, 'http://app.test/locked');
      await settle();
      expect(mounts()).toEqual(['mount NF into outlet']);
    });

    test('an async guard is awaited, and a newer navigation meanwhile wins', async () => {
      let release: (v: boolean) => void = () => {};
      start({
        '/a': { component: page('A') },
        '/slow': { component: page('Slow'), canEnter: () => new Promise<boolean>((r) => (release = r)) },
        '/b': { component: page('B') },
      });
      await settle();
      navigate('/slow');
      await settle();
      navigate('/b');
      await settle();
      release(true);
      await settle();
      expect(log).toContain('mount B into outlet');
      expect(log).not.toContain('mount Slow into outlet');
    });

    test('a loop of redirects stops, with an error', async () => {
      const errors: unknown[][] = [];
      const consoleError = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      try {
        start({ '/a': { redirectTo: '/b' }, '/b': { redirectTo: '/a' } });
        for (let i = 0; i < 30; i++) await settle();
        expect(log.filter((line) => line.startsWith('replaceState')).length).toBe(10);
        expect(errors).toEqual([['[thane-router] Redirect loop at', '/b']]);
      } finally {
        console.error = consoleError;
      }
    });
  });

  describe('links to routes', () => {
    /** A click on a link with these attributes, and whether the router took it (prevented the browser's load) */
    const click = (b: Browser, attributes: Record<string, string>, init: Partial<MouseEvent> = {}): boolean => {
      const link = {
        closest: (selector: string) => (selector === 'a[href]' ? link : null),
        getAttribute: (name: string) => attributes[name] ?? null,
        hasAttribute: (name: string) => name in attributes,
      };
      let prevented = false;
      const event = {
        target: { closest: link.closest },
        button: 0,
        defaultPrevented: false,
        preventDefault: () => (prevented = true),
        ...init,
      };
      for (const fn of b.listeners.get('click') ?? []) fn(event);
      return prevented;
    };
    const start = () => {
      const b = install('http://app.test/a');
      b.window.location.origin = 'http://app.test';
      startRouter(routes(), new FakeElement('outlet') as any, { scrollRestoration: false });
      return b;
    };

    test('a plain click on a link to a route navigates in the app, query and hash included', async () => {
      const b = start();
      await settle();
      log = [];
      expect(click(b, { href: '/b?x=1#h' })).toBe(true);
      await settle();
      expect(log).toContain('pushState null /b?x=1#h');
      expect(log).toContain('mount B into outlet');
    });

    test('the browser keeps a handled or modified click, a target, a download, rel="external" and another origin', async () => {
      const b = start();
      await settle();
      log = [];
      expect(click(b, { href: '/b' }, { defaultPrevented: true })).toBe(false);
      expect(click(b, { href: '/b' }, { ctrlKey: true })).toBe(false);
      expect(click(b, { href: '/b' }, { metaKey: true })).toBe(false);
      expect(click(b, { href: '/b' }, { button: 1 })).toBe(false);
      expect(click(b, { href: '/b', target: '_blank' })).toBe(false);
      expect(click(b, { href: '/b', download: '' })).toBe(false);
      expect(click(b, { href: '/b', rel: 'noopener external' })).toBe(false);
      expect(click(b, { href: 'https://elsewhere.test/b' })).toBe(false);
      expect(log.filter((line) => line.startsWith('pushState'))).toEqual([]);
    });

    test('a hash on this page, and a path no route has (a file), are left to the browser', async () => {
      const b = start();
      await settle();
      expect(click(b, { href: '#section' })).toBe(false);
      expect(click(b, { href: '/sitemap.xml' })).toBe(false);
      expect(click(b, { href: '/nowhere' })).toBe(false);
      // target="_self" is the page itself, like no target
      expect(click(b, { href: '/b', target: '_self' })).toBe(true);
    });

    test('after stopRouter no click is taken', async () => {
      const b = start();
      await settle();
      stopRouter();
      expect(b.listeners.get('click') ?? []).toEqual([]);
    });
  });

  test("route.search holds the values the route's schema parses from the query; its guard gets them too", async () => {
    const seen: { route?: any } = {};
    const guarded: unknown[] = [];
    install('http://app.test/products?page=3&sort=bogus&sale');
    startRouter(
      {
        routes: {
          '/products': {
            component: page('Products', seen),
            search: {
              page: searchNumber(1),
              sort: searchOneOf(['price', 'name'], 'name'),
              sale: searchFlag(),
              q: searchString(),
            },
            canEnter: (r) => (guarded.push(r.search), true),
          },
        },
        notFound: { component: page('NF') },
      },
      new FakeElement('outlet') as any,
      { scrollRestoration: false },
    );
    await settle();
    expect(seen.route.search).toEqual({ page: 3, sort: 'name', sale: true, q: undefined });
    expect(guarded).toEqual([{ page: 3, sort: 'name', sale: true, q: undefined }]);
    navigate('/products', { page: 4, q: 'x' });
    await settle();
    expect(seen.route.search).toEqual({ page: 4, sort: 'name', sale: false, q: 'x' });
  });

  test('a lazy route: the default export is mounted', async () => {
    install('http://app.test/a');
    startRouter(
      {
        routes: { '/a': { component: () => Promise.resolve({ default: page('LazyA') }) } },
        notFound: { component: page('NF') },
      },
      new FakeElement('outlet') as any,
      { scrollRestoration: false },
    );
    await settle();
    expect(log).toContain('mount LazyA into outlet');
  });

  /** A component created outside the router gets its route from the provider the router installs. */
  const providerRoute = (): any => {
    const seen: { ctx?: any } = {};
    const tpl = { content: { cloneNode: () => ({ querySelectorAll: () => [] }) } } as any;
    const ref = __registerComponentLean(
      'ctx-probe',
      (ctx: any) => {
        seen.ctx = ctx;
        return {};
      },
      tpl,
    );
    ref.__f({ classList: { add() {} }, append() {} } as any);
    return seen.ctx.route;
  };

  test('provider, with a window: the live location, the loaded route pattern and title', async () => {
    install('http://app.test/users/7?y=2#k', { s: 1 });
    startRouter(
      {
        routes: { '/users/:id': { component: page('U'), meta: { title: 'User' } } },
        notFound: { component: page('NF') },
      },
      new FakeElement('outlet') as any,
      { scrollRestoration: false },
    );
    await settle();
    const r = providerRoute();
    expect(r.params).toEqual({ id: '7' });
    expect(r.path).toBe('/users/7');
    expect(r.pattern).toBe('/users/:id');
    expect(r.searchParams.toString()).toBe('y=2');
    expect(r.hash).toBe('#k');
    expect(r.title).toBe('User');
    expect(r.state).toEqual({ s: 1 });
  });

  test('provider, without a window: currentPath, empty query and hash, no state', () => {
    const r = providerRoute();
    expect(r.params).toEqual({});
    expect(r.path).toBe('');
    expect(r.pattern).toBe('');
    expect(r.searchParams.toString()).toBe('');
    expect(r.hash).toBe('');
    expect(r.title).toBe('');
    expect(r.state).toBeUndefined();
  });

  test('no match and no notFound route: pattern is the path, title the document title, outlet empty', async () => {
    install('http://app.test/x');
    startRouter({ routes: {}, notFound: undefined as any }, new FakeElement('outlet') as any, {
      scrollRestoration: false,
    });
    await settle();
    expect(log).toEqual(['addEventListener popstate', 'addEventListener click', 'outlet.innerHTML = ""']);
    const r = providerRoute();
    expect(r.pattern).toBe('/x');
    expect(r.title).toBe('Doc');
  });
});

// ─────────────────────────────────────────────────────────────
//  mount(Shell, { routes }) and mount(Routes)
// ─────────────────────────────────────────────────────────────

describe('mount(Shell, { routes }) and mount(Routes)', () => {
  const table = () =>
    defineRoutes({
      '/a': { component: page('A') },
      'notFound': { component: page('NF') },
    });

  test('mount(Routes): pages render into the target; destroy stops the router', async () => {
    install('http://app.test/a');
    const target = new FakeElement('body');
    const handle = mount(table(), { scrollRestoration: false, target: target as any });
    expect(handle.root).toBe(target as any);
    await settle();
    expect(log).toEqual([
      'addEventListener popstate',
      'addEventListener click',
      'body.innerHTML = ""',
      'mount A into body',
    ]);
    log = [];
    expect(handle.destroy()).toBeUndefined();
    expect(log).toEqual([
      'destroy A',
      'body.innerHTML = ""',
      'body.innerHTML = ""',
      'removeEventListener popstate',
      'removeEventListener click',
    ]);
    expect('navigate' in g).toBe(false);
  });

  const shell = (outlet: boolean) =>
    ({
      __f: (target: any) => {
        log.push(`mount Shell into ${target.name}`);
        if (outlet) target.children.set('router-outlet', new FakeElement('router-outlet'));
        return { root: target, __onDestroy: () => log.push('destroy Shell') };
      },
    }) as any;

  test('mount(Shell, { routes }): the shell is mounted, pages go into its <router-outlet>; destroy stops the router, then the shell', async () => {
    install('http://app.test/a');
    const target = new FakeElement('body');
    const handle = mount(shell(true), { routes: table(), scrollRestoration: false, target: target as any });
    expect(handle.root).toBe(target as any);
    await settle();
    expect(log).toEqual([
      'mount Shell into body',
      'addEventListener popstate',
      'addEventListener click',
      'router-outlet.innerHTML = ""',
      'mount A into router-outlet',
    ]);
    log = [];
    handle.destroy();
    expect(log).toEqual([
      'destroy A',
      'router-outlet.innerHTML = ""',
      'router-outlet.innerHTML = ""',
      'removeEventListener popstate',
      'removeEventListener click',
      'destroy Shell',
      'body.innerHTML = ""',
    ]);
  });

  test("a <router-outlet> of the page (index.html) is used when the shell's template has none", async () => {
    const b = install('http://app.test/a');
    b.document.elements.set('router-outlet', new FakeElement('page-outlet'));
    mount(shell(false), { routes: table(), scrollRestoration: false, target: new FakeElement('body') as any });
    await settle();
    expect(log).toContain('mount A into page-outlet');
  });

  test('a shell without a <router-outlet> throws, and the shell goes again', () => {
    install('http://app.test/a');
    expect(() =>
      mount(shell(false), { routes: table(), scrollRestoration: false, target: new FakeElement('body') as any }),
    ).toThrow(
      "[thane] The shell's template has no <router-outlet> element: put one where the pages go, or mount the routes alone (mount(Routes)).",
    );
    expect(log).toEqual(['mount Shell into body', 'destroy Shell', 'body.innerHTML = ""']);
  });
});
