/**
 * An element of a component's template, named in its tag: `<input ${input}>`. The compiled template assigns the
 * element to `el` when it binds, before `onMount`; in a `when()` branch, when the branch shows, and `null` while it
 * is hidden. Reading `el` in the setup itself, before the template is bound, gives `null`.
 */
export interface Ref<T extends Element = HTMLElement> {
  readonly el: T;
}

/**
 * A ref to an element of the component's template: put it in the element's tag.
 *
 * @example
 * const input = ref<HTMLInputElement>();
 * return {
 *   template: html`<input ${input} />`,
 *   onMount: () => input.el.focus(),
 * };
 */
export const ref = <T extends Element = HTMLElement>(): Ref<T> => ({ el: null as unknown as T });
