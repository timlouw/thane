# repeat — List Rendering

`repeat()` renders a list of items using a keyed reconciler. It tracks each row's item by its key and performs minimal DOM operations — adding, removing, reordering, and updating nodes directly without a virtual DOM diff.

## Syntax

```typescript
${repeat(items, row, { key, empty })}
```

| Parameter | Type | Description |
|:----------|:-----|:------------|
| `items` | `readonly T[]` | The array to render (typically a signal read: `items()`) |
| `row` | `(item: T, index: number) => html` | The template of each row, or a child component call |
| `key` | `keyof T \| (item: T, index: number) => string \| number` | *(Optional)* What identifies a row's item: the name of one of its properties (`'id'`), or a function of the item |
| `empty` | `html` | *(Optional)* Shown while the array is empty |

The options are written in the call, as an object literal: the compiler reads them there. Anything else as the
third argument, an option `repeat()` does not have, or a fourth argument is a build error (THANE010). The key's
type allows only the item's properties whose values are strings or numbers.

The template the row function returns has exactly one root element; every row is cloned from a static copy of it and updated in place. A row with two root elements, or none, is reported at build time as THANE007, and so is a row that is only a directive. The row's root element cannot carry `when()` (THANE008): filter the array instead. The `index` argument is the row's current position: bindings that read it are refreshed when rows move or are removed. Event handlers, and bindings that also read another signal, read the row's item and index as they are when they run, after the row has been given a new item or moved.

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

The key tells the reconciler how to identify items, so that a row is reused across updates. Name the property
that holds it, or, when the item does not hold it directly, give a function of the item:

```typescript
${repeat(users(), (user) => html`<li>${user.name}</li>`, { key: 'id' })}
${repeat(products(), (product) => html`<div class="card">${product().title}</div>`, { key: (product) => product().id })}
```

When the array changes:

- **Same key, same position:** No DOM change.
- **Same key, different position:** DOM node is moved (not re-created).
- **New key:** New DOM node is created and inserted.
- **Missing key:** DOM node is removed and its bindings are disposed.

Without a key, rows are keyed by their index: the row at each position is reused and updated with the item now at that position, and rows are only added or removed at the end.

## Empty State

Provide a template to show when the list is empty:

```typescript
${repeat(items(), (item) => html`<li>${item.name}</li>`, { key: 'id', empty: html`<li class="empty">No items found.</li>` })}
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
    { key: (product) => product().id, empty: html`<p>No products.</p>` },
  )}
`
```

To update a single product:

```typescript
const target = products().find(p => p().id === 1);
target({ ...target(), price: 30 }); // only this item's DOM updates
```

## Child Components in Repeat

A row can be a child component call, or hold one:

```typescript
import { ProductCard } from './product-card.js';

template: html`
  <div class="productGrid">
    ${repeat(
      products(),
      (product) => ProductCard({ product }),
      { key: (product) => product().id, empty: html`<p>No products found.</p>` },
    )}
  </div>
`
```

A component reads its props when it mounts. When a row's item changes (a new object under the same key, the
item at a position without a key, or a row that moves, for props that read the index), the props of a child
that reads the row are worked out again, and when one of them is not the value the child has (`Object.is`), the
child is mounted again with them: the old instance is destroyed (its `onDestroy` runs) and a new one mounts.
Props that come out the same keep the instance, so an immutable update that copies every item re-mounts only
the children whose props changed. This holds wherever the child is in the row: in a `when()` branch of it, or
in a list inside it whose props read the outer row. To keep one instance and update it in place, pass it the
item's signal (the `Signal<Signal<T>[]>` pattern above) and change that signal instead.

A `.map()` in content is compiled as `repeat()` without a key: `${products().map((product) => ProductCard({ product }))}`
(see [JavaScript Control Flow](../templates.md#javascript-control-flow)).

## Nested Directives

A row can hold anything a component template can: bindings, event handlers, child components, `when()` and further lists, nested to any depth:

```typescript
${repeat(
  products(),
  (product) => html`
    <div class="card">
      <h3>${product().title}</h3>
      <span class="badge" ${when(product().cartCount > 0)}>${product().cartCount}</span>
    </div>
  `,
  { key: (product) => product().id },
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
          { key: 'id', empty: html`<li>No products yet.</li>` },
        )}
      </ul>
    </section>
  `,
  { key: 'id' },
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
          { key: (product) => product().id, empty: html`<p>No products found.</p>` },
        )}
      </div>
    `,
  };
});
```

← [Back to Directives](README.md) · [Back to Docs](../README.md)
