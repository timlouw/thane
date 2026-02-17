/**
 * DOM Binding utilities for Thane runtime
 * 
 * Handles conditional rendering and repeat directives.
 */

import type { Signal, ComponentRoot } from './types.js';

// Temporary element for parsing HTML (lazy initialization)
let tempEl: HTMLTemplateElement | null = null;
const getTempEl = (): HTMLTemplateElement => {
  if (!tempEl) {
    tempEl = document.createElement('template');
  }
  return tempEl;
};

// Reusable Set for keyed reconciliation (avoids allocation per reconcile pass)
const _keySet = new Set<string | number>();

/**
 * Internal helper for conditional binding (when/whenElse)
 */
const bindConditional = (
  _root: ComponentRoot,
  id: string,
  template: string,
  initNested: (contentEl?: Element) => (() => void)[],
  subscribe: (update: () => void) => (() => void)[],
  evalCondition: () => boolean,
  anchorEl?: Element | null,
): (() => void) => {
  let cleanups: (() => void)[] = [];
  let bindingsInitialized = false;

  // Use provided anchor element (for repeat-nested conditionals) or global getElementById
  let currentNode: Element | null = anchorEl || document.getElementById(id);
  if (!currentNode) return () => {};
  const initiallyShowing = currentNode.tagName !== 'TEMPLATE';

  let contentEl: HTMLElement;
  if (initiallyShowing) {
    contentEl = currentNode as HTMLElement;
  } else {
    const tpl = getTempEl();
    tpl.innerHTML = template;
    contentEl = (tpl.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement;
  }

  let currentlyShowing = initiallyShowing;

  if (initiallyShowing) {
    bindingsInitialized = true;
    cleanups = initNested(contentEl);
  }

  const show = () => {
    if (currentlyShowing) return;
    currentlyShowing = true;
    if (currentNode && contentEl) {
      currentNode.replaceWith(contentEl);
      currentNode = contentEl;
      if (!bindingsInitialized) {
        bindingsInitialized = true;
        cleanups = initNested(contentEl);
      }
    }
  };

  const hide = () => {
    if (!currentlyShowing) return;
    currentlyShowing = false;
    if (currentNode) {
      const p = document.createElement('template');
      p.id = id;
      currentNode.replaceWith(p);
      currentNode = p;
    }
  };

  const update = () => {
    if (evalCondition()) {
      show();
    } else {
      hide();
    }
  };

  const unsubscribes = subscribe(update);
  update();

  return () => {
    for (let i = 0; i < unsubscribes.length; i++) unsubscribes[i]?.();
    for (let i = 0; i < cleanups.length; i++) cleanups[i]?.();
    cleanups = [];
  };
};

export const __bindIf = (
  root: ComponentRoot, 
  signal: Signal<any>, 
  id: string, 
  template: string, 
  initNested: (contentEl?: Element) => (() => void)[],
  anchorEl?: Element | null,
): (() => void) =>
  bindConditional(
    root, id, template, initNested,
    (update) => [signal.subscribe(update, true)],
    () => Boolean(signal()),
    anchorEl,
  );

export const __bindIfExpr = (
  root: ComponentRoot, 
  signals: Signal<any>[], 
  evalExpr: () => boolean, 
  id: string, 
  template: string, 
  initNested: (contentEl?: Element) => (() => void)[],
  anchorEl?: Element | null,
): (() => void) =>
  bindConditional(root, id, template, initNested, (update) => signals.map((s) => s.subscribe(update, true)), evalExpr, anchorEl);

// ─────────────────────────────────────────────────────────────
//  Shared Reconciler
// ─────────────────────────────────────────────────────────────

/**
 * Managed item in a repeat directive
 */
interface ManagedItem<T> {
  itemSignal: Signal<T> | null;
  el: Element;
  cleanups: (() => void)[];
  /** Direct update function — bypasses signal when set (A7 optimization) */
  update?: ((newValue: T) => void) | undefined;
  /** Cached value for direct update path (no signal) */
  value?: T | undefined;
}

/**
 * Key function type for tracking items in repeat
 */
type KeyFn<T> = (item: T, index: number) => string | number;

// ─────────────────────────────────────────────────────────────
//  createKeyedReconciler — Keyed-only, direct-update mode
//
//  Used by the optimized compiler path (inlined createItem) when
//  a keyFn is provided and there is no emptyTemplate.
//
//  Compared to createReconciler, this variant strips:
//  - Index-based fallback (always keyed)
//  - getValue/setValue signal branching (always .value/.update)
//  - Cleanup iteration (optimized items have empty cleanups)
//  - keyFn/keyMap null guards (always present)
//  - useDetachOptimization parameter (always uses detach)
//
//  Keeps the SAME ManagedItem<T> object shape and per-row update
//  closures — preserves V8 type feedback from the full reconciler.
// ─────────────────────────────────────────────────────────────

export function createKeyedReconciler<T>(
  container: ParentNode & Element,
  anchor: Element,
  createItemFn: (item: T, index: number, refNode: Node) => ManagedItem<T>,
  keyFn: KeyFn<T>,
) {
  const containerParent = container.parentNode;
  const containerNextSibling = container.nextSibling;

  const managedItems: ManagedItem<T>[] = [];
  const keyMap = new Map<string | number, ManagedItem<T>>();

  const removeItem = (managed: ManagedItem<T>) => {
    const cleanups = managed.cleanups;
    for (let i = 0, len = cleanups.length; i < len; i++) cleanups[i]!();
    managed.el.remove();
  };

  const clearAll = () => {
    const len = managedItems.length;
    if (len === 0) return;
    // Iterate cleanups (subscriptions, nested reconcilers) before clearing DOM
    for (let i = 0; i < len; i++) {
      const cleanups = managedItems[i]!.cleanups;
      for (let j = 0, clen = cleanups.length; j < clen; j++) cleanups[j]!();
    }
    const anchorParent = anchor.parentNode;
    if (anchorParent) {
      anchor.remove();
      (container as HTMLElement).textContent = '';
      container.appendChild(anchor);
    }
    managedItems.length = 0;
    keyMap.clear();
  };

  const bulkCreate = (items: T[], startIndex: number = 0) => {
    const count = items.length;
    if (count === 0) return;

    if (containerParent) container.remove();

    const base = managedItems.length;
    managedItems.length = base + count;
    for (let i = 0; i < count; i++) {
      const item = items[i]!;
      const idx = startIndex + i;
      const managed = createItemFn(item, idx, anchor);
      managedItems[base + i] = managed;
      keyMap.set(keyFn(item, idx), managed);
    }

    if (containerParent) containerParent.insertBefore(container, containerNextSibling);
  };

  const reconcile = (newItems: T[]) => {
    const newLength = newItems?.length ?? 0;
    const oldLength = managedItems.length;

    if (newLength === 0) { clearAll(); return; }
    if (oldLength === 0) { bulkCreate(newItems); return; }

    // Fast path: single item removed — build new-key set, find missing old key
    if (oldLength === newLength + 1) {
      for (let i = 0; i < newLength; i++) _keySet.add(keyFn(newItems[i]!, i));
      let removedIdx = -1;
      let removedKey: string | number | undefined;
      for (let i = 0; i < oldLength; i++) {
        const key = keyFn(managedItems[i]!.value!, i);
        if (!_keySet.has(key)) { removedIdx = i; removedKey = key; break; }
      }
      _keySet.clear();
      if (removedIdx !== -1) {
        removeItem(managedItems[removedIdx]!);
        keyMap.delete(removedKey!);
        managedItems.splice(removedIdx, 1);
        return;
      }
    }

    // Fast path: reorder with same keys (fused allKeysExist + update in single pass)
    if (oldLength === newLength) {
      let allKeysExist = true;
      let mismatchCount = 0, mismatch1 = -1, mismatch2 = -1;

      for (let i = 0; i < newLength; i++) {
        const newItem = newItems[i]!;
        const existing = keyMap.get(keyFn(newItem, i));
        if (!existing) { allKeysExist = false; break; }
        if (existing.value !== newItem) { existing.value = newItem; existing.update!(newItem); }
        if (managedItems[i] !== existing) {
          mismatchCount++;
          if (mismatchCount === 1) mismatch1 = i;
          else if (mismatchCount === 2) mismatch2 = i;
          if (mismatchCount > 2) break;
        }
      }

      if (allKeysExist) {

        if (mismatchCount === 0) return;

        if (mismatchCount === 2) {
          const m1 = managedItems[mismatch1]!, m2 = managedItems[mismatch2]!;
          const k1 = keyFn(newItems[mismatch1]!, mismatch1), k2 = keyFn(newItems[mismatch2]!, mismatch2);
          if (keyMap.get(k1) === m2 && keyMap.get(k2) === m1) {
            const el1 = m1.el, el2 = m2.el;
            const next1 = el1.nextSibling, next2 = el2.nextSibling;
            if (next1 === el2) container.insertBefore(el2, el1);
            else if (next2 === el1) container.insertBefore(el1, el2);
            else { container.insertBefore(el2, next1); container.insertBefore(el1, next2); }
            managedItems[mismatch1] = m2; managedItems[mismatch2] = m1;
            return;
          }
        }

        const newManagedItems: ManagedItem<T>[] = new Array(newLength);
        for (let i = 0; i < newLength; i++) newManagedItems[i] = keyMap.get(keyFn(newItems[i]!, i))!;

        let currentEl: Element | null = managedItems[0]?.el || null;
        for (let i = 0; i < newLength; i++) {
          const wanted = newManagedItems[i]!.el;
          if (wanted === currentEl) currentEl = currentEl?.nextElementSibling || null;
          else container.insertBefore(wanted, currentEl);
        }
        managedItems.length = newLength;
        for (let i = 0; i < newLength; i++) managedItems[i] = newManagedItems[i]!;
        return;
      }
    }

    // Fast path: complete replacement (first and last keys both new)
    if (oldLength > 0 && oldLength === newLength) {
      const firstNewKey = keyFn(newItems[0]!, 0);
      if (!keyMap.has(firstNewKey)) {
        const lastNewKey = keyFn(newItems[newLength - 1]!, newLength - 1);
        if (!keyMap.has(lastNewKey)) { clearAll(); bulkCreate(newItems); return; }
      }
    }

    // General keyed reconciliation
    for (let i = 0; i < newLength; i++) _keySet.add(keyFn(newItems[i]!, i));

    const kept: ManagedItem<T>[] = [];
    for (let i = 0; i < oldLength; i++) {
      const managed = managedItems[i]!;
      const key = keyFn(managed.value!, i);
      if (_keySet.has(key)) kept.push(managed);
      else { removeItem(managed); keyMap.delete(key); }
    }
    _keySet.clear();
    managedItems.length = kept.length;
    for (let i = 0; i < kept.length; i++) managedItems[i] = kept[i]!;

    const newManagedItems: ManagedItem<T>[] = [];
    for (let i = 0; i < newLength; i++) {
      const newItem = newItems[i]!;
      const key = keyFn(newItem, i);
      const existing = keyMap.get(key);
      if (existing) {
        if (existing.value !== newItem) { existing.value = newItem; existing.update!(newItem); }
        newManagedItems.push(existing);
      } else {
        const refNode = i < managedItems.length ? managedItems[i]!.el : anchor;
        const managed = createItemFn(newItem, i, refNode);
        keyMap.set(key, managed);
        newManagedItems.push(managed);
      }
    }

    let currentEl: Element | null = newManagedItems[0]?.el.previousElementSibling?.nextElementSibling || container.firstElementChild;
    for (let i = 0; i < newLength; i++) {
      const wanted = newManagedItems[i]!.el;
      if (wanted === currentEl) currentEl = currentEl?.nextElementSibling || null;
      else container.insertBefore(wanted, currentEl);
    }
    managedItems.length = newLength;
    for (let i = 0; i < newLength; i++) managedItems[i] = newManagedItems[i]!;
  };

  return { reconcile, clearAll };
}
