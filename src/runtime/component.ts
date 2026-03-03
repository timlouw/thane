/**
 * Component implementation — defineComponent API.
 * Uses native DOM (no Shadow DOM). Scoped styles via adoptedStyleSheets.
 */

import type { ComponentRoot } from './types.js';

// ============================================================================
// Types
// ============================================================================

type ComponentProps = Record<string, any>;
export type ComponentHTMLSelector<T> = (props: T) => string;

/**
 * Context object passed to the defineComponent setup function.
 */
export interface ComponentContext<P = {}> {
  /** The host element containing component content */
  root: ComponentRoot;
  /** Props passed to the component (typed via generic) */
  props: Readonly<P>;
}

/**
 * Object returned from a defineComponent setup function.
 * Lifecycle hooks are typed as arrow-function properties (enforced by THANE402).
 */
export type ComponentReturnType = {
  /** HTML template (html tagged template literal) */
  template?: string;
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
  /** Compiler-injected binding initializer (short name for bundle size) */
  __b?: (ctx: ComponentContext) => (() => void) | void;
}

/** Setup function signature for defineComponent. */
type SetupFunction<P = {}> = (ctx: ComponentContext<P>) => ComponentReturnType;

/** @internal */
interface ComponentInstance {
  root: ComponentRoot;
  __onDestroy?: () => void;
  __bindingsCleanup?: () => void;
}

/** @internal */
interface ComponentRef {
  __f: (target: HTMLElement, props?: any) => ComponentInstance;
  [templateName: string]: unknown;
}

/** @internal */
interface SetupWithSelector<P = {}> extends SetupFunction<P> {
  __selector: string;
}

// ============================================================================
// Style Management
// ============================================================================

function splitSelectorList(selectorList: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < selectorList.length; i++) {
    const ch = selectorList[i];
    const prev = i > 0 ? selectorList[i - 1] : '';

    if (inSingle) {
      if (ch === "'" && prev !== '\\') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== '\\') inDouble = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
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
    const end = trimmed.indexOf(')');
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

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    const prev = i > 0 ? source[i - 1] : '';

    if (inSingle) {
      if (ch === "'" && prev !== '\\') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== '\\') inDouble = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function scopeCssRules(cssText: string, hostSelector: string): string {
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
      if (
        preludeTrimmed.startsWith('@media') ||
        preludeTrimmed.startsWith('@supports') ||
        preludeTrimmed.startsWith('@layer') ||
        preludeTrimmed.startsWith('@container') ||
        preludeTrimmed.startsWith('@document')
      ) {
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
    if (!registered.has(selector)) {
      registered.add(selector);
      const scopedCss = scopeCssRules(cssText, `.${selector}`);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(scopedCss);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
  };
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
export function defineComponent<P extends ComponentProps = {}>(
  selector: string,
  setup: SetupFunction<P>,
): ComponentHTMLSelector<P>;
export function defineComponent<P extends ComponentProps = {}>(
  selectorOrSetup: string | SetupFunction<P>,
  maybeSetup?: SetupFunction<P> | any,
  __compiledTemplate?: HTMLTemplateElement,
  ...extraStaticTemplates: any[]
): ComponentHTMLSelector<P> {
  let selector: string;
  let setup: SetupFunction<P>;

  if (typeof selectorOrSetup === 'string') {
    selector = selectorOrSetup;
    setup = maybeSetup as SetupFunction<P>;
  } else {
    // Auto-derived selector should have been injected by the compiler
    selector = (selectorOrSetup as SetupWithSelector<P>).__selector;
    setup = selectorOrSetup;
    if (!selector) {
      throw new Error(
        'defineComponent: could not resolve selector. ' +
          'Either pass an explicit selector string or ensure the compiler auto-derives it from the export name.',
      );
    }
  }

  // Collect extra static templates (for repeat optimizations)
  const staticTemplatesMap = new Map<string, HTMLTemplateElement>();
  for (let i = 0; i < extraStaticTemplates.length; i += 2) {
    const name = extraStaticTemplates[i];
    const tpl = extraStaticTemplates[i + 1];
    if (typeof name === 'string' && tpl) {
      staticTemplatesMap.set(name, tpl);
    }
  }

  // Register styles once (before factory runs)
  let stylesRegistered = false;

  // Create factory function for component instantiation
  const factory = (target?: HTMLElement, props?: P): ComponentInstance => {
    if (!target) {
      throw new Error(`[thane] Component "${selector}" requires a target element to mount into.`);
    }
    target.classList.add(selector);
    const root = target as unknown as ComponentRoot;
    const ctx: ComponentContext<P> = {
      root,
      props: (props || {}) as Readonly<P>,
    };

    const result = setup(ctx) as InternalComponentResult;

    // Register styles (once) — only runs when __enableComponentStyles was called
    if (_onStyles && !stylesRegistered && result.styles) {
      _onStyles(selector, result.styles);
      stylesRegistered = true;
    }

    // Apply template
    if (__compiledTemplate) {
      // Use pre-compiled static template (injected by the compiler)
      root.appendChild(__compiledTemplate.content.cloneNode(true));
    } else if (result.template) {
      root.innerHTML = result.template;
    }

    // Initialize reactive bindings (injected by the compiler into the return object)
    let bindingsCleanup: (() => void) | void | undefined;
    if (result.__b) {
      bindingsCleanup = result.__b(ctx);
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

  // Return a ref object compatible with mount() and repeat template lookups.
  // The cast is necessary: ComponentRef is the runtime shape, but the public
  // type includes the (props: P) => string call-signature that the compiler
  // generates at compile time — there is no way to satisfy it at runtime.
  const ref: ComponentRef = { __f: factory };
  for (const [name, tpl] of staticTemplatesMap) {
    ref[name] = tpl;
  }
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
  ...extraStaticTemplates: any[]
): any {
  let stylesRegistered = false;

  const factory = (target: HTMLElement, props?: Record<string, any>): ComponentInstance => {
    target.classList.add(selector);
    const root = target as ComponentRoot;

    const ctx: ComponentContext = { root, props: (props || {}) as Readonly<any> };
    const result = setup(ctx) as InternalComponentResult;

    if (_onStyles && !stylesRegistered && result.styles) {
      _onStyles(selector, result.styles);
      stylesRegistered = true;
    }

    root.appendChild(compiledTemplate.content.cloneNode(true));
    const bindingsCleanup = result.__b ? result.__b(ctx) : undefined;
    if (result.onMount) result.onMount();

    const instance: ComponentInstance = { root };
    if (bindingsCleanup) {
      instance.__bindingsCleanup = bindingsCleanup;
    }
    if (result.onDestroy) {
      instance.__onDestroy = result.onDestroy;
    }
    return instance;
  };

  const ref: ComponentRef = { __f: factory };
  for (let i = 0; i < extraStaticTemplates.length; i += 2) {
    ref[extraStaticTemplates[i]] = extraStaticTemplates[i + 1];
  }
  return ref;
}

/**
 * Lean component registration — no styles, no lifecycle hooks, no extra templates.
 *
 * The compiler emits this variant when `stripDeadPropertiesAndDetectFeatures`
 * confirms the component has no `styles` property and no non-empty lifecycle
 * hooks.  Because the lean function never references `_onStyles`, esbuild
 * can tree-shake the entire styles subsystem when no component in the app
 * uses it.  The extra-templates for-loop is omitted because the generated
 * binding code captures repeat templates directly via closure.
 *
 * @internal — emitted by the compiler; not part of the public API.
 */
export function __registerComponentLean(
  selector: string,
  setup: SetupFunction,
  compiledTemplate: HTMLTemplateElement,
): any {
  const factory = (target: HTMLElement, props?: Record<string, any>): ComponentInstance => {
    target.classList.add(selector);
    const root = target as ComponentRoot;
    const ctx: ComponentContext = { root, props: (props || {}) as Readonly<any> };
    const result = setup(ctx) as InternalComponentResult;
    root.appendChild(compiledTemplate.content.cloneNode(true));
    const bindingsCleanup = result.__b ? result.__b(ctx) : undefined;
    const instance: ComponentInstance = { root };
    if (bindingsCleanup) instance.__bindingsCleanup = bindingsCleanup;
    return instance;
  };
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
): MountHandle {
  // Both registration paths (defineComponent, __registerComponent)
  // store the factory as __f on the ref.
  const factory: ((t: HTMLElement, p?: Record<string, any>) => ComponentInstance) | undefined = (
    component as unknown as ComponentRef
  ).__f;
  if (!factory) {
    throw new Error('Invalid mount component');
  }

  const instance = factory(target, props);
  return {
    root: instance.root,
    destroy: () => {
      if (instance.__bindingsCleanup) instance.__bindingsCleanup();
      if (instance.__onDestroy) instance.__onDestroy();
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
