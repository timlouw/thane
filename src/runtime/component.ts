/**
 * Component implementation — defineComponent API.
 * Uses native DOM (no Shadow DOM). Scoped styles via adoptedStyleSheets.
 */

import { __owning } from './signal.js';
import type { RouteContextForSelector, UntypedRouteContext } from './router.js';
import type { Fragment } from './markers.js';
import { hotRegister, hotRuntime, hotStyles } from './hot.js';

/** False in a production build, which leaves the development server's hot swapping out */
declare const __THANE_DEV__: boolean | undefined;
import type { ComponentRoot } from './types.js';

// ============================================================================
// Types
// ============================================================================

type ComponentProps = Record<string, any>;
/**
 * A component, as a template calls it: `${Card({ title })}`. A component whose props are all optional (or that
 * has none) can be called without them: `${Nav()}`.
 */
export type ComponentHTMLSelector<T> = {} extends T ? (props?: T) => Fragment : (props: T) => Fragment;

/**
 * Context object passed to the defineComponent setup function.
 */
export interface ComponentContext<P = {}, S extends string = string> {
  /** The host element containing component content */
  root: ComponentRoot;
  /** Props passed to the component (typed via generic) */
  props: Readonly<P>;
  /** Current route snapshot. Only available when routing is active. */
  route?: RouteContextForSelector<S>;
}

/**
 * Object returned from a defineComponent setup function. A hook is any function: an arrow, a method or a reference.
 */
export type ComponentReturnType = {
  /** HTML template (html tagged template literal) */
  template?: Fragment;
  /** Scoped styles (css tagged template literal) */
  styles?: string;
} & {
  /** Called after template is in the DOM and bindings are initialized */
  onMount?: (() => void) | undefined;
  /** Called when the component is removed from the DOM */
  onDestroy?: (() => void) | undefined;
};

/** @internal */
interface InternalComponentResult extends ComponentReturnType {
  /**
   * Compiler-injected binding initializer (short name for bundle size). It receives the elements
   * of the template it binds, in document order, taken from the clone before it is inserted.
   */
  __b?: (ctx: ComponentContext, elements: NodeListOf<Element>) => (() => void) | void;
}

/** Setup function signature for defineComponent. */
type SetupFunction<P = {}, S extends string = string> = (ctx: ComponentContext<P, S>) => ComponentReturnType;

/** @internal */
interface ComponentInstance {
  root: ComponentRoot;
  __onDestroy?: () => void;
  __bindingsCleanup?: () => void;
}

/** @internal */
interface ComponentRef {
  __f: (target: HTMLElement, props?: any, extras?: { route?: UntypedRouteContext | undefined }) => ComponentInstance;
}

/** @internal */
interface SetupWithSelector<P = {}, S extends string = string> extends SetupFunction<P, S> {
  __selector: string;
}

/** @internal — A `<template>` holding `markup`: every compiled template (component, list row, empty list) is one. */
export const __T = (markup: string): HTMLTemplateElement => {
  const t = document.createElement('template');
  t.innerHTML = markup;
  return t;
};

let _getRouteContext: (() => UntypedRouteContext) | undefined;

/** @internal */
export function __setRouteContextProvider(provider: () => UntypedRouteContext): void {
  _getRouteContext = provider;
}

// ============================================================================
// Style Management
// ============================================================================

const skipString = (s: string, i: number): number => {
  const q = s[i];
  while (++i < s.length && !(s[i] === q && s[i - 1] !== '\\'));
  return i;
};

function splitSelectorList(selectorList: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selectorList.length; i++) {
    const ch = selectorList[i];

    if (ch === "'" || ch === '"') {
      i = skipString(selectorList, i);
      continue;
    }

    if (ch === '(') parenDepth++;
    else if (ch === ')' && parenDepth > 0) parenDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']' && bracketDepth > 0) bracketDepth--;

    if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      parts.push(selectorList.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(selectorList.slice(start));
  return parts;
}

function scopeSingleSelector(selector: string, hostSelector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return trimmed;

  if (trimmed.includes('&')) {
    return trimmed.replace(/&/g, hostSelector);
  }

  if (trimmed.startsWith(':host(')) {
    const end = findMatchingBrace(trimmed, ':host'.length);
    if (end !== -1) {
      const hostSuffix = trimmed.slice(':host('.length, end).trim();
      const rest = trimmed.slice(end + 1);
      return `${hostSelector}${hostSuffix}${rest}`;
    }
  }

  if (trimmed === ':host') return hostSelector;
  if (trimmed.startsWith(':host')) return `${hostSelector}${trimmed.slice(':host'.length)}`;

  return `${hostSelector} ${trimmed}`;
}

// The `}` or `)` that closes the `{` or `(` at openIndex, outside strings; -1 if none
function findMatchingBrace(source: string, openIndex: number): number {
  const open = source[openIndex];
  const close = open === '(' ? ')' : '}';
  let depth = 0;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];

    if (ch === "'" || ch === '"') {
      i = skipString(source, i);
      continue;
    }

    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

export function scopeCssRules(cssText: string, hostSelector: string): string {
  let out = '';
  let cursor = 0;

  while (cursor < cssText.length) {
    const open = cssText.indexOf('{', cursor);
    if (open === -1) {
      out += cssText.slice(cursor);
      break;
    }

    const prelude = cssText.slice(cursor, open);
    const close = findMatchingBrace(cssText, open);
    if (close === -1) {
      out += cssText.slice(cursor);
      break;
    }

    const body = cssText.slice(open + 1, close);
    const preludeTrimmed = prelude.trim();

    if (!preludeTrimmed) {
      out += `${prelude}{${body}}`;
      cursor = close + 1;
      continue;
    }

    if (preludeTrimmed.startsWith('@')) {
      if (/^@(media|supports|layer|container|document)/.test(preludeTrimmed)) {
        out += `${prelude}{${scopeCssRules(body, hostSelector)}}`;
      } else {
        out += `${prelude}{${body}}`;
      }
      cursor = close + 1;
      continue;
    }

    const scopedSelectors = splitSelectorList(prelude)
      .map((selector) => scopeSingleSelector(selector, hostSelector))
      .join(', ');

    out += `${scopedSelectors}{${body}}`;
    cursor = close + 1;
  }

  return out;
}

/**
 * The keyframes a component's stylesheet defines are its own: `@keyframes spin` becomes
 * `@keyframes card-spin`, and so does every `animation` or `animation-name` in the stylesheet
 * that names it. A name the stylesheet does not define, such as a global animation, stays.
 */
export const scopeKeyframes = (cssText: string, scope: string): string => {
  const names = new Set(Array.from(cssText.matchAll(/keyframes\s+([\w-]+)/g), (match) => match[1]));
  // One pass renames the names after `keyframes` (a definition) and in an `animation` or `animation-name` value
  return names.size
    ? cssText.replace(
        /(keyframes\s+|animation(?:-name)?\s*:)([^;{}]*)/g,
        (_, head: string, rest: string) =>
          head + rest.replace(/[\w-]+/g, (name) => (names.has(name) ? scope + '-' + name : name)),
      )
    : cssText;
};

/**
 * Register global styles (deduped by CSS text).
 *
 * Tree-shakable: if no component imports this, esbuild strips it.
 */
const _globalRegistered = new Set<string>();
export function registerGlobalStyles(...styles: string[]): void {
  for (const cssText of styles) {
    if (!_globalRegistered.has(cssText)) {
      _globalRegistered.add(cssText);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
  }
}

/** @internal — null when no component uses styles (zero cost). */
let _onStyles: ((selector: string, cssText: string) => void) | null = null;

/**
 * Enable component-scoped styles via CSS nesting + adoptedStyleSheets.
 * Compiler injects this call in component files that use `styles`.
 * @internal
 */
export function __enableComponentStyles(): void {
  if (_onStyles) return;
  const registered = new Set<string>();
  _onStyles = (selector, cssText) => {
    // A page the development server serves replaces a component's sheet when its file changes
    if ((typeof __THANE_DEV__ === 'undefined' || __THANE_DEV__) && hotRuntime()) {
      hotStyles(hotRuntime()!, selector, scopeCssRules(cssText, `.${selector}`));
      return;
    }
    if (!registered.has(selector)) {
      registered.add(selector);
      const scopedCss = scopeCssRules(cssText, `.${selector}`);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(scopedCss);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
  };
}

let _keyframesScoped = false;

/**
 * Scope the keyframes of component stylesheets as well (see scopeKeyframes). The compiler calls it
 * from each module whose stylesheet defines keyframes, so an app without any bundles none of this.
 * @internal
 */
export function __enableKeyframeScoping(): void {
  if (_keyframesScoped) return;
  _keyframesScoped = true;
  __enableComponentStyles();
  const register = _onStyles!;
  _onStyles = (selector, cssText) => register(selector, scopeKeyframes(cssText, selector));
}

// ============================================================================
// Component Registration
// ============================================================================

/**
 * Define a component using the function-based API.
 * Selector is auto-derived from the export name at compile time.
 *
 * @example
 * export const MyCounter = defineComponent(() => ({
 *   template: html`<button>Click me</button>`,
 * }));
 */
export function defineComponent<P extends ComponentProps = {}>(setup: SetupFunction<P>): ComponentHTMLSelector<P>;
export function defineComponent<P extends ComponentProps = {}, const S extends string = string>(
  selector: S,
  setup: SetupFunction<P, S>,
): ComponentHTMLSelector<P>;
export function defineComponent<P extends ComponentProps = {}>(
  selectorOrSetup: string | SetupFunction<P, any>,
  maybeSetup?: SetupFunction<P, any> | any,
): ComponentHTMLSelector<P> {
  let selector: string;
  let setup: SetupFunction<P, any>;

  if (typeof selectorOrSetup === 'string') {
    selector = selectorOrSetup;
    setup = maybeSetup as SetupFunction<P, any>;
  } else {
    // Auto-derived selector should have been injected by the compiler
    selector = (selectorOrSetup as SetupWithSelector<P, any>).__selector;
    setup = selectorOrSetup;
    if (!selector) {
      throw new Error(
        'defineComponent: could not resolve selector. ' +
          'Either pass an explicit selector string or ensure the compiler auto-derives it from the export name.',
      );
    }
  }

  // Register styles once (before factory runs)
  let stylesRegistered = false;

  // Create factory function for component instantiation
  const factory = (
    target?: HTMLElement,
    props?: P,
    extras?: { route?: UntypedRouteContext | undefined },
  ): ComponentInstance => {
    if (!target) {
      throw new Error(`[thane] Component "${selector}" requires a target element to mount into.`);
    }
    target.classList.add(selector);
    const root = target as unknown as ComponentRoot;
    const ctx: ComponentContext<P, any> = {
      root,
      props: (props || {}) as Readonly<P>,
      route: (extras?.route ?? _getRouteContext?.()) as RouteContextForSelector<any>,
    };

    const result = setup(ctx) as InternalComponentResult;

    // Register styles (once) — only runs when __enableComponentStyles was called
    if (_onStyles && !stylesRegistered && result.styles) {
      _onStyles(selector, result.styles);
      stylesRegistered = true;
    }

    // Apply template: uncompiled, it is the markup string the caller passed
    if (result.template) {
      root.innerHTML = result.template as unknown as string;
    }

    // Initialize reactive bindings (injected by the compiler into the return object)
    let bindingsCleanup: (() => void) | void | undefined;
    if (result.__b) {
      bindingsCleanup = result.__b(ctx, root.querySelectorAll('*'));
    }

    // Lifecycle: onMount
    if (result.onMount) {
      result.onMount();
    }

    const instance: ComponentInstance = { root };
    if (bindingsCleanup) {
      instance.__bindingsCleanup = bindingsCleanup;
    }
    if (result.onDestroy) {
      instance.__onDestroy = result.onDestroy;
    }

    return instance;
  };

  // Return a ref object compatible with mount().
  // The cast is necessary: ComponentRef is the runtime shape, but the public
  // type includes the (props: P) => string call-signature that the compiler
  // generates at compile time — there is no way to satisfy it at runtime.
  const ref: ComponentRef = { __f: factory };
  return ref as unknown as ComponentHTMLSelector<P>;
}

/**
 * Compiler-optimized component registration (consolidated).
 *
 * The compiler emits `__registerComponent` in place of `defineComponent`.
 * This is the sole registration function — it handles all components:
 * - Styles registration (guarded, zero-cost when no styles)
 * - Lifecycle hooks (guarded, zero-cost when absent)
 * - Pre-compiled templates (always provided by the compiler)
 *
 * When no module imports `defineComponent`, esbuild tree-shakes it along
 * with the selector-type branching and error handling.
 *
 * @internal — emitted by the compiler; not part of the public API.
 */
export function __registerComponent(
  selector: string,
  setup: SetupFunction,
  compiledTemplate: HTMLTemplateElement,
): any {
  let stylesRegistered = false;

  const factory = (
    target: HTMLElement,
    props?: Record<string, any>,
    extras?: { route?: UntypedRouteContext | undefined },
  ): ComponentInstance => {
    target.classList.add(selector);
    const root = target as ComponentRoot;

    const ctx: ComponentContext = {
      root,
      props: (props || {}) as Readonly<any>,
      route: (extras?.route ?? _getRouteContext?.()) as RouteContextForSelector<any>,
    };
    // What the setup and onMount create (computeds, effects, onCleanup functions) is destroyed with the component
    const owned: (() => void)[] = [];
    const result = __owning(owned, () => setup(ctx)) as InternalComponentResult;

    if (_onStyles && !stylesRegistered && result.styles) {
      _onStyles(selector, result.styles);
      stylesRegistered = true;
    }

    // The template's elements are listed before the clone is inserted: the target may hold other nodes
    const clone = compiledTemplate.content.cloneNode(true) as DocumentFragment;
    const elements = clone.querySelectorAll('*');
    root.append(clone);
    const bindingsCleanup = result.__b?.(ctx, elements);
    if (result.onMount) __owning(owned, result.onMount);

    const instance: ComponentInstance = { root };
    if (bindingsCleanup) {
      instance.__bindingsCleanup = bindingsCleanup;
    }
    // Its destroy: onDestroy, then what the setup and onMount own, each once, in the order they were made
    instance.__onDestroy = () => {
      result.onDestroy?.();
      for (const cleanup of owned.splice(0)) cleanup();
    };
    return instance;
  };

  // In a page the development server serves, a component is swapped when its file changes
  if ((typeof __THANE_DEV__ === 'undefined' || __THANE_DEV__) && hotRuntime()) {
    return hotRegister(hotRuntime()!, selector, { __f: factory });
  }
  return { __f: factory };
}

/**
 * Lean component registration — no styles, no lifecycle hooks.
 *
 * The compiler emits this variant when `stripDeadPropertiesAndDetectFeatures`
 * confirms the component has no `styles` property and no non-empty lifecycle
 * hooks.  Because the lean function never references `_onStyles`, esbuild
 * can tree-shake the entire styles subsystem when no component in the app
 * uses it.
 *
 * @internal — emitted by the compiler; not part of the public API.
 */
export function __registerComponentLean(
  selector: string,
  setup: SetupFunction,
  compiledTemplate: HTMLTemplateElement,
): any {
  const factory = (
    target: HTMLElement,
    props?: Record<string, any>,
    extras?: { route?: UntypedRouteContext | undefined },
  ): ComponentInstance => {
    target.classList.add(selector);
    const root = target as ComponentRoot;
    const ctx: ComponentContext = {
      root,
      props: (props || {}) as Readonly<any>,
      route: (extras?.route ?? _getRouteContext?.()) as RouteContextForSelector<any>,
    };
    const result = setup(ctx) as InternalComponentResult;
    // The template's elements are listed before the clone is inserted: the target may hold other nodes
    const clone = compiledTemplate.content.cloneNode(true) as DocumentFragment;
    const elements = clone.querySelectorAll('*');
    root.append(clone);
    const bindingsCleanup = result.__b?.(ctx, elements);
    const instance: ComponentInstance = { root };
    if (bindingsCleanup) instance.__bindingsCleanup = bindingsCleanup;
    return instance;
  };
  if ((typeof __THANE_DEV__ === 'undefined' || __THANE_DEV__) && hotRuntime()) {
    return hotRegister(hotRuntime()!, selector, { __f: factory });
  }
  return { __f: factory };
}

/**
 * Destroy-child helper — returns a cleanup thunk for a child ComponentInstance.
 *
 * The compiler injects `_subs.push(__dc(Child.__f(el, props)))` so that the
 * parent's cleanup chain automatically tears down every child.
 *
 * Only imported when the component actually has child mounts — otherwise
 * esbuild tree-shakes it entirely.
 *
 * @internal — emitted by the compiler; not part of the public API.
 */
export const __dc =
  (i: ComponentInstance): (() => void) =>
  () => {
    if (i.__bindingsCleanup) i.__bindingsCleanup();
    if (i.__onDestroy) i.__onDestroy();
  };

type Props = Record<string, unknown>;

const sameProps = (a: Props, b: Props): boolean => {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!Object.is(a[key], b[key])) return false;
  return true;
};

/**
 * A child component in a list row whose props read the row's item or index, mounted into `host`. A component
 * reads its props when it mounts, so when the row's item changes, `u` is called with the props for the new one:
 * when one of them is not the value the child has, the child is destroyed and mounted again with them. `d`
 * destroys it.
 *
 * @internal — emitted by the compiler; not part of the public API.
 */
export const __rc = (
  child: ComponentRef,
  host: HTMLElement,
  props: Props,
): { u: (props: Props) => void; d: () => void } => {
  let destroy = __dc(child.__f(host, props));
  return {
    u: (next) => {
      if (sameProps(props, next)) return;
      destroy();
      host.textContent = '';
      destroy = __dc(child.__f(host, (props = next)));
    },
    d: () => destroy(),
  };
};

/**
 * Handle returned by mount(), allowing the caller to destroy the mounted
 * component and invoke its onDestroy lifecycle hook.
 */
export interface MountHandle {
  /** The root DOM element of the mounted component */
  root: ComponentRoot;
  /** Tear down the component: runs onDestroy, removes all child nodes */
  destroy: () => void;
}

/**
 * Internal mount — attaches a single component to a target element.
 *
 * This is the low-level mount used by the public `mount()` and the router.
 * It only accepts a ComponentHTMLSelector (return value of defineComponent),
 * so the HTML-string regex path is never included.
 *
 * @internal — use the public `mount()` from the runtime barrel instead.
 * @param component - Component selector function returned by defineComponent
 * @param target - DOM element to mount to (defaults to document.body)
 * @returns A MountHandle with the root element and a destroy() function
 * @throws {Error} If the component argument is not a valid defineComponent() result
 */
export function mountComponent(
  component: ComponentHTMLSelector<any>,
  target: HTMLElement = document.body,
  props?: Record<string, any>,
  extras?: { route?: UntypedRouteContext | undefined },
): MountHandle {
  // Both registration paths (defineComponent, __registerComponent)
  // store the factory as __f on the ref.
  const factory:
    | ((t: HTMLElement, p?: Record<string, any>, e?: { route?: UntypedRouteContext | undefined }) => ComponentInstance)
    | undefined = (component as unknown as ComponentRef | undefined)?.__f;
  if (!factory) {
    throw new Error('Invalid mount component');
  }

  const originalClassName = target.className;
  const instance = factory(target, props, extras);
  return {
    root: instance.root,
    destroy: () => {
      if (instance.__bindingsCleanup) instance.__bindingsCleanup();
      if (instance.__onDestroy) instance.__onDestroy();
      instance.root.className = originalClassName;
      instance.root.innerHTML = '';
    },
  };
}

/**
 * Convenience function to tear down a mounted component.
 *
 * Equivalent to calling `handle.destroy()` on the MountHandle returned
 * by `mount()`.  Exported so that teardown is discoverable in the public
 * API alongside `mount()`.
 *
 * @param handle - MountHandle returned by mount()
 */
export function unmount(handle: MountHandle): void {
  handle.destroy();
}

// ============================================================================
// Public mount() — single entry point for all bootstrap modes
// ============================================================================

/** Options for the `mount()` function. */
export interface MountOptions {
  /** Component to mount (return value of `defineComponent()`). Omit for Mode C (router only). */
  component?: ComponentHTMLSelector<any> | undefined;
  /** Target element. Defaults to `document.body`. */
  target?: HTMLElement | undefined;
  /** Component props. */
  props?: Record<string, any> | undefined;
  /** Router configuration. Omit for Mode A (no routing). */
  router?: import('./router.js').RouterConfig | undefined;
}

/**
 * Hook for router-aware mount — set by `defineRoutes()` in `router.ts`.
 * When null, only Mode A (component-only) mount is supported.
 * @internal
 */
let _routerMount: ((options: MountOptions, target: HTMLElement) => MountHandle) | null = null;

/**
 * Called by `defineRoutes()` to install the router-aware mount handler.
 * @internal — not part of the public API.
 */
export function __setRouterMount(fn: (options: MountOptions, target: HTMLElement) => MountHandle): void {
  _routerMount = fn;
}

/**
 * Mount a Thane application.
 *
 * - **Mode A** — `mount({ component })` — component only, no routing.
 * - **Mode B** — `mount({ component, router })` — shell component + router.
 * - **Mode C** — `mount({ router })` — router only, no shell.
 *
 * Modes B and C require `defineRoutes()` to be called first (from `thane/router`).
 *
 * @returns A MountHandle with a `destroy()` method.
 */
export function mount(options: MountOptions): MountHandle {
  const target = options.target ?? document.body;
  if (options.router) {
    if (!_routerMount) throw new Error('Import defineRoutes from thane/router to use routing');
    return _routerMount(options, target);
  }
  return mountComponent(options.component!, target, options.props);
}
