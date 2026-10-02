/**
 * A fragment one module exports and another's template uses: `export const Spinner = html\`…\``. The
 * compiler turns the export into a value, its static template and the function that binds a copy of it,
 * and mounts that value where a template uses it, before the comment that stands in its place. A
 * fragment used in its own module is inlined instead, and needs none of this.
 */

/** @internal */
export interface FragmentContext {
  /** The copy of the fragment's template, before it is placed */
  root: DocumentFragment;
  /** Puts the copy in its place: the binding function calls it once it has reached every node it binds */
  place(): void;
}

/** A compiled fragment. @internal */
export interface CompiledFragment {
  /** The fragment's static template */
  t: HTMLTemplateElement;
  /** Binds a copy of it and returns the cleanup; a fragment without bindings has none */
  b?: (ctx: FragmentContext, elements: NodeListOf<Element>) => () => void;
}

const noCleanup = (): void => {};

/**
 * Mounts a copy of `fragment` before `anchor`, and returns the function that releases its bindings. The
 * nodes go with the template around them: a branch or a row removes them with its own. A fragment is an exported
 * one, or a template a parent passed to a child as a prop (a slot); one left out (`undefined`) mounts nothing.
 * @internal — emitted by the compiler; not part of the public API.
 */
export const __mf = (anchor: Node, fragment: CompiledFragment | undefined): (() => void) => {
  // A slot the parent left out
  if (!fragment) return noCleanup;
  const root = fragment.t.content.cloneNode(true) as DocumentFragment;
  const place = (): void => void anchor.parentNode!.insertBefore(root, anchor);
  if (!fragment.b) {
    place();
    return noCleanup;
  }
  return fragment.b({ root, place }, root.querySelectorAll('*'));
};
