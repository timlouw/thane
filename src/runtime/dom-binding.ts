/**
 * DOM Binding utilities for Thane runtime
 * 
 * Handles event delegation, conditional rendering, and repeat directives.
 */

import type { Signal, ComponentRoot } from './types.js';
import { signal as createSignal } from './signal.js';

/**
 * Keyboard key code mappings for event modifiers
 */
const KEY_CODES: Record<string, string[]> = {
  enter: ['Enter'],
  tab: ['Tab'],
  delete: ['Backspace', 'Delete'],
  esc: ['Escape'],    // shorthand alias
  escape: ['Escape'],
  space: [' '],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
};

/**
 * Set up event delegation on a component root
 */
export const __setupEventDelegation = (
  root: ComponentRoot, 
  eventMap: Record<string, Record<string, (event: Event) => void>>
): (() => void) => {
  const cleanups: (() => void)[] = [];

  for (const eventType in eventMap) {
    const handlers = eventMap[eventType];
    const attrName = `data-evt-${eventType}`;

    const delegatedHandler = (event: Event) => {
      let target = event.target as Element | null;

      while (target && target !== (root as unknown as Element)) {
        if (target instanceof HTMLElement) {
          const handlerIdWithModifiers = target.getAttribute(attrName);
          if (handlerIdWithModifiers) {
            const parts = handlerIdWithModifiers.split(':');
            const handlerId = parts[0];
            if (!handlerId) continue;

            const handler = handlers?.[handlerId];
            if (handler) {
              if (parts.includes('self') && event.target !== target) {
                target = target.parentElement;
                continue;
              }

              if (event instanceof KeyboardEvent) {
                let keyMatched = true;
                for (let i = 1; i < parts.length; i++) {
                  const mod = parts[i];
                  const keyCodes = mod ? KEY_CODES[mod] : undefined;
                  if (keyCodes) {
                    keyMatched = keyCodes.includes(event.key);
                    if (!keyMatched) break;
                  }
                }
                if (!keyMatched) {
                  target = target.parentElement;
                  continue;
                }
              }

              if (parts.includes('prevent')) event.preventDefault();
              if (parts.includes('stop')) event.stopPropagation();

              handler.call(null, event);
              return;
            }
          }
        }
        target = target.parentElement;
      }
    };

    root.addEventListener(eventType, delegatedHandler, true);
    cleanups.push(() => {
      root.removeEventListener(eventType, delegatedHandler, true);
    });
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
};

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
 * Find an element by ID within a set of elements
 */
export const __findEl = (elements: Element[], id: string): Element | null => {
  if (elements.length === 1) {
    const el = elements[0]!;
    if (el.id === id) return el;
    const bindId = el.getAttribute('data-bind-id');
    if (bindId === id) return el;
    return el.querySelector(`#${id},[data-bind-id="${id}"]`);
  }
  
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) continue;
    if (el.id === id) return el;
    const bindId = el.getAttribute('data-bind-id');
    if (bindId === id) return el;
    const found = el.querySelector(`#${id},[data-bind-id="${id}"]`);
    if (found) return found;
  }
  return null;
};

/**
 * Find a text node by comment marker ID within a set of elements
 */
export const __findTextNode = (elements: Element[], id: string): Text | null => {
  const walkNodes = (node: Node): Text | null => {
    if (node.nodeType === Node.COMMENT_NODE && node.textContent === id) {
      const nextSibling = node.nextSibling;
      if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
        return nextSibling as Text;
      }
      const textNode = document.createTextNode('');
      node.parentNode?.insertBefore(textNode, node.nextSibling);
      return textNode;
    }
    
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const result = walkNodes(children[i]!);
      if (result) return result;
    }
    
    return null;
  };
  
  for (const el of elements) {
    const result = walkNodes(el);
    if (result) return result;
  }
  
  return null;
};

/**
 * Internal helper for conditional binding (when/whenElse)
 */
const bindConditional = (
  root: ComponentRoot,
  id: string,
  template: string,
  initNested: () => (() => void)[],
  subscribe: (update: () => void) => (() => void)[],
  evalCondition: () => boolean,
): (() => void) => {
  let cleanups: (() => void)[] = [];
  let bindingsInitialized = false;

  const initialElement = root.getElementById(id);
  const initiallyShowing = initialElement?.tagName !== 'TEMPLATE';

  let contentEl: HTMLElement;
  if (initiallyShowing) {
    contentEl = initialElement as HTMLElement;
  } else {
    const tpl = getTempEl();
    tpl.innerHTML = template;
    contentEl = (tpl.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement;
  }

  let currentlyShowing = initiallyShowing;

  if (initiallyShowing) {
    bindingsInitialized = true;
    cleanups = initNested();
  }

  const show = () => {
    if (currentlyShowing) return;
    currentlyShowing = true;
    const current = root.getElementById(id);
    if (current && contentEl) {
      current.replaceWith(contentEl);
      if (!bindingsInitialized) {
        bindingsInitialized = true;
        cleanups = initNested();
      }
    }
  };

  const hide = () => {
    if (!currentlyShowing) return;
    currentlyShowing = false;
    const current = root.getElementById(id);
    if (current) {
      const p = document.createElement('template');
      p.id = id;
      current.replaceWith(p);
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
  initNested: () => (() => void)[]
): (() => void) =>
  bindConditional(
    root, id, template, initNested,
    (update) => [signal.subscribe(update, true)],
    () => Boolean(signal()),
  );

export const __bindIfExpr = (
  root: ComponentRoot, 
  signals: Signal<any>[], 
  evalExpr: () => boolean, 
  id: string, 
  template: string, 
  initNested: () => (() => void)[]
): (() => void) =>
  bindConditional(root, id, template, initNested, (update) => signals.map((s) => s.subscribe(update, true)), evalExpr);

// ─────────────────────────────────────────────────────────────
//  Shared Reconciler
// ─────────────────────────────────────────────────────────────

/**
 * Managed item in a repeat directive
 */
interface ManagedItem<T> {
  itemSignal: Signal<T>;
  el: Element;
  cleanups: (() => void)[];
}

/**
 * Key function type for tracking items in repeat
 */
type KeyFn<T> = (item: T, index: number) => string | number;

/**
 * Configuration for the shared reconciler.
 * 
 * The reconciler is generic over how items are created — the caller provides
 * a factory function. This allows `__bindRepeat` (HTML-string based),
 * `__bindRepeatTpl` (template-clone based), and `__bindNestedRepeat` to
 * all share the same reconciliation algorithm.
 */
interface ReconcilerConfig<T> {
  /** The container element that holds all items */
  container: ParentNode & Element;
  /** The anchor element at the end of the item list */
  anchor: Element;
  /** Parent node of container (for detach optimization in bulk operations) */
  containerParent: Node | null;
  /** Next sibling of container (for re-attach after detach) */
  containerNextSibling: Node | null;
  /** Factory: create a ManagedItem and insert its element before refNode */
  createItem: (item: T, index: number, refNode: Node) => ManagedItem<T>;
  /** Optional key function for keyed reconciliation */
  keyFn?: KeyFn<T> | undefined;
  /** Optional HTML to show when array is empty */
  emptyTemplate?: string | undefined;
  /** Whether to use detach optimization for bulk creates (disabled for nested repeats) */
  useDetachOptimization?: boolean | undefined;
}

/**
 * Create a reconciler instance that manages a list of items in the DOM.
 * 
 * This is the single shared implementation used by all three repeat binding
 * variants (__bindRepeat, __bindRepeatTpl, __bindNestedRepeat).
 */
function createReconciler<T>(config: ReconcilerConfig<T>) {
  const {
    container, anchor, containerParent, containerNextSibling,
    createItem: createItemFn, keyFn, emptyTemplate,
    useDetachOptimization = true,
  } = config;

  const managedItems: ManagedItem<T>[] = [];
  const keyMap: Map<string | number, ManagedItem<T>> | null = keyFn ? new Map() : null;

  let emptyElement: Element | null = null;
  let emptyShowing = false;

  const showEmpty = () => {
    if (emptyShowing || !emptyTemplate) return;
    emptyShowing = true;
    const tpl = getTempEl();
    tpl.innerHTML = emptyTemplate;
    emptyElement = (tpl.content.cloneNode(true) as DocumentFragment).firstElementChild;
    if (emptyElement) container.insertBefore(emptyElement, anchor);
  };

  const hideEmpty = () => {
    if (!emptyShowing || !emptyElement) return;
    emptyShowing = false;
    emptyElement.remove();
    emptyElement = null;
  };

  const removeItem = (managed: ManagedItem<T>) => {
    const cleanups = managed.cleanups;
    for (let i = 0, len = cleanups.length; i < len; i++) {
      cleanups[i]!();
    }
    managed.el.remove();
  };

  const clearAll = () => {
    const len = managedItems.length;
    if (len === 0) return;
    
    for (let i = 0; i < len; i++) {
      const cleanups = managedItems[i]!.cleanups;
      for (let j = 0, clen = cleanups.length; j < clen; j++) {
        cleanups[j]!();
      }
    }
    
    const anchorParent = anchor.parentNode;
    if (anchorParent) {
      anchor.remove();
      (container as HTMLElement).textContent = '';
      container.appendChild(anchor);
    }
    
    managedItems.length = 0;
    if (keyMap) keyMap.clear();
  };

  const bulkCreate = (items: T[], startIndex: number = 0) => {
    const count = items.length;
    if (count === 0) return;
    
    if (useDetachOptimization && containerParent) {
      container.remove();
    }
    
    for (let i = 0; i < count; i++) {
      const managed = createItemFn(items[i]!, startIndex + i, anchor);
      managedItems.push(managed);
      if (keyMap && keyFn) {
        keyMap.set(keyFn(items[i]!, startIndex + i), managed);
      }
    }
    
    if (useDetachOptimization && containerParent) {
      containerParent.insertBefore(container, containerNextSibling);
    }
  };

  /**
   * Core reconciliation algorithm.
   * 
   * Handles keyed reconciliation (with fast paths for single removal,
   * same-key reorder, 2-element swap) and index-based fallback.
   */
  const reconcile = (newItems: T[]) => {
    const newLength = newItems?.length ?? 0;
    const oldLength = managedItems.length;

    if (newLength === 0) {
      clearAll();
      showEmpty();
      return;
    }
    hideEmpty();

    // ── Keyed reconciliation ──
    if (keyMap && keyFn) {
      // Fast path: single item removed
      if (oldLength === newLength + 1) {
        let removedIdx = -1;
        
        for (let i = 0; i < newLength; i++) {
          const newKey = keyFn(newItems[i]!, i);
          const oldKey = keyFn(managedItems[i]!.itemSignal(), i);
          if (newKey !== oldKey) {
            removedIdx = i;
            break;
          }
        }
        
        if (removedIdx === -1) removedIdx = oldLength - 1;
        
        const removedManaged = managedItems[removedIdx]!;
        const removedKey = keyFn(removedManaged.itemSignal(), removedIdx);
        
        let isActualRemoval = true;
        for (let i = removedIdx; i < newLength; i++) {
          if (keyFn(newItems[i]!, i) === removedKey) {
            isActualRemoval = false;
            break;
          }
        }
        
        if (isActualRemoval) {
          removeItem(removedManaged);
          keyMap.delete(removedKey);
          
          // Array rebuild instead of splice — O(n) total instead of O(n) per splice shift
          const rebuilt: ManagedItem<T>[] = new Array(oldLength - 1);
          for (let i = 0; i < removedIdx; i++) rebuilt[i] = managedItems[i]!;
          for (let i = removedIdx; i < oldLength - 1; i++) rebuilt[i] = managedItems[i + 1]!;
          managedItems.length = 0;
          for (let i = 0; i < rebuilt.length; i++) managedItems.push(rebuilt[i]!);
          
          return;
        }
      }
      
      // Fast path: reorder with same keys
      if (oldLength === newLength) {
        let allKeysExist = true;
        for (let i = 0; i < newLength && allKeysExist; i++) {
          const key = keyFn(newItems[i]!, i);
          if (!keyMap.has(key)) allKeysExist = false;
        }
        
        if (allKeysExist) {
          const newManagedItems: ManagedItem<T>[] = [];
          let mismatchCount = 0;
          let mismatch1 = -1, mismatch2 = -1;
          
          for (let i = 0; i < newLength; i++) {
            const newItem = newItems[i]!;
            const key = keyFn(newItem, i);
            const existing = keyMap.get(key)!;
            
            if (existing.itemSignal() !== newItem) {
              existing.itemSignal(newItem);
            }
            
            if (managedItems[i] !== existing) {
              mismatchCount++;
              if (mismatchCount === 1) mismatch1 = i;
              else if (mismatchCount === 2) mismatch2 = i;
            }
            
            newManagedItems.push(existing);
          }
          
          if (mismatchCount === 0) return;
          
          // Fast path: two items swapped
          if (mismatchCount === 2 &&
              managedItems[mismatch1] === newManagedItems[mismatch2] &&
              managedItems[mismatch2] === newManagedItems[mismatch1]) {
            const el1 = newManagedItems[mismatch1]!.el;
            const el2 = newManagedItems[mismatch2]!.el;
            
            const next1 = el1.nextSibling;
            const next2 = el2.nextSibling;
            
            if (next1 === el2) {
              container.insertBefore(el2, el1);
            } else if (next2 === el1) {
              container.insertBefore(el1, el2);
            } else {
              container.insertBefore(el1, next2);
              container.insertBefore(el2, next1);
            }
            
            managedItems[mismatch1] = newManagedItems[mismatch1]!;
            managedItems[mismatch2] = newManagedItems[mismatch2]!;
            return;
          }
          
          // General reorder
          let currentEl: Element | null = managedItems[0]?.el || null;
          for (let i = 0; i < newLength; i++) {
            const wanted = newManagedItems[i]!.el;
            if (wanted === currentEl) {
              currentEl = currentEl?.nextElementSibling || null;
            } else {
              container.insertBefore(wanted, currentEl);
            }
          }
          
          managedItems.length = 0;
          for (let i = 0; i < newLength; i++) managedItems.push(newManagedItems[i]!);
          return;
        }
      }
      
      // Fast path: complete replacement (first and last keys both new)
      if (oldLength > 0 && oldLength === newLength) {
        const firstNewKey = keyFn(newItems[0]!, 0);
        if (!keyMap.has(firstNewKey)) {
          const lastNewKey = keyFn(newItems[newLength - 1]!, newLength - 1);
          if (!keyMap.has(lastNewKey)) {
            clearAll();
            bulkCreate(newItems);
            return;
          }
        }
      }
      
      // General keyed reconciliation
      _keySet.clear();
      for (let i = 0; i < newLength; i++) {
        _keySet.add(keyFn(newItems[i]!, i));
      }
      
      // Remove items no longer present — array rebuild instead of splice
      const kept: ManagedItem<T>[] = [];
      for (let i = 0; i < oldLength; i++) {
        const managed = managedItems[i]!;
        const key = keyFn(managed.itemSignal(), i);
        if (_keySet.has(key)) {
          kept.push(managed);
        } else {
          removeItem(managed);
          keyMap.delete(key);
        }
      }
      _keySet.clear(); // release references
      managedItems.length = 0;
      for (let i = 0; i < kept.length; i++) managedItems.push(kept[i]!);
      
      // Build new managed items array
      const newManagedItems: ManagedItem<T>[] = [];
      
      for (let i = 0; i < newLength; i++) {
        const newItem = newItems[i]!;
        const key = keyFn(newItem, i);
        const existing = keyMap.get(key);
        
        if (existing) {
          if (existing.itemSignal() !== newItem) {
            existing.itemSignal(newItem);
          }
          newManagedItems.push(existing);
        } else {
          const refNode = i < managedItems.length ? managedItems[i]!.el : anchor;
          const managed = createItemFn(newItem, i, refNode);
          if (keyMap) keyMap.set(key, managed);
          newManagedItems.push(managed);
        }
      }
      
      // Reorder to match new order
      let currentEl: Element | null = newManagedItems[0]?.el.previousElementSibling?.nextElementSibling || container.firstElementChild;
      for (let i = 0; i < newLength; i++) {
        const wanted = newManagedItems[i]!.el;
        if (wanted === currentEl) {
          currentEl = currentEl?.nextElementSibling || null;
        } else {
          container.insertBefore(wanted, currentEl);
        }
      }
      
      managedItems.length = 0;
      for (let i = 0; i < newLength; i++) managedItems.push(newManagedItems[i]!);
      return;
    }

    // ── Index-based reconciliation (no keyFn) ──
    
    // Fast path: same length, first and last both changed = replace all
    if (oldLength > 0 && newLength > 0 && oldLength === newLength) {
      const firstChanged = managedItems[0]!.itemSignal() !== newItems[0];
      const lastChanged = managedItems[oldLength - 1]!.itemSignal() !== newItems[newLength - 1];
      
      if (firstChanged && lastChanged) {
        for (let i = 0; i < newLength; i++) {
          const managed = managedItems[i]!;
          if (managed.itemSignal() !== newItems[i]) {
            managed.itemSignal(newItems[i]!);
          }
        }
        return;
      }
    }

    // Update existing items
    const minLength = Math.min(oldLength, newLength);
    for (let i = 0; i < minLength; i++) {
      const managed = managedItems[i]!;
      if (managed.itemSignal() !== newItems[i]) {
        managed.itemSignal(newItems[i]!);
      }
    }

    // Remove excess items
    if (newLength < oldLength) {
      for (let i = newLength; i < oldLength; i++) {
        removeItem(managedItems[i]!);
      }
      managedItems.length = newLength;
    }

    // Add new items
    if (newLength > oldLength) {
      const itemsToAdd = newItems.slice(oldLength);
      bulkCreate(itemsToAdd, oldLength);
    }
  };

  return {
    reconcile,
    clearAll,
    hideEmpty,
    get managedItems() { return managedItems; },
  };
}

// ─────────────────────────────────────────────────────────────
//  __bindRepeat — HTML string based
// ─────────────────────────────────────────────────────────────

export const __bindRepeat = <T>(
  root: ComponentRoot,
  arraySignal: Signal<T[]>,
  anchorId: string,
  templateFn: (itemSignal: Signal<T>, index: number) => string,
  initItemBindings: (elements: Element[], itemSignal: Signal<T>, index: number) => (() => void)[],
  emptyTemplate?: string,
  itemEventHandlers?: Record<string, Record<string, (itemSignal: Signal<T>, index: number, e: Event) => void>>,
  keyFn?: KeyFn<T>,
): (() => void) => {
  const anchor = root.getElementById(anchorId);
  if (!anchor) return () => {};

  const container = anchor.parentNode as ParentNode & Element;
  if (!container) return () => {};

  const containerParent = container.parentNode;
  const containerNextSibling = container.nextSibling;

  const createItem = (item: T, index: number, refNode: Node): ManagedItem<T> => {
    const itemSignal = createSignal(item);

    const html = templateFn(itemSignal, index);
    const tpl = getTempEl();
    tpl.innerHTML = html;
    const fragment = tpl.content.cloneNode(true) as DocumentFragment;
    const el = fragment.firstElementChild!;

    container.insertBefore(fragment, refNode);

    const cleanups = initItemBindings([el], itemSignal, index);

    if (itemEventHandlers) {
      for (const eventType in itemEventHandlers) {
        const handlers = itemEventHandlers[eventType];
        if (!handlers) continue;
        
        const attrName = `data-evt-${eventType}`;
        const nested = el.querySelectorAll(`[${attrName}]`);
        
        if (el.hasAttribute(attrName)) {
          const handlerId = el.getAttribute(attrName)?.split(':')[0];
          if (handlerId) {
            const handler = handlers[handlerId];
            if (handler) {
              const listener = (e: Event) => handler(itemSignal, index, e);
              el.addEventListener(eventType, listener);
              cleanups.push(() => el.removeEventListener(eventType, listener));
            }
          }
        }
        
        for (let i = 0, len = nested.length; i < len; i++) {
          const target = nested[i]!;
          const handlerId = target.getAttribute(attrName)?.split(':')[0];
          if (handlerId) {
            const handler = handlers[handlerId];
            if (handler) {
              const listener = (e: Event) => handler(itemSignal, index, e);
              target.addEventListener(eventType, listener);
              cleanups.push(() => target.removeEventListener(eventType, listener));
            }
          }
        }
      }
    }

    return { itemSignal, el, cleanups };
  };

  const reconciler = createReconciler({
    container, anchor, containerParent, containerNextSibling,
    createItem, keyFn, emptyTemplate,
  });

  reconciler.reconcile(arraySignal());

  const unsubscribe = arraySignal.subscribe((items) => {
    reconciler.reconcile(items);
  }, true);

  return () => {
    unsubscribe();
    reconciler.hideEmpty();
    reconciler.clearAll();
  };
};

// ─────────────────────────────────────────────────────────────
//  __bindRepeatTpl — Pre-compiled template based
// ─────────────────────────────────────────────────────────────

/**
 * Element path for navigating to a dynamic element via children indices
 */
type ElementPath = number[];

/**
 * Configuration for a dynamic element binding in a repeat template
 */
interface RepeatElementBinding {
  path: ElementPath;
  id: string;
}

/**
 * Navigate to an element using a pre-computed children path
 */
const navigatePath = (root: Element, path: ElementPath): Element | null => {
  let el: Element | null = root;
  for (let i = 0, len = path.length; i < len && el; i++) {
    el = el.children[path[i]!] as Element || null;
  }
  return el;
};

export const __bindRepeatTpl = <T>(
  root: ComponentRoot,
  arraySignal: Signal<T[]>,
  anchorId: string,
  itemTemplate: HTMLTemplateElement,
  elementBindings: RepeatElementBinding[],
  fillItem: (elements: Element[], item: T, index: number) => void,
  initItemBindings: (elements: Element[], itemSignal: Signal<T>, index: number) => (() => void)[],
  emptyTemplate?: string,
  keyFn?: KeyFn<T>,
): (() => void) => {
  const anchor = root.getElementById(anchorId);
  if (!anchor) {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      console.error(`[thane] repeat: anchor #${anchorId} not found`);
    }
    return () => {};
  }

  const container = anchor.parentNode as ParentNode & Element;
  if (!container) return () => {};
  
  const containerParent = container.parentNode;
  const containerNextSibling = container.nextSibling;

  const templateContent = itemTemplate.content;

  const createItem = (item: T, index: number, refNode: Node): ManagedItem<T> => {
    const itemSignal = createSignal(item);

    const fragment = templateContent.cloneNode(true) as DocumentFragment;
    const el = fragment.firstElementChild!;

    const elements: Element[] = new Array(elementBindings.length);
    for (let i = 0, len = elementBindings.length; i < len; i++) {
      const binding = elementBindings[i]!;
      const path = binding.path;
      elements[i] = path.length === 0 ? el : navigatePath(el, path)!;
    }

    fillItem(elements, item, index);
    container.insertBefore(fragment, refNode);
    const cleanups = initItemBindings(elements, itemSignal, index);

    return { itemSignal, el, cleanups };
  };

  const reconciler = createReconciler({
    container, anchor, containerParent, containerNextSibling,
    createItem, keyFn, emptyTemplate,
  });

  reconciler.reconcile(arraySignal());

  const unsubscribe = arraySignal.subscribe((items) => {
    reconciler.reconcile(items);
  }, true);

  return () => {
    unsubscribe();
    reconciler.hideEmpty();
    reconciler.clearAll();
  };
};

// ─────────────────────────────────────────────────────────────
//  __bindNestedRepeat — Now uses shared reconciler with keyed support
// ─────────────────────────────────────────────────────────────

export const __bindNestedRepeat = <P, T>(
  elements: Element[],
  parentSignal: Signal<P>,
  getArray: () => T[],
  anchorId: string,
  templateFn: (itemSignal: Signal<T>, index: number) => string,
  initItemBindings: (elements: Element[], itemSignal: Signal<T>, index: number) => (() => void)[],
  emptyTemplate?: string,
  keyFn?: KeyFn<T>,
): (() => void) => {
  const anchor = __findEl(elements, anchorId);
  if (!anchor) return () => {};

  const container = anchor.parentNode as ParentNode & Element;
  if (!container) return () => {};

  const createItem = (item: T, index: number, refNode: Node): ManagedItem<T> => {
    const itemSignal = createSignal(item);

    const html = templateFn(itemSignal, index);
    const tpl = getTempEl();
    tpl.innerHTML = html;
    const fragment = tpl.content.cloneNode(true) as DocumentFragment;
    const el = fragment.firstElementChild!;

    container.insertBefore(fragment, refNode);
    const cleanups = initItemBindings([el], itemSignal, index);

    return { itemSignal, el, cleanups };
  };

  // Nested repeats don't use detach optimization (parent container is managed by outer repeat)
  const reconciler = createReconciler({
    container,
    anchor,
    containerParent: null,
    containerNextSibling: null,
    createItem,
    keyFn,
    emptyTemplate,
    useDetachOptimization: false,
  });

  reconciler.reconcile(getArray());

  const unsubscribe = parentSignal.subscribe(() => {
    reconciler.reconcile(getArray());
  }, true);

  return () => {
    unsubscribe();
    reconciler.hideEmpty();
    reconciler.clearAll();
  };
};
