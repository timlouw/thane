import { describe, test, expect } from 'bun:test';
import { mountComponent } from './component.js';
import type { ComponentHTMLSelector } from './component.js';

// ─────────────────────────────────────────────────────────────
//  Minimal fake HTMLElement for className / classList
// ─────────────────────────────────────────────────────────────

class FakeClassList {
  private _el: FakeHTMLElement;
  constructor(el: FakeHTMLElement) {
    this._el = el;
  }
  add(cls: string): void {
    const classes = this._el.className ? this._el.className.split(/\s+/) : [];
    if (!classes.includes(cls)) classes.push(cls);
    this._el.className = classes.join(' ');
  }
  contains(cls: string): boolean {
    return this._el.className.split(/\s+/).includes(cls);
  }
}

class FakeHTMLElement {
  className = '';
  innerHTML = '';
  classList: FakeClassList;
  constructor(className = '') {
    this.className = className;
    this.classList = new FakeClassList(this);
  }
  appendChild(): void {
    /* no-op */
  }
}

// ─────────────────────────────────────────────────────────────
//  Helper to create a fake component ref with a given selector
// ─────────────────────────────────────────────────────────────

function fakeComponent(selector: string): ComponentHTMLSelector<{}> {
  return {
    __f: (target: HTMLElement) => {
      target.classList.add(selector);
      return { root: target as any };
    },
  } as unknown as ComponentHTMLSelector<{}>;
}

// ─────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────

describe('mountComponent — className cleanup on destroy', () => {
  test('destroy removes component selector class from target', () => {
    const target = new FakeHTMLElement() as unknown as HTMLElement;
    const handle = mountComponent(fakeComponent('page-a'), target);

    expect((target as any).className).toBe('page-a');
    handle.destroy();
    expect((target as any).className).toBe('');
  });

  test('destroy preserves pre-existing classes on the target', () => {
    const target = new FakeHTMLElement('router-outlet') as unknown as HTMLElement;
    const handle = mountComponent(fakeComponent('page-a'), target);

    expect((target as any).className).toBe('router-outlet page-a');
    handle.destroy();
    expect((target as any).className).toBe('router-outlet');
  });

  test('sequential mounts on the same element do not leak classes across navigations', () => {
    const target = new FakeHTMLElement('outlet') as unknown as HTMLElement;

    // Navigate to page A
    const handleA = mountComponent(fakeComponent('product-details-page'), target);
    expect((target as any).className).toBe('outlet product-details-page');

    // Navigate away — destroy page A, mount page B
    handleA.destroy();
    expect((target as any).className).toBe('outlet');

    const handleB = mountComponent(fakeComponent('products-page'), target);
    expect((target as any).className).toBe('outlet products-page');
    // Crucially, no leftover 'product-details-page' class
    expect((target as any).className).not.toContain('product-details-page');

    handleB.destroy();
    expect((target as any).className).toBe('outlet');
  });

  test('multiple navigations back and forth never accumulate classes', () => {
    const target = new FakeHTMLElement('outlet') as unknown as HTMLElement;

    for (let i = 0; i < 5; i++) {
      const h1 = mountComponent(fakeComponent('details-page'), target);
      expect((target as any).className).toBe('outlet details-page');
      h1.destroy();

      const h2 = mountComponent(fakeComponent('grid-page'), target);
      expect((target as any).className).toBe('outlet grid-page');
      h2.destroy();
    }

    expect((target as any).className).toBe('outlet');
  });

  test('destroy clears innerHTML', () => {
    const target = new FakeHTMLElement() as unknown as HTMLElement;
    const handle = mountComponent(fakeComponent('page-x'), target);
    (target as any).innerHTML = '<div>content</div>';

    handle.destroy();
    expect((target as any).innerHTML).toBe('');
  });
});
