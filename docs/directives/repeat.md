# repeat — List Rendering

`repeat()` renders a list of items using a keyed reconciler. It tracks item identity via a key function and performs minimal DOM operations — adding, removing, reordering, and updating nodes directly without a virtual DOM diff.

## Syntax

```typescript
${repeat(items, renderFn, emptyTemplate?, trackBy?)}
```

| Parameter | Type | Description |
|:----------|:-----|:------------|
| `items` | `T[]` | The array to render (typically a signal read: `items()`) |
| `renderFn` | `(item: T, index: number) => html` | Template function called for each item |
| `emptyTemplate` | `html \| null` | *(Optional)* Template shown when the array is empty |
| `trackBy` | `(item: T, index: number) => string \| number` | *(Optional)* Key function for stable identity |

The key function is always the **fourth** argument. To give a list a key without an empty template, pass `null` third: `repeat(items(), renderFn, null, (item) => item.id)`. A function in the third place is a build error (THANE010), because it would be taken for the empty template.

The template returned by `renderFn` has exactly one root element; every row is cloned from a static copy of it and updated in place. A row with two root elements, or none, is reported at build time as THANE007, and so is a row that is only a directive. The row's root element cannot carry `when()` (THANE008): filter the array instead. The `index` argument is the row's current position: bindings that read it are refreshed when rows move or are removed.

## Basic Usage

```typescript
import { defineComponent, signal, html, repeat } from 'thane';

export const TodoList = defineComponent(() => {
  const items = signal(['Buy milk', 'Walk dog', 'Write code']);

  return {
    template: html`
      <ul>
        ${repeat(
          items(),
          (item) => html`<li>${item}</li>`,
        )}
      </ul>
    `,
  };
});
```

## Keyed Reconciliation

The `trackBy` function tells the reconciler how to identify items. This enables DOM node reuse across updates:

```typescript
${repeat(
  products(),
  (product) => html`<div class="card">${product().title}</div>`,
  null,
  (product) => product().id,
)}
```

When the array changes:

- **Same key, same position:** No DOM change.
- **Same key, different position:** DOM node is moved (not re-created).
- **New key:** New DOM node is created and inserted.
- **Missing key:** DOM node is removed and its bindings are disposed.

Without `trackBy`, rows are keyed by their index: the row at each position is reused and updated with the item now at that position, and rows are only added or removed at the end.

## Empty State

Provide a template to show when the list is empty:

```typescript
${repeat(
  items(),
  (item) => html`<li>${item().name}</li>`,
  html`<li class="empty">No items found.</li>`,
  (item) => item().id,
)}
```

When the array transitions from empty to non-empty, the empty template is removed and list items are created. When the array becomes empty again, all items are removed and the empty template is shown.

The empty template is static markup with one root element, like a row. It holds no bindings or event handlers; a `${…}` in it, more than one root, or text outside an element is a build error (THANE011).

## Signal Items

When items in the array are signals themselves (the `Signal<Signal<T>[]>` pattern), the render function receives each inner signal. Updates to an individual item's signal update only that item's DOM — without re-rendering the entire list:

```typescript
import type { Signal } from 'thane';

type Product = { id: number; title: string; price: number };

// products is Signal<Signal<Product>[]>
const products = signal<Signal<Product>[]>([
  signal({ id: 1, title: 'Shirt', price: 25 }),
  signal({ id: 2, title: 'Hat', price: 15 }),
]);

template: html`
  ${repeat(
    products(),
    (product) => html`
      <div>
        <h3>${product().title}</h3>
        <p>$${product().price}</p>
      </div>
    `,
    html`<p>No products.</p>`,
    (product) => product().id,
  )}
`
```

To update a single product:

```typescript
const target = products().find(p => p().id === 1);
target({ ...target(), price: 30 }); // only this item's DOM updates
```

## Child Components in Repeat

Embed components inside repeat items:

```typescript
import { ProductCard } from './product-card.js';

template: html`
  <div class="productGrid">
    ${repeat(
      products(),
      (product) => ProductCard({ product }),
      html`<p>No products found.</p>`,
      (product) => product().id,
    )}
  </div>
`
```

## Nested Directives

A row can hold anything a component template can: bindings, event handlers, child components, `when()`, `whenElse()` and further lists, nested to any depth. Use `when()` or `whenElse()` inside repeat items:

```typescript
${repeat(
  products(),
  (product) => html`
    <div class="card">
      <h3>${product().title}</h3>
      <span class="badge" ${when(product().cartCount > 0)}>${product().cartCount}</span>
    </div>
  `,
  null,
  (product) => product().id,
)}
```

A list inside a row reads the outer row's item like any other variable:

```typescript
${repeat(
  categories(),
  (category) => html`
    <section>
      <h2>${category.name}</h2>
      <ul>
        ${repeat(
          category.products,
          (product) => html`<li @click=${() => open(category.id, product.id)}>${product.title}</li>`,
          html`<li>No products yet.</li>`,
          (product) => product.id,
        )}
      </ul>
    </section>
  `,
  null,
  (category) => category.id,
)}
```

## Fast-Path Optimizations

The reconciler includes several fast paths for common operations:

| Scenario | Optimization |
|:---------|:-------------|
| Array cleared (0 new items) | Batch teardown: all cleanups run, then the container is emptied in one operation when it holds nothing but the list; otherwise the rows are removed one by one and the container's other content stays |
| Array populated from empty | Bulk create: container is temporarily detached for batch insertion; rows without per-row cleanups are cloned in batches |
| Items appended | Only the new rows are created |
| Single item removed | Detected by key scan — only the removed item's DOM node is torn down |
| Same keys, different order | Two-element swap or general reorder — DOM nodes are moved, not recreated |
| All keys replaced | Full clear + bulk create — avoids per-item diff overhead |

## Full Example — Product Grid

From the [e-commerce app](../examples/e-commerce-app.md):

```typescript
import { defineComponent, html, repeat } from 'thane';
import type { Signal } from 'thane';
import type { AppStateProduct } from '../../models/app-state.models.js';
import { ProductCard } from '../ProductCard/ProductCard.js';

type ProductGridProps = {
  products: () => Signal<AppStateProduct>[];
};

export const ProductGrid = defineComponent<ProductGridProps>('product-grid', ({ props }) => {
  return {
    template: html`
      <div class="productGrid">
        ${repeat(
          props.products(),
          (product) => ProductCard({ product }),
          html`<p>No products found.</p>`,
          (product) => product().id,
        )}
      </div>
    `,
  };
});
```

← [Back to Directives](README.md) · [Back to Docs](../README.md)
