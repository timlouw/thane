/**
 * Component implementation — defineComponent API
 * 
 * Thane uses native DOM mode — no Web Components Shadow DOM required.
 * Components are rendered as regular DOM elements with scoped styles.
 *
 * Dead code elimination strategy:
 *   - The compiler strips unused properties (template, empty lifecycle hooks)
 *     from the return object at compile time.
 *   - The runtime guards (`if (result.onMount)`) are tiny after minification
 *     and safe to keep — they short-circuit immediately for absent properties.
 *   - mountedInstances is lazily allocated so it's absent when destroyComponent
 *     is never used.
 */

import type { ComponentRoot } from './types.js';

// ============================================================================
// Types
// ============================================================================

type ComponentProps = Record<string, any>;
type ComponentHTMLSelector<T> = (props: T) => string;

/**
 * Context object passed to the defineComponent setup function.
 * Provides access to the host element and component APIs.
 */
export interface ComponentContext<P = {}> {
  /** The host element containing component content */
  root: ComponentRoot;
  /** Props passed to the component (typed via generic) */
  props: Readonly<P>;
}

/**
 * The object returned from a defineComponent setup function.
 *
 * Lifecycle hooks (onMount, onDestroy) are typed as arrow-function
 * properties. TypeScript will only autocomplete `onMount: () => { }`,
 * never the method shorthand `onMount() { }` — enforced both here
 * at the type level and by lint rule THANE402.
 */
export type ComponentReturnType = {
  /** HTML template (html tagged template literal). Omitted by the compiler when a pre-compiled template is injected. */
  template?: string;
  /** Scoped styles (css tagged template literal) */
  styles?: string;
} & {
  /** Called after template is in the DOM and bindings are initialized */
  onMount?: (() => void) | undefined;
  /** Called when the component is removed from the DOM */
  onDestroy?: (() => void) | undefined;
};

/**
 * Internal extension of ComponentReturnType used by the compiler.
 * Not exported — users never see this.
 * @internal
 */
interface InternalComponentResult extends ComponentReturnType {
  /** Compiler-injected binding initializer */
  __bindings?: (ctx: ComponentContext) => void;
}

/**
 * Setup function signature for defineComponent.
 */
type SetupFunction<P = {}> = (ctx: ComponentContext<P>) => ComponentReturnType;

/**
 * Internal component instance created by the factory.
 */
interface ComponentInstance {
  root: ComponentRoot;
  __onDestroy?: () => void;
}

// ============================================================================
// Style Management
// ============================================================================

/**
 * Register global styles to be added to the document.
 * 
 * Self-contained: has its own deduplication Set and CSSStyleSheet creation.
 * If no component imports this, esbuild tree-shakes it entirely.
 *
 * @param styles - CSS strings to register
 */
const _globalRegistered = new Set<string>();
export function registerGlobalStyles(...styles: string[]): void {
  for (const cssText of styles) {
    if (!_globalRegistered.has(cssText)) {
      _globalRegistered.add(cssText);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      (document.adoptedStyleSheets as CSSStyleSheet[]).push(sheet);
    }
  }
}

/**
 * Callback for component styles registration.
 * Starts as null — set by __enableComponentStyles().
 * When null the factory skips styles entirely (zero cost).
 * @internal
 */
let _onStyles: ((selector: string, cssText: string) => void) | null = null;

/**
 * Enable the component-styles subsystem.
 *
 * The compiler injects a call to this function at module level in every
 * component file that has a `styles` property.  If no component in the
 * app uses styles, this is never imported and esbuild tree-shakes it
 * along with the CSSStyleSheet/Set infrastructure inside.
 *
 * @internal — exported only for compiler consumption.
 */
export function __enableComponentStyles(): void {
  if (_onStyles) return;          // idempotent
  const registered = new Set<string>();
  _onStyles = (selector, cssText) => {
    if (!registered.has(selector)) {
      registered.add(selector);
      const scoped = cssText
        .replace(/:host\b/g, `.${selector}`)
        .replace(/:host\(/g, `.${selector}(`);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`/* ${selector} */\n${scoped}`);
      (document.adoptedStyleSheets as CSSStyleSheet[]).push(sheet);
    }
  };
}

// ============================================================================
// Component Registration
// ============================================================================

// Map of component selectors to factory functions
const componentFactories = new Map<string, (target?: HTMLElement) => ComponentInstance>();

/**
 * Track mounted instances for cleanup via destroyComponent.
 * Lazily initialized — only allocated when destroyComponent is first called,
 * so the WeakMap and its .set() calls are absent from bundles that never
 * import destroyComponent.
 * @internal
 */
let mountedInstances: WeakMap<ComponentRoot, ComponentInstance> | null = null;

/**
 * Create the host element with getElementById support.
 * If a target is provided, renders directly into it (no wrapper div).
 * Falls back to a wrapper div for child components.
 */
const createHostElement = (selector: string, target?: HTMLElement): ComponentRoot => {
  if (target) {
    // Render directly into target — no wrapper div
    target.className = target.className ? `${target.className} ${selector}` : selector;
    // Use document.getElementById for native speed
    const root = target as any;
    root.getElementById = (id: string): HTMLElement | null => document.getElementById(id);
    return root as ComponentRoot;
  }
  // Fallback: create wrapper div for child components
  const el = document.createElement('div') as any;
  el.className = selector;
  el.getElementById = (id: string): HTMLElement | null =>
    el.querySelector(`#${id}`);
  return el as ComponentRoot;
};

/**
 * Define a component using the function-based API.
 * 
 * The selector is auto-derived from the export name at compile time.
 * An explicit selector string can be provided as an optional override.
 * 
 * @example
 * // Auto-derived selector: 'my-counter' from export name MyCounter
 * export const MyCounter = defineComponent(() => ({
 *   template: html`<button>Click me</button>`,
 * }));
 * 
 * @example
 * // Explicit selector override
 * export const MyCounter = defineComponent('custom-counter', () => ({
 *   template: html`<button>Click me</button>`,
 * }));
 */
export function defineComponent<P extends ComponentProps = {}>(setup: SetupFunction<P>): ComponentHTMLSelector<P>;
export function defineComponent<P extends ComponentProps = {}>(selector: string, setup: SetupFunction<P>): ComponentHTMLSelector<P>;
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
    selector = (selectorOrSetup as any).__selector;
    setup = selectorOrSetup;
    if (!selector) {
      throw new Error(
        'defineComponent: could not resolve selector. ' +
        'Either pass an explicit selector string or ensure the compiler auto-derives it from the export name.'
      );
    }
  }

  // Collect any extra static templates (for repeat optimizations)
  // The compiler passes them as additional arguments after __compiledTemplate
  const staticTemplatesMap = new Map<string, HTMLTemplateElement>();
  for (let i = 0; i < extraStaticTemplates.length; i += 2) {
    const name = extraStaticTemplates[i];
    const tpl = extraStaticTemplates[i + 1];
    if (typeof name === 'string' && tpl) {
      staticTemplatesMap.set(name, tpl);
    }
  }

  // Register styles once (before factory is called)
  let stylesRegistered = false;

  // Create factory function for component instantiation
  const factory = (target?: HTMLElement): ComponentInstance => {
    const root = createHostElement(selector, target);
    const ctx: ComponentContext<P> = {
      root,
      props: {} as Readonly<P>,
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
    if (result.__bindings) {
      result.__bindings(ctx);
    }

    // Lifecycle: onMount
    if (result.onMount) {
      result.onMount();
    }

    const instance: ComponentInstance = { root };
    if (result.onDestroy) {
      instance.__onDestroy = result.onDestroy;
    }

    return instance;
  };

  componentFactories.set(selector, factory);

  const selectorFn = createComponentHTMLSelector<P>(selector);
  
  // Expose static templates on the selector function for repeat binding lookups
  // The codegen generates references like `Benchmark.__tpl_b0`
  for (const [name, tpl] of staticTemplatesMap) {
    (selectorFn as any)[name] = tpl;
  }
  
  return selectorFn;
}

/**
 * Compiler-optimized component registration.
 *
 * Unlike `defineComponent`, this function:
 * - Always receives the selector as a string (no type branching / error throw)
 * - Returns a minimal ref object (no HTML generation function)
 * - Assigns static templates directly to the ref (no Map allocation)
 *
 * The compiler emits `__registerComponent` in place of `defineComponent`.
 * When no module imports `defineComponent`, esbuild tree-shakes it along
 * with `createComponentHTMLSelector` and the selector-type branching.
 *
 * @internal — emitted by the compiler; not part of the public API.
 */
export function __registerComponent(
  selector: string,
  setup: SetupFunction,
  compiledTemplate?: HTMLTemplateElement,
  ...extraStaticTemplates: any[]
): any {
  let stylesRegistered = false;

  const factory = (target?: HTMLElement): ComponentInstance => {
    const root = createHostElement(selector, target);
    const ctx: ComponentContext = { root, props: {} as Readonly<any> };
    const result = setup(ctx) as InternalComponentResult;

    if (_onStyles && !stylesRegistered && result.styles) {
      _onStyles(selector, result.styles);
      stylesRegistered = true;
    }

    if (compiledTemplate) {
      root.appendChild(compiledTemplate.content.cloneNode(true));
    } else if (result.template) {
      root.innerHTML = result.template;
    }

    if (result.__bindings) result.__bindings(ctx);
    if (result.onMount) result.onMount();

    const instance: ComponentInstance = { root };
    if (result.onDestroy) instance.__onDestroy = result.onDestroy;
    return instance;
  };

  componentFactories.set(selector, factory);

  // Minimal ref — carries __componentSelector for mount() lookup
  // and any static template references for repeat optimizations.
  // No HTML generation function (the compiler handles child rendering via CTFE).
  const ref: any = { __componentSelector: selector };
  for (let i = 0; i < extraStaticTemplates.length; i += 2) {
    const name = extraStaticTemplates[i];
    const tpl = extraStaticTemplates[i + 1];
    if (typeof name === 'string' && tpl) ref[name] = tpl;
  }
  return ref;
}

/**
 * Mount a component to a target element
 * 
 * Accepts either:
 * - A ComponentHTMLSelector function (returned by defineComponent)
 * - An HTML selector string like "<my-page></my-page>"
 * 
 * @param component - Component selector function or HTML string
 * @param target - DOM element to mount to (defaults to document.body)
 * @returns The mounted component root element or null
 */
export function mountComponent(
  component: ComponentHTMLSelector<any> | string,
  target: HTMLElement = document.body
): ComponentRoot | null {
  let selector: string | undefined;

  if (typeof component === 'function') {
    selector = (component as any).__componentSelector;
  } else if (typeof component === 'string') {
    const match = component.match(/<([a-z][a-z0-9-]*)/i);
    if (match) selector = match[1];
  }

  return selector ? _mountBySelector(selector, target) : null;
}

/**
 * Mount a component to a target element (function-only path).
 *
 * This is the recommended mount function.  It only accepts a
 * ComponentHTMLSelector (the return value of defineComponent),
 * so the HTML-string regex path is never included.
 *
 * When an app uses `mount()` and never imports `mountComponent`,
 * esbuild tree-shakes the regex branch entirely.
 *
 * @param component - Component selector function returned by defineComponent
 * @param target - DOM element to mount to (defaults to document.body)
 */
export function mount(
  component: ComponentHTMLSelector<any>,
  target: HTMLElement = document.body,
): ComponentRoot | null {
  const selector: string | undefined = (component as any).__componentSelector;
  return selector ? _mountBySelector(selector, target) : null;
}

/**
 * Shared mount implementation — takes a resolved selector string.
 * @internal
 */
function _mountBySelector(
  selector: string,
  target: HTMLElement,
): ComponentRoot | null {
  const factory = componentFactories.get(selector);
  if (!factory) return null;
  
  const instance = factory(target);

  if (mountedInstances) {
    mountedInstances.set(instance.root, instance);
  }

  if (instance.root !== target) {
    target.appendChild(instance.root);
  }
  
  return instance.root;
}

/**
 * Destroy a mounted component, calling its onDestroy lifecycle hook
 * and removing it from the DOM.
 * 
 * Lazily initializes the mountedInstances WeakMap on first call — from
 * that point forward, mountComponent will also track instances for later
 * cleanup.
 * 
 * @param root - The component root element returned by mountComponent
 */
export function destroyComponent(root: ComponentRoot): void {
  if (!mountedInstances) mountedInstances = new WeakMap();
  const instance = mountedInstances.get(root);
  if (instance?.__onDestroy) instance.__onDestroy();
  root.remove();
  mountedInstances.delete(root);
}

/**
 * Generate HTML selector function for a component.
 * The returned function also carries a __componentSelector property
 * so mount() can look up the factory.
 *
 * Not exported — internal to defineComponent. The HTML-generation body
 * only executes when the function is called with props; most apps only
 * use the __componentSelector property for mount() lookups.
 */
function createComponentHTMLSelector<T extends ComponentProps>(
  selector: string
): ComponentHTMLSelector<T> {
  const fn = ((props: T) => {
    const propsString = Object.entries(props)
      .map(([key, value]) => {
        const val = typeof value === 'string' ? value : JSON.stringify(value) || '';
        return `${key}="${val.replace(/"/g, '&quot;')}"`;
      })
      .join(' ');
    return `<div class="${selector}" ${propsString}></div>`;
  }) as ComponentHTMLSelector<T> & { __componentSelector: string };
  fn.__componentSelector = selector;
  return fn;
}

