import { describe, expect, test } from 'bun:test';
import { __bindIfExpr } from './internal.js';
import { signal } from './signal.js';

class FakeElement {
  tagName: string;
  id = '';
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx >= 0) this.parentNode.children.splice(idx, 1);
    this.parentNode = null;
  }

  replaceWith(next: FakeElement): void {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx >= 0) {
      next.parentNode = this.parentNode;
      this.parentNode.children[idx] = next;
      this.parentNode = null;
    }
  }

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith('#')) return null;
    const wantedId = selector.slice(1);
    return this.findById(wantedId);
  }

  protected findById(wantedId: string): FakeElement | null {
    if (this.id === wantedId) return this;
    for (const child of this.children) {
      const found = child.findById(wantedId);
      if (found) return found;
    }
    return null;
  }

  cloneDeep(): FakeElement {
    const clone = new FakeElement(this.tagName);
    clone.id = this.id;
    for (const child of this.children) {
      clone.appendChild(child.cloneDeep());
    }
    return clone;
  }
}

class FakeDocumentFragment {
  firstElementChild: FakeElement | null;

  constructor(firstElementChild: FakeElement | null) {
    this.firstElementChild = firstElementChild;
  }

  cloneNode(): FakeDocumentFragment {
    return new FakeDocumentFragment(this.firstElementChild ? this.firstElementChild.cloneDeep() : null);
  }
}

class FakeTemplateElement extends FakeElement {
  private _innerHTML = '';
  content = new FakeDocumentFragment(null);

  constructor() {
    super('template');
  }

  set innerHTML(value: string) {
    this._innerHTML = value;
    this.content = new FakeDocumentFragment(parseSingleRootElement(value));
  }

  get innerHTML(): string {
    return this._innerHTML;
  }
}

const parseSingleRootElement = (html: string): FakeElement => {
  const trimmed = html.trim();
  const match = /^<([a-zA-Z0-9-]+)([^>]*)>/.exec(trimmed);
  const tag = match?.[1] ?? 'div';
  const attrs = match?.[2] ?? '';

  const el = new FakeElement(tag);
  const idMatch = /\sid\s*=\s*["']([^"']+)["']/.exec(attrs);
  if (idMatch?.[1]) {
    el.id = idMatch[1];
  }
  return el;
};

describe('dom-binding remount semantics', () => {
  test('whenElse remount re-initializes nested bindings and does not reuse stale branch DOM', () => {
    const originalDocument = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: (tagName: string) => {
        if (tagName.toLowerCase() === 'template') return new FakeTemplateElement();
        return new FakeElement(tagName);
      },
    };

    try {
      const root = new FakeElement('div');
      const anchor = new FakeTemplateElement();
      anchor.id = 'cond-1';
      root.appendChild(anchor);

      const show = signal(false);
      let initNestedCount = 0;
      let cleanupCount = 0;

      const dispose = __bindIfExpr(
        root as any,
        [show],
        () => show(),
        'cond-1',
        '<div id="cond-1"></div>',
        () => {
          initNestedCount++;
          return [() => cleanupCount++];
        },
      );

      expect(initNestedCount).toBe(0);
      expect(cleanupCount).toBe(0);
      expect(root.querySelector('#cond-1')?.tagName).toBe('TEMPLATE');

      show(true);
      const firstShownNode = root.querySelector('#cond-1');
      expect(firstShownNode).toBeTruthy();
      expect(firstShownNode?.tagName).toBe('DIV');
      expect(initNestedCount).toBe(1);
      expect(cleanupCount).toBe(0);

      show(false);
      expect(root.querySelector('#cond-1')?.tagName).toBe('TEMPLATE');
      expect(initNestedCount).toBe(1);
      expect(cleanupCount).toBe(1);

      show(true);
      const secondShownNode = root.querySelector('#cond-1');
      expect(secondShownNode).toBeTruthy();
      expect(secondShownNode?.tagName).toBe('DIV');
      expect(secondShownNode).not.toBe(firstShownNode);
      expect(initNestedCount).toBe(2);
      expect(cleanupCount).toBe(1);

      show(false);
      expect(cleanupCount).toBe(2);
      dispose();
      expect(cleanupCount).toBe(2);
    } finally {
      (globalThis as any).document = originalDocument;
    }
  });
});
