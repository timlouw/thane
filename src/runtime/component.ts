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
  /** Compiler-injected binding initializer (short name for bundle size) */
  __b?: (ctx: ComponentContext) => void;
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

/**
 * After a component's template is rendered, scan its root for child elements
 * whose tag name matches a registered component selector. For each match,
 * extract HTML attributes as props and mount the child factory into that element.
 *
 * This enables the CTFE (compile-time function evaluation) path where the
 * compiler inlines `${ChildComponent({ prop: 'val' })}` as
 * `<child-component prop="val"></child-component>` in the parent template.
 * Without this scan, those elements would be inert DOM nodes.
 * REMOVED: Child mounting is now handled by compiler-generated __b binding code (Signal Props).
 */

// ============================================================================
// Host Element Setup (inlined into __registerComponent)
// ============================================================================

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
  const factory = (target?: HTMLElement, props?: P): ComponentInstance => {
    target!.classList.add(selector);
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
    if (result.__b) {
      result.__b(ctx);
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

  // Return a ref object compatible with mount() and repeat template lookups
  const ref: any = { __f: factory };
  for (const [name, tpl] of staticTemplatesMap) {
    ref[name] = tpl;
  }
  return ref;
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
    if (result.__b) result.__b(ctx);
    if (result.onMount) result.onMount();

    return { root };
  };

  const ref: any = { __f: factory };
  for (let i = 0; i < extraStaticTemplates.length; i += 2) {
    ref[extraStaticTemplates[i]] = extraStaticTemplates[i + 1];
  }
  return ref;
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
  props?: Record<string, any>,
): ComponentRoot | null {
  // Both registration paths (defineComponent, __registerComponent)
  // store the factory as __f on the ref.
  const factory: ((t: HTMLElement, p?: Record<string, any>) => ComponentInstance) | undefined = (component as any).__f;
  return factory ? factory(target, props).root : null;
}



