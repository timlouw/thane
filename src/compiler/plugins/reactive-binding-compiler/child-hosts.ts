/**
 * Child component hosts in the template.
 *
 * The component precompiler leaves a placeholder comment where a child component call was written
 * (`${Card({…})}` → `<!--b3.-->`). The child's host element takes its place in the template
 * (`<x-card data-thane-ref="b3"></x-card>`), so the clone creates it and compiled code reaches it by
 * path and mounts the child into it. Compiled code used to create that element when it bound the
 * template (`createElement` and `replaceWith`); now the clone creates it, in the same place.
 *
 * Where the browser's parser would not keep an element in the placeholder's place (it moves one
 * out of a table, does not keep one inside a `<select>`, makes one an svg or MathML element), the
 * comment stays as the child's anchor and the host replaces it at mount, as before. A placeholder
 * can be in more than one template (a branch pre-rendered in its parent is in both); the host goes
 * in only when it fits in every one.
 */

import type { EmitOptions } from './types.js';
import type { ChildMountInfo } from '../component-precompiler/component-precompiler.js';
import { buildDomModel, cookTemplateText, type DomModel, type DomNode } from './dom-model.js';
import { walkDirectives, type DirectiveRoots } from './directive-tree.js';
import { anchorMark, BOUND_MARK } from './template-utils.js';

const modelOf = (html: string, emit: EmitOptions): DomModel => buildDomModel(cookTemplateText(emit.html(html)));

const find = (model: DomModel, match: (n: DomNode) => boolean): DomNode | undefined => {
  const walk = (nodes: DomNode[]): DomNode | undefined => {
    for (const n of nodes) {
      if (match(n)) return n;
      const inner = walk(n.children);
      if (inner) return inner;
    }
    return undefined;
  };
  return walk(model.roots);
};

/** A node's position: its index among its siblings, at each level from the top. */
const positionOf = (model: DomModel, node: DomNode): string => {
  const at: number[] = [];
  for (let n: DomNode | null = node; n; n = n.parent)
    at.unshift((n.parent ? n.parent.children : model.roots).indexOf(n));
  return at.join('.');
};

/** True when the browser keeps `host`, as an HTML element, in the place of child `id`'s placeholder in `html`. */
const hostFits = (html: string, id: string, host: string, emit: EmitOptions): boolean => {
  const before = modelOf(html, emit);
  const anchor = find(before, (n) => n.kind === 'comment' && n.data === `${id}.`);
  if (!anchor) return false;
  for (let p = anchor.parent; p; p = p.parent) if (p.tag === 'svg' || p.tag === 'math') return false;
  const after = modelOf(html.replace(anchorMark(id, '.'), host), emit);
  const placed = find(after, (n) => n.kind === 'element' && n.attrs.get(BOUND_MARK) === id);
  // The host must be where the placeholder was: in the same parent. (Its index there can differ: the
  // production minifier drops whitespace between two elements, not between an element and a comment.)
  const parentOf = (model: DomModel, n: DomNode): string => (n.parent ? positionOf(model, n.parent) : 'top');
  return (
    placed !== undefined &&
    after.problems.length === before.problems.length &&
    parentOf(after, placed) === parentOf(before, anchor)
  );
};

/**
 * Put each child's host into the templates in place of its placeholder where it fits (see above),
 * changing the component template and the directive blocks' templates in place. Returns the ids of
 * the children whose host is in the template; the others keep their comment anchor.
 */
export const placeChildHosts = (
  mounts: readonly ChildMountInfo[],
  component: { template: string },
  directives: DirectiveRoots,
  emit: EmitOptions,
): Set<string> => {
  const hosts = new Set<string>();
  if (mounts.length === 0) return hosts;
  // Every template of the component: its own, and each branch's and row's
  const slots: { get: () => string; set: (html: string) => void }[] = [
    { get: () => component.template, set: (html) => (component.template = html) },
  ];
  walkDirectives(directives, {
    cond: (c) => void slots.push({ get: () => c.templateContent, set: (html) => (c.templateContent = html) }),
    whenElse: (we) =>
      void slots.push(
        { get: () => we.thenTemplate, set: (html) => (we.thenTemplate = html) },
        { get: () => we.elseTemplate, set: (html) => (we.elseTemplate = html) },
      ),
    repeat: (rep) => void slots.push({ get: () => rep.itemTemplate, set: (html) => (rep.itemTemplate = html) }),
  });
  for (const cm of mounts) {
    // A fragment is mounted before its placeholder
    if (cm.fragment) continue;
    const mark = anchorMark(cm.anchorId, '.');
    const tag = emit.selector(cm.selector);
    const host = `<${tag} ${BOUND_MARK}="${cm.anchorId}"></${tag}>`;
    const holders = slots.filter((slot) => slot.get().includes(mark));
    if (holders.length === 0 || !holders.every((slot) => hostFits(slot.get(), cm.anchorId, host, emit))) continue;
    for (const slot of holders) slot.set(slot.get().replace(mark, host));
    hosts.add(cm.anchorId);
  }
  return hosts;
};
