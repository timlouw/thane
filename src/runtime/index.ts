/**
 * Runtime index
 * Main entry point for the runtime library
 */

// Global type declarations for template tags and directives
declare global {
  /**
   * Tagged template for HTML content
   */
  function html(strings: TemplateStringsArray, ...values: any[]): any;

  /**
   * Tagged template for CSS content
   */
  function css(strings: TemplateStringsArray, ...values: any[]): any;

  /**
   * Conditional directive - shows content when condition is truthy
   */
  function when(condition: boolean | (() => boolean)): string;

  /**
   * Conditional directive with else branch
   */
  function whenElse<T, F>(condition: boolean | (() => boolean), thenTemplate: T, elseTemplate: F): T | F;

  /**
   * Repeat directive for rendering arrays
   */
  function repeat<T>(
    items: T[] | (() => T[]),
    templateFn: (item: T, index: number) => any,
    emptyTemplate?: any,
    trackBy?: (item: T, index: number) => string | number,
  ): any[];

  /**
   * Navigate to a path (router)
   */
  function navigate(path: string): void;

  /**
   * Navigate back in history (router)
   */
  function navigateBack(): void;

  /**
   * Get a route parameter value (router)
   */
  function getRouteParam(paramName: string): string;
}

// Export types
export type { Signal, ReadonlySignal, ComponentRoot } from './types.js';

// Export signal and reactive primitives
export { signal, batch, computed, effect, untrack } from './signal.js';

// Export component (public API only — internal symbols live in ./internal.ts)
export {
  defineComponent,
  registerGlobalStyles,
  mount,
  unmount,
  type ComponentContext,
  type ComponentReturnType,
  type MountHandle,
} from './component.js';

// ─────────────────────────────────────────────────────────────
//  Template tag shims
//
//  The compiler replaces html`` and css`` at build time.  These
//  runtime shims exist so that:
//    - Unit tests work without the full build pipeline
//    - Non-compiled contexts (SSR, REPL) get a sensible fallback
//    - TypeScript is satisfied at the call site
//
//  The html shim escapes interpolated values to prevent XSS.
//  In compiled builds, the compiler generates direct DOM bindings
//  that bypass innerHTML entirely, so this is a non-compiled-only
//  safety net.
// ─────────────────────────────────────────────────────────────

/** Escape HTML-significant characters in interpolated values. */
const _esc = (val: unknown): string => {
  const s = String(val);
  if (s.length === 0) return s;
  // Only allocate a new string when at least one special char is present.
  // The 5 characters checked are the full set required by the HTML spec.
  if (!/[&<>"']/.test(s)) return s;
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/**
 * Runtime shim for the `html` tagged template literal.
 *
 * In compiled builds this is replaced by the compiler.  In tests or
 * non-compiled environments it concatenates the template literal with
 * HTML-escaped interpolated values to prevent XSS injection.
 */
export const html = (strings: TemplateStringsArray, ...values: unknown[]): string => {
  let result = strings[0]!;
  for (let i = 0; i < values.length; i++) {
    result += _esc(values[i]) + strings[i + 1]!;
  }
  return result;
};

/**
 * Runtime shim for the `css` tagged template literal.
 *
 * Identical behaviour to the old html shim — returns a plain concatenated
 * string (CSS values are not HTML-escaped since they are applied via
 * CSSStyleSheet, not innerHTML).
 */
export const css = (strings: TemplateStringsArray, ...values: unknown[]): string =>
  String.raw({ raw: strings }, ...values);
