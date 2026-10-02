/**
 * Characterisation of the component factories, `__dc`, `__rc` and `mountComponent`.
 *
 * component.ts has little other unit coverage: its behaviour is covered by the
 * e2e contract and destroy suites. These tests pin, with an operation log over a fake DOM, what
 * each factory does and in which order, so that a change to defineComponent, __registerComponent or
 * mountComponent().destroy can be checked without a browser.
 *
 * Not pinned on purpose: undeclared third and further arguments of defineComponent, and extra
 * name/template pairs passed to __registerComponent: neither is used. The route-context provider is pinned in router-lifecycle.test.ts, because it is
 * installed by the router module.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import {
  __dc,
  __rc,
  __enableComponentStyles,
  __registerComponent,
  __registerComponentLean,
  defineComponent,
  mount,
  mountComponent,
  unmount,
} from './component.js';
import type { ComponentHTMLSelector } from './component.js';

// ─────────────────────────────────────────────────────────────
//  Fake DOM with an operation log
// ─────────────────────────────────────────────────────────────

let log: string[] = [];

class FakeElement {
  private _className: string;
  private _innerHTML = '';
  classList = {
    add: (cls: string): void => {
      log.push(`classList.add ${cls}`);
      const classes = this._className ? this._className.split(/\s+/) : [];
      if (!classes.includes(cls)) classes.push(cls);
      this._className = classes.join(' ');
    },
  };
  constructor(
    public name: string,
    className = '',
  ) {
    this._className = className;
  }
  get className(): string {
    return this._className;
  }
  set className(v: string) {
    log.push(`${this.name}.className = ${JSON.stringify(v)}`);
    this._className = v;
  }
  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(v: string) {
    log.push(`${this.name}.innerHTML = ${JSON.stringify(v)}`);
    this._innerHTML = v;
  }
  append(node: { name: string }): void {
    log.push(`${this.name}.append ${node.name}`);
  }
  querySelectorAll(selector: string): string[] {
    log.push(`${this.name}.querySelectorAll ${selector}`);
    return [`${this.name}-elements`];
  }
}

const fakeTemplate = (name: string) =>
  ({
    content: {
      cloneNode: (deep: boolean) => {
        log.push(`${name}.content.cloneNode ${deep}`);
        return {
          name: `${name}-clone`,
          querySelectorAll: (selector: string) => {
            log.push(`${name}-clone.querySelectorAll ${selector}`);
            return [`${name}-clone-elements`];
          },
        };
      },
    },
  }) as unknown as HTMLTemplateElement;

const el = (name = 'target', className = '') => new FakeElement(name, className) as unknown as HTMLElement;

/** A setup function that logs its call and returns `result` (given the context). */
const loggingSetup =
  (result: (ctx: any) => Record<string, unknown>, seen?: { ctx?: any }) =>
  (ctx: any): any => {
    log.push('setup');
    if (seen) seen.ctx = ctx;
    return result(ctx);
  };

const fullResult = (ctx: any, extra: Record<string, unknown> = {}) => ({
  __b: (bctx: any, elements: any) => {
    log.push(`__b sameCtx=${bctx === ctx} elements=${elements?.[0]}`);
    return () => log.push('bindingsCleanup');
  },
  onMount: () => log.push('onMount'),
  onDestroy: () => log.push('onDestroy'),
  ...extra,
});

afterEach(() => {
  log = [];
});

// ─────────────────────────────────────────────────────────────
//  __registerComponent
// ─────────────────────────────────────────────────────────────

describe('__registerComponent', () => {
  test('returns a ref whose only key is __f', () => {
    const ref = __registerComponent('x-a', () => ({}), fakeTemplate('tpl'));
    expect(Object.keys(ref)).toEqual(['__f']);
    expect(typeof ref.__f).toBe('function');
  });

  test('factory order: class, setup, clone and append, __b, onMount', () => {
    const ref = __registerComponent('x-a', loggingSetup(fullResult) as any, fakeTemplate('tpl'));
    const target = el();
    const instance = ref.__f(target, { p: 1 });
    expect(log).toEqual([
      'classList.add x-a',
      'setup',
      'tpl.content.cloneNode true',
      'tpl-clone.querySelectorAll *',
      'target.append tpl-clone',
      '__b sameCtx=true elements=tpl-clone-elements',
      'onMount',
    ]);
    expect(instance.root).toBe(target);
    expect(Object.keys(instance)).toEqual(['root', '__bindingsCleanup', '__onDestroy']);
    instance.__bindingsCleanup();
    instance.__onDestroy();
    expect(log.slice(-2)).toEqual(['bindingsCleanup', 'onDestroy']);
  });

  test('context: root is the target, props are passed through or default to a fresh {}', () => {
    const seen: { ctx?: any } = {};
    const ref = __registerComponent('x-a', loggingSetup(() => ({}), seen) as any, fakeTemplate('tpl'));
    const target = el();
    const props = { a: 1 };
    ref.__f(target, props);
    expect(seen.ctx.root).toBe(target);
    expect(seen.ctx.props).toBe(props);
    expect(Object.keys(seen.ctx)).toEqual(['root', 'props', 'route']);
    ref.__f(el());
    const first = seen.ctx.props;
    expect(first).toEqual({});
    ref.__f(el());
    expect(seen.ctx.props).toEqual({});
    expect(seen.ctx.props).not.toBe(first);
  });

  test('context: an explicit extras.route is used as ctx.route', () => {
    const seen: { ctx?: any } = {};
    const ref = __registerComponent('x-a', loggingSetup(() => ({}), seen) as any, fakeTemplate('tpl'));
    const route = { path: '/r' } as any;
    ref.__f(el(), undefined, { route });
    expect(seen.ctx.route).toBe(route);
  });

  test('instance keys follow what the setup returns', () => {
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{}, ['root']],
      [{ __b: () => undefined }, ['root']],
      [{ __b: () => () => {} }, ['root', '__bindingsCleanup']],
      [{ onDestroy: () => {} }, ['root', '__onDestroy']],
      [{ onMount: () => {} }, ['root']],
    ];
    for (const [result, keys] of cases) {
      const ref = __registerComponent('x-a', () => result as any, fakeTemplate('tpl'));
      expect(Object.keys(ref.__f(el()))).toEqual(keys);
    }
    const onDestroy = () => {};
    const ref = __registerComponent('x-a', () => ({ onDestroy }), fakeTemplate('tpl'));
    expect(ref.__f(el()).__onDestroy).toBe(onDestroy);
  });

  test('extra arguments do not change what the factory does', () => {
    const ref = (__registerComponent as any)(
      'x-a',
      loggingSetup(fullResult),
      fakeTemplate('tpl'),
      '__tpl_b1',
      fakeTemplate('extra'),
    );
    ref.__f(el());
    expect(log).toEqual([
      'classList.add x-a',
      'setup',
      'tpl.content.cloneNode true',
      'tpl-clone.querySelectorAll *',
      'target.append tpl-clone',
      '__b sameCtx=true elements=tpl-clone-elements',
      'onMount',
    ]);
  });

  test('extra name/template pairs (from older compilers) are not stored on the ref', () => {
    const ref = (__registerComponent as any)('x-a', () => ({}), fakeTemplate('tpl'), '__tpl_b1', fakeTemplate('extra'));
    expect(Object.keys(ref)).toEqual(['__f']);
  });
});

// ─────────────────────────────────────────────────────────────
//  __registerComponentLean
// ─────────────────────────────────────────────────────────────

describe('__registerComponentLean', () => {
  test('returns a ref whose only key is __f', () => {
    expect(Object.keys(__registerComponentLean('x-l', () => ({}), fakeTemplate('tpl')))).toEqual(['__f']);
  });

  test('factory order: class, setup, clone and append, __b; lifecycle hooks are ignored', () => {
    const ref = __registerComponentLean('x-l', loggingSetup(fullResult) as any, fakeTemplate('tpl'));
    const target = el();
    const instance = ref.__f(target);
    expect(log).toEqual([
      'classList.add x-l',
      'setup',
      'tpl.content.cloneNode true',
      'tpl-clone.querySelectorAll *',
      'target.append tpl-clone',
      '__b sameCtx=true elements=tpl-clone-elements',
    ]);
    expect(instance.root).toBe(target);
    expect(Object.keys(instance)).toEqual(['root', '__bindingsCleanup']);
  });

  test('context: root, props, explicit route', () => {
    const seen: { ctx?: any } = {};
    const ref = __registerComponentLean('x-l', loggingSetup(() => ({}), seen) as any, fakeTemplate('tpl'));
    const target = el();
    const props = { a: 1 };
    const route = { path: '/r' } as any;
    ref.__f(target, props, { route });
    expect(seen.ctx.root).toBe(target);
    expect(seen.ctx.props).toBe(props);
    expect(seen.ctx.route).toBe(route);
    ref.__f(el());
    expect(seen.ctx.props).toEqual({});
  });

  test('no __b: the instance is { root } only', () => {
    const ref = __registerComponentLean('x-l', () => ({}), fakeTemplate('tpl'));
    expect(Object.keys(ref.__f(el()))).toEqual(['root']);
  });
});

// ─────────────────────────────────────────────────────────────
//  defineComponent (the uncompiled path)
// ─────────────────────────────────────────────────────────────

describe('defineComponent (uncompiled)', () => {
  test('explicit selector: class, setup, innerHTML = template, __b, onMount', () => {
    const ref = defineComponent(
      'x-d',
      loggingSetup((ctx) => fullResult(ctx, { template: '<p>hi</p>' })),
    ) as any;
    expect(Object.keys(ref)).toEqual(['__f']);
    const target = el();
    const instance = ref.__f(target, { a: 1 });
    expect(log).toEqual([
      'classList.add x-d',
      'setup',
      'target.innerHTML = "<p>hi</p>"',
      'target.querySelectorAll *',
      '__b sameCtx=true elements=target-elements',
      'onMount',
    ]);
    expect(instance.root).toBe(target);
    expect(Object.keys(instance)).toEqual(['root', '__bindingsCleanup', '__onDestroy']);
  });

  test('no template (or an empty one): innerHTML is not written', () => {
    for (const template of [undefined, '']) {
      log = [];
      const ref = defineComponent('x-d', loggingSetup(() => ({ template })) as any) as any;
      ref.__f(el());
      expect(log).toEqual(['classList.add x-d', 'setup']);
    }
  });

  test('context: root, props (default {}), explicit route', () => {
    const seen: { ctx?: any } = {};
    const ref = defineComponent('x-d', loggingSetup(() => ({}), seen) as any) as any;
    const target = el();
    const props = { a: 1 };
    const route = { path: '/r' } as any;
    ref.__f(target, props, { route });
    expect(seen.ctx.root).toBe(target);
    expect(seen.ctx.props).toBe(props);
    expect(seen.ctx.route).toBe(route);
    expect(Object.keys(seen.ctx)).toEqual(['root', 'props', 'route']);
    ref.__f(el());
    expect(seen.ctx.props).toEqual({});
  });

  test('a setup carrying __selector (injected by the compiler) supplies the selector', () => {
    const setup = Object.assign(() => ({}), { __selector: 'x-auto' });
    const ref = defineComponent(setup) as any;
    ref.__f(el());
    expect(log).toEqual(['classList.add x-auto']);
  });

  test('no selector: throws at definition', () => {
    expect(() => defineComponent(() => ({}))).toThrow(
      'defineComponent: could not resolve selector. ' +
        'Either pass an explicit selector string or ensure the compiler auto-derives it from the export name.',
    );
  });

  test('factory without a target throws before running setup', () => {
    const ref = defineComponent('x-d', loggingSetup(() => ({})) as any) as any;
    expect(() => ref.__f()).toThrow('[thane] Component "x-d" requires a target element to mount into.');
    expect(log).toEqual([]);
  });

  test('instance keys follow what the setup returns', () => {
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{}, ['root']],
      [{ __b: () => undefined }, ['root']],
      [{ __b: () => () => {} }, ['root', '__bindingsCleanup']],
      [{ onDestroy: () => {} }, ['root', '__onDestroy']],
    ];
    for (const [result, keys] of cases) {
      const ref = defineComponent('x-d', () => result as any) as any;
      expect(Object.keys(ref.__f(el()))).toEqual(keys);
    }
  });
});

// ─────────────────────────────────────────────────────────────
//  Styles through the factories
// ─────────────────────────────────────────────────────────────

describe('component styles', () => {
  const g = globalThis as any;

  /** Installs a fake CSSStyleSheet and document for the duration of fn. */
  const withStyleGlobals = (fn: () => void): string[] => {
    const sheets: string[] = [];
    const saved = { CSSStyleSheet: g.CSSStyleSheet, document: g.document };
    g.CSSStyleSheet = class {
      replaceSync(css: string) {
        log.push(`replaceSync ${css}`);
        sheets.push(css);
      }
    };
    g.document = { adoptedStyleSheets: [] };
    try {
      fn();
    } finally {
      g.CSSStyleSheet = saved.CSSStyleSheet;
      g.document = saved.document;
    }
    return sheets;
  };

  test('before __enableComponentStyles, styles are ignored by every factory', () => {
    const sheets = withStyleGlobals(() => {
      __registerComponent('s-before', () => ({ styles: ':host { a: b }' }), fakeTemplate('tpl')).__f(el());
      (defineComponent('s-before-d', () => ({ styles: ':host { a: b }' })) as any).__f(el());
    });
    expect(sheets).toEqual([]);
  });

  test('once enabled: scoped with the selector, adopted once per selector, before the template is appended', () => {
    let adopted: unknown[] = [];
    const sheets = withStyleGlobals(() => {
      __enableComponentStyles();
      __enableComponentStyles(); // a second call changes nothing
      const ref = __registerComponent(
        's-one',
        loggingSetup(() => ({ styles: ':host { a: b } .x { c: d }' })) as any,
        fakeTemplate('tpl'),
      );
      ref.__f(el());
      ref.__f(el());
      // another registration with the same selector does not adopt a second sheet
      __registerComponent('s-one', () => ({ styles: '.y { e: f }' }), fakeTemplate('tpl')).__f(el());
      // defineComponent registers through the same hook
      (defineComponent('s-two', () => ({ styles: '.z { g: h }' })) as any).__f(el());
      // the lean factory never registers styles
      __registerComponentLean('s-lean', () => ({ styles: '.w { i: j }' }) as any, fakeTemplate('tpl')).__f(el());
      // no styles: nothing
      __registerComponent('s-none', () => ({}), fakeTemplate('tpl')).__f(el());
      adopted = (globalThis as any).document.adoptedStyleSheets;
    });
    expect(sheets).toEqual(['.s-one{ a: b }.s-one .x{ c: d }', '.s-two .z{ g: h }']);
    expect(adopted.length).toBe(2);
    expect(log.slice(0, 4)).toEqual([
      'classList.add s-one',
      'setup',
      'replaceSync .s-one{ a: b }.s-one .x{ c: d }',
      'tpl.content.cloneNode true',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
//  __dc
// ─────────────────────────────────────────────────────────────

describe('__dc', () => {
  test('returns a thunk; nothing runs until it is called', () => {
    const instance = { root: el(), __bindingsCleanup: () => log.push('b'), __onDestroy: () => log.push('d') };
    const thunk = __dc(instance as any);
    expect(typeof thunk).toBe('function');
    expect(log).toEqual([]);
    thunk();
    expect(log).toEqual(['b', 'd']);
    thunk();
    expect(log).toEqual(['b', 'd', 'b', 'd']);
  });

  test('missing hooks are skipped', () => {
    __dc({ root: el() } as any)();
    __dc({ root: el(), __onDestroy: () => log.push('d') } as any)();
    __dc({ root: el(), __bindingsCleanup: () => log.push('b') } as any)();
    expect(log).toEqual(['d', 'b']);
  });
});

describe('__rc', () => {
  /** A child whose factory logs the props it mounts with and whose destroy logs them too */
  const child = {
    __f: (host: any, props: { label: string; item?: object }) => {
      log.push(`mount ${props.label}`);
      host.textContent = props.label;
      return { root: host, __onDestroy: () => log.push(`destroy ${props.label}`) };
    },
  };
  const host = (): any => ({ textContent: '' });

  test('mounts the child with its props', () => {
    const h = host();
    __rc(child as any, h, { label: 'a' });
    expect(log).toEqual(['mount a']);
    expect(h.textContent).toBe('a');
  });

  test('props that are each the same value keep the child', () => {
    const item = {};
    const rc = __rc(child as any, host(), { label: 'a', item });
    rc.u({ label: 'a', item });
    expect(log).toEqual(['mount a']);
  });

  test('a prop with another value destroys the child, empties its host, and mounts it again', () => {
    const h = host();
    const rc = __rc(child as any, h, { label: 'a' });
    rc.u({ label: 'b' });
    expect(log).toEqual(['mount a', 'destroy a', 'mount b']);
    expect(h.textContent).toBe('b');
    // The props it has now are the new ones
    rc.u({ label: 'b' });
    expect(log).toEqual(['mount a', 'destroy a', 'mount b']);
  });

  test('a new object in a prop, or a prop added or removed, mounts it again', () => {
    const rc = __rc(child as any, host(), { label: 'a', item: {} });
    rc.u({ label: 'a', item: {} });
    rc.u({ label: 'a' });
    rc.u({ label: 'a', item: undefined });
    expect(log).toEqual(['mount a', 'destroy a', 'mount a', 'destroy a', 'mount a', 'destroy a', 'mount a']);
  });

  test('NaN is the same value as NaN', () => {
    const rc = __rc(child as any, host(), { label: 'a', n: NaN } as any);
    rc.u({ label: 'a', n: NaN });
    expect(log).toEqual(['mount a']);
  });

  test('d destroys the child it has now', () => {
    const rc = __rc(child as any, host(), { label: 'a' });
    rc.u({ label: 'b' });
    rc.d();
    expect(log).toEqual(['mount a', 'destroy a', 'mount b', 'destroy b']);
  });
});

// ─────────────────────────────────────────────────────────────
//  mountComponent, unmount, mount (Mode A)
// ─────────────────────────────────────────────────────────────

/** A component ref whose factory logs its arguments and returns the given instance fields. */
const fakeRef = (fields: Record<string, unknown> = {}, seen: { args?: unknown[] } = {}): ComponentHTMLSelector<any> =>
  ({
    __f: function (target: any, ...rest: unknown[]) {
      seen.args = [target, ...rest];
      log.push(`__f argc=${arguments.length}`);
      target.classList.add('comp');
      return { root: target, ...fields };
    },
  }) as unknown as ComponentHTMLSelector<any>;

describe('mountComponent', () => {
  test('a value without __f is rejected', () => {
    expect(() => mountComponent({} as any, el())).toThrow('Invalid mount component');
  });

  test('no component at all is rejected with the same message, not a TypeError', () => {
    expect(() => mountComponent(undefined as any, el())).toThrow(new Error('Invalid mount component'));
    expect(() => mountComponent(null as any, el())).toThrow(new Error('Invalid mount component'));
    expect(log).toEqual([]);
  });

  test('passes target, props and extras to the factory and returns { root, destroy }', () => {
    const seen: { args?: unknown[] } = {};
    const target = el();
    const props = { a: 1 };
    const extras = { route: { path: '/x' } as any };
    const handle = mountComponent(fakeRef({}, seen), target, props, extras);
    expect(seen.args).toEqual([target, props, extras]);
    expect(log).toEqual(['__f argc=3', 'classList.add comp']);
    expect(Object.keys(handle)).toEqual(['root', 'destroy']);
    expect(handle.root).toBe(target);
  });

  test('destroy: bindings cleanup, onDestroy, class restored, content cleared, in that order', () => {
    const target = el('target', 'outlet');
    let seenByOnDestroy = '';
    const handle = mountComponent(
      fakeRef({
        __bindingsCleanup: () => log.push('bindingsCleanup'),
        __onDestroy: () => {
          seenByOnDestroy = (target as any).className;
          log.push('onDestroy');
        },
      }),
      target,
    );
    log = [];
    handle.destroy();
    expect(log).toEqual(['bindingsCleanup', 'onDestroy', 'target.className = "outlet"', 'target.innerHTML = ""']);
    expect(seenByOnDestroy).toBe('outlet comp');
  });

  test('destroy without hooks restores the class and clears the content only', () => {
    const target = el('target', '');
    const handle = mountComponent(fakeRef(), target);
    log = [];
    handle.destroy();
    expect(log).toEqual(['target.className = ""', 'target.innerHTML = ""']);
  });

  test('destroy twice runs everything twice (there is no guard)', () => {
    const target = el();
    const handle = mountComponent(
      fakeRef({ __bindingsCleanup: () => log.push('b'), __onDestroy: () => log.push('d') }),
      target,
    );
    log = [];
    handle.destroy();
    handle.destroy();
    expect(log).toEqual([
      'b',
      'd',
      'target.className = ""',
      'target.innerHTML = ""',
      'b',
      'd',
      'target.className = ""',
      'target.innerHTML = ""',
    ]);
  });

  test('destroy restores the class on the instance root, captured before the factory ran', () => {
    const target = el('target', 'a');
    const other = el('other', 'z');
    const ref = {
      __f: (t: any) => {
        t.classList.add('comp');
        return { root: other };
      },
    } as unknown as ComponentHTMLSelector<any>;
    const handle = mountComponent(ref, target);
    expect(handle.root).toBe(other);
    log = [];
    handle.destroy();
    expect(log).toEqual(['other.className = "a"', 'other.innerHTML = ""']);
  });

  test('the target defaults to document.body', () => {
    const g = globalThis as any;
    const saved = g.document;
    const body = el('body');
    g.document = { body };
    try {
      const seen: { args?: unknown[] } = {};
      const handle = mountComponent(fakeRef({}, seen));
      expect(seen.args![0]).toBe(body);
      expect(handle.root).toBe(body);
    } finally {
      g.document = saved;
    }
  });

  test('unmount calls handle.destroy once', () => {
    let calls = 0;
    unmount({ root: el(), destroy: () => calls++ } as any);
    expect(calls).toBe(1);
  });
});

describe('mount (Mode A)', () => {
  test('mount({ component, target, props }) calls the factory with (target, props, undefined)', () => {
    const seen: { args?: unknown[] } = {};
    const target = el();
    const props = { a: 1 };
    const handle = mount({ component: fakeRef({}, seen), target, props });
    expect(seen.args).toEqual([target, props, undefined]);
    expect(log[0]).toBe('__f argc=3');
    expect(handle.root).toBe(target);
    log = [];
    handle.destroy();
    expect(log).toEqual(['target.className = ""', 'target.innerHTML = ""']);
  });

  test('mount({}) and mount({ target }) throw "Invalid mount component"', () => {
    const g = globalThis as any;
    const saved = g.document;
    const body = el('body');
    g.document = { body };
    try {
      expect(() => mount({})).toThrow(new Error('Invalid mount component'));
      expect(() => mount({ target: el() })).toThrow(new Error('Invalid mount component'));
      expect(() => mount({ component: undefined, props: { a: 1 } })).toThrow(new Error('Invalid mount component'));
      expect(log).toEqual([]);
    } finally {
      g.document = saved;
    }
  });

  test('mount({ component }) mounts into document.body', () => {
    const g = globalThis as any;
    const saved = g.document;
    const body = el('body');
    g.document = { body };
    try {
      const seen: { args?: unknown[] } = {};
      mount({ component: fakeRef({}, seen) });
      expect(seen.args![0]).toBe(body);
    } finally {
      g.document = saved;
    }
  });
});
