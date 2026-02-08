/**
 * Component implementation — defineComponent API
 * 
 * Thane uses native DOM mode — no Web Components Shadow DOM required.
 * Components are rendered as regular DOM elements with scoped styles.
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
 */
export interface ComponentReturnType {
  /** HTML template (html tagged template literal) */
  template: string;
  /** Scoped styles (css tagged template literal) */
  styles?: string;
  /** Called after template is in the DOM and bindings are initialized */
  onMount?(): void;
  /** Called when the component is removed from the DOM */
  onDestroy?(): void;
}

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

// Track registered styles to avoid duplicates
const registeredStyles = new Set<string>();

// Global style element reference
let globalStyleEl: HTMLStyleElement | null = null;

/**
 * Ensure global style element exists in document head
 */
const ensureGlobalStyleElement = (): HTMLStyleElement => {
  if (!globalStyleEl) {
    globalStyleEl = document.createElement('style');
    globalStyleEl.id = 'thane-styles';
    document.head.appendChild(globalStyleEl);
  }
  return globalStyleEl;
};

/**
 * Append a CSS string directly to the global style element
 */
const appendStyle = (cssText: string): void => {
  const styleEl = ensureGlobalStyleElement();
  styleEl.textContent += cssText + '\n';
};

/**
 * Register global styles to be added to the document
 * 
 * @param styles - CSS strings to register
 */
export function registerGlobalStyles(...styles: string[]): void {
  for (const cssText of styles) {
    if (!registeredStyles.has(cssText)) {
      registeredStyles.add(cssText);
      appendStyle(cssText);
    }
  }
}

// ============================================================================
// Component Registration
// ============================================================================

// Map of component selectors to factory functions
const componentFactories = new Map<string, () => ComponentInstance>();

/**
 * Create the host element with getElementById support
 */
const createHostElement = (selector: string): ComponentRoot => {
  const el = document.createElement('div') as any;
  el.className = selector;
  el.setAttribute('data-thane', selector);
  el.getElementById = (id: string): HTMLElement | null => {
    if (el.id === id) return el;
    return el.querySelector(`#${id}`);
  };
  return el as ComponentRoot;
};

/**
 * Register component styles with :host scoping
 */
const registerComponentStyles = (selector: string, styles: string): void => {
  if (styles && !registeredStyles.has(selector)) {
    registeredStyles.add(selector);
    const scopedStyles = styles
      .replace(/:host\b/g, `.${selector}`)
      .replace(/:host\(/g, `.${selector}(`);
    appendStyle(`/* ${selector} */\n${scopedStyles}`);
  }
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
  // The compiler passes them as additional arguments after __compiledBindings
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
  const factory = (): ComponentInstance => {
    const root = createHostElement(selector);
    const ctx: ComponentContext<P> = {
      root,
      props: {} as Readonly<P>,
    };

    const result = setup(ctx) as InternalComponentResult;

    // Register styles (once)
    if (!stylesRegistered && result.styles) {
      registerComponentStyles(selector, result.styles);
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
    // ComponentHTMLSelector function — read the selector from it
    selector = (component as any).__componentSelector;
  } else if (typeof component === 'string') {
    // HTML selector string like "<my-page></my-page>"
    const match = component.match(/<([a-z][a-z0-9-]*)/i);
    if (match) selector = match[1];
  }

  if (!selector) return null;
  
  const factory = componentFactories.get(selector);
  
  if (!factory) {
    console.error(`Component not found: ${selector}`);
    return null;
  }
  
  const instance = factory();
  target.appendChild(instance.root);
  
  return instance.root;
}

// Alias for mountComponent
export { mountComponent as mount };

/**
 * Generate HTML selector function for a component.
 * The returned function also carries a __componentSelector property
 * so mount() can look up the factory.
 */
export function createComponentHTMLSelector<T extends ComponentProps>(
  selector: string
): ComponentHTMLSelector<T> {
  const fn = ((props: T) => {
    const propsString = Object.entries(props)
      .map(([key, value]) => {
        const val = typeof value === 'string' ? value : JSON.stringify(value) || '';
        return `${key}="${val.replace(/"/g, '&quot;')}"`;
      })
      .join(' ');
    return `<div data-thane-component="${selector}" ${propsString}></div>`;
  }) as ComponentHTMLSelector<T> & { __componentSelector: string };
  fn.__componentSelector = selector;
  return fn;
}

