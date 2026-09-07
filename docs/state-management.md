# State Management

Thane doesn't ship a dedicated state management library. Instead, signals themselves serve as the state layer. This page covers common patterns for organizing state in Thane applications.

## Local Component State

Define signals inside `defineComponent` for state that belongs to a single component:

```typescript
export const Counter = defineComponent(() => {
  const count = signal(0);
  const increment = () => count(count() + 1);

  return {
    template: html`<button @click=${increment}>Count: ${count()}</button>`,
  };
});
```

Each instance has its own `count` signal. Multiple `Counter` instances maintain independent state.

## Shared Module-Level Signals

Define signals in a standalone `.ts` file and import them wherever needed:

```typescript
// state/global-state.ts
import { signal, computed } from 'thane';

export const count = signal(0);
export const doubled = computed(() => count() * 2);
```

```typescript
// components/display.ts
import { defineComponent } from 'thane';
import { count, doubled } from '../state/global-state.js';

export const Display = defineComponent(() => ({
  template: html`<p>${count()} × 2 = ${doubled()}</p>`,
}));
```

```typescript
// components/controls.ts
import { defineComponent } from 'thane';
import { count } from '../state/global-state.js';

export const Controls = defineComponent(() => ({
  template: html`<button @click=${() => count(count() + 1)}>Increment</button>`,
}));
```

Both components react to the same `count` signal. When `Controls` increments it, `Display` updates automatically.

## Nested Signals for Lists

For lists where individual items need fine-grained updates, use `Signal<Signal<T>[]>` — an outer signal holding an array of inner signals:

```typescript
import { signal } from 'thane';
import type { Signal } from 'thane';

interface Product {
  id: number;
  title: string;
  price: number;
  cartCount: number;
}

// Outer signal: the list itself
export const products = signal<Signal<Product>[]>([]);
```

### Why Nested Signals?

With a flat `Signal<Product[]>`, any change to any product re-renders the entire list. With nested signals, updating a single product's `cartCount` only updates that product's DOM:

```typescript
// Update one product — only its bindings re-render
const target = products().find(p => p().id === productId);
if (target) {
  target({ ...target(), cartCount: target().cartCount + 1 });
}
```

The outer signal only fires when the array itself changes (items added/removed). The inner signals fire when individual items change.

### Populating from an API

```typescript
import type { Product } from '../models/product.models.js';

export const setProducts = (payload: Product[]) => {
  const existingById = new Map(products().map(p => [p().id, p]));

  const newProducts = payload.map(item => {
    const existing = existingById.get(item.id);
    if (existing) {
      // Preserve cart state, update product data
      existing({ ...item, cartCount: existing().cartCount });
      return existing;
    }
    return signal({ ...item, cartCount: 0 });
  });

  products(newProducts);
};
```

## Computed Derived State

Use `computed()` for values derived from other signals:

```typescript
import { signal, computed } from 'thane';

export const products = signal<Signal<Product>[]>([]);

export const cartCount = computed(() =>
  products().reduce((sum, p) => sum + p().cartCount, 0),
);

export const cartTotal = computed(() =>
  products()
    .reduce((total, p) => total + p().cartCount * p().price, 0)
    .toFixed(2),
);
```

Computeds re-evaluate lazily — only when read after a dependency changes.

## localStorage Persistence

Persist state across page reloads by subscribing to signal changes:

```typescript
const STORAGE_KEY = 'appState';

// Load on startup
const loadState = (): Product[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.products) ? parsed.products : [];
  } catch {
    return [];
  }
};

// Hydrate signals from localStorage
const hydrated = loadState();
export const products = signal<Signal<Product>[]>(
  hydrated.map(p => signal(p)),
);

// Save whenever the product list changes
const saveState = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      products: products().map(p => p()),
    }));
  } catch {
    return;
  }
};

products.subscribe(saveState, true); // skip initial to avoid writing on load
```

## Cross-Route State

When using the router, module-level signals persist across route navigations because they live in a shared module — not inside a component's lifecycle:

```typescript
// state/store.ts — imported by multiple route pages
export const user = signal<User | null>(null);
```

Navigating between routes that import `user` sees the same signal instance. The state survives route transitions.

## Patterns Summary

| Pattern | When to use |
|:--------|:------------|
| Local signals inside `defineComponent` | State owned by a single component instance |
| Module-level signals in a shared file | State shared across multiple components or routes |
| Nested signals (`Signal<Signal<T>[]>`) | Lists where individual items update independently |
| `computed()` | Derived values (totals, filters, formatted strings) |
| `.subscribe()` + `localStorage` | Persist state across page reloads |

← [Back to Docs](README.md)
