# Example Walk-Through: E-Commerce Store

> A complete guided tour of the `example-apps/thane-app/` source code — a small product-catalogue-and-cart application that exercises routing, signals, data fetching, localStorage persistence, and every major directive.

[← Back to Documentation Hub](../README.md)

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Models](#models)
3. [Route Definitions](#route-definitions)
4. [Application Shell](#application-shell)
5. [Entry Point](#entry-point)
6. [Global State](#global-state)
7. [Data Fetching](#data-fetching)
8. [Components](#components)
   - [Navbar](#navbar)
   - [Loader](#loader)
   - [ProductGrid](#productgrid)
   - [ProductCard](#productcard)
9. [Pages](#pages)
   - [Products (Home)](#products-home)
   - [Cart](#cart)
   - [Product Details](#product-details)
   - [Not Found](#not-found)
10. [Patterns Summary](#patterns-summary)

---

## Project Structure

```
example-apps/thane-app/src/
├── app.ts                          # Shell component
├── main.ts                         # Entry point – mount()
├── routes.ts                       # Route table
├── models/
│   ├── app-state.models.ts         # Cart-enriched product type
│   ├── endpoint.models.ts          # API response types
│   ├── product.models.ts           # Base product interface
│   └── router.models.ts            # Error shape for NotFound page
├── state/
│   └── global-state.ts             # Signals, computed values, actions
├── utils/
│   ├── endpoints.ts                # API call functions
│   └── http.ts                     # Thin fetch wrapper
├── components/
│   ├── Loader/Loader.ts            # Spinner + text
│   ├── Navbar/Navbar.ts            # Top bar with route-aware links
│   ├── ProductCard/ProductCard.ts  # Single item tile
│   └── ProductGrid/ProductGrid.ts  # repeat() over cards
└── pages/
    ├── Products/Products.ts        # Home – fetches + displays grid
    ├── Cart/Cart.ts                # Cart items + checkout
    ├── ProductDetails/ProductDetails.ts  # Single-product view
    └── NotFound/NotFound.ts        # 404 fallback
```

---

## Models

Four small interfaces keep the rest of the app type-safe.

**`product.models.ts`** — the base shape returned by the external API:

```ts
export interface Product {
  id: ProductID;
  title: string;
  price: number;
  description: string;
  category: string;
  image: string;
  rating: { rate: number; count: number };
}

export type ProductID = number;
```

**`app-state.models.ts`** — extends `Product` with a `cartCount` field so a single signal can hold both product data and cart quantity:

```ts
export interface AppStateProduct extends Product {
  cartCount: number;
}
```

**`endpoint.models.ts`** — types the API response:

```ts
export type ProductListApiResponse = Product[];
```

**`router.models.ts`** — shape passed to the NotFound page:

```ts
export interface RouteError {
  statusText?: string;
  error?: { message?: string };
}
```

---

## Route Definitions

**`routes.ts`**

```ts
import { defineRoutes } from 'thane/router';
import ProductsPage from './pages/Products/Products.js';
import CartPage from './pages/Cart/Cart.js';
import ProductDetailsPage from './pages/ProductDetails/ProductDetails.js';
import NotFound from './pages/NotFound/NotFound.js';

const Routes = defineRoutes({
  '/':            { component: ProductsPage,        title: 'Products' },
  '/my-cart':     { component: CartPage,             title: 'My Cart' },
  '/product-details/:productID': {
    component: ProductDetailsPage,
    title: 'Product Details',
  },
  'notFound':     { component: NotFound,             title: 'Not Found' },
});

export default Routes;
```

Key points:

| Pattern | Purpose |
|---------|---------|
| `'/'` | Home page — eagerly imported |
| `'/my-cart'` | Cart — eagerly imported |
| `'/product-details/:productID'` | Dynamic segment — `route.params.productID` is available inside the component |
| `'notFound'` | Catch-all for unmatched URLs |

> All imports are static here. For [code splitting](../routing.md), replace the static import with `() => import(…)`.

---

## Application Shell

**`app.ts`**

```ts
import { defineComponent } from 'thane';
import appStyles from './App.module.css';
import { Navbar } from './components/Navbar/Navbar.js';

export const App = defineComponent('store-app', () => {
  return {
    template: html`
      <div class="appContainer">
        ${Navbar({})}
        <div class="routerOutletContainer" id="router-outlet"></div>
      </div>
    `,
    styles: appStyles,
  };
});
```

The shell has two responsibilities:

1. **Render the Navbar** — always visible, shared across all routes.
2. **Provide the router outlet** — the `<div id="router-outlet">` is where the router will mount and swap page components.

This is **Bootstrap Mode B** (Shell + Router). The shell component owns the layout while the router manages the content area. See [Routing → Bootstrap Modes](../routing.md) for the other options.

---

## Entry Point

**`main.ts`**

```ts
import { mount } from 'thane';
import { App } from './app.js';
import Routes from './routes.js';

mount({
  component: App,
  router: { routes: Routes },
});
```

A single `mount()` call:

- `component` — the shell rendered into `document.body`.
- `router.routes` — the route table. The router will find `#router-outlet` inside the shell and start matching the URL.

---

## Global State

**`state/global-state.ts`** is the most interesting file in the app. It manages:

1. A **nested signal** array of products  
2. **Computed** derived values (cart count, total price)  
3. **localStorage persistence** with hydration on load  
4. **Mutation actions** that update individual product signals

### Nested Signal Pattern

```ts
export const products = signal<Signal<AppStateProduct>[]>(
  hydratedProducts.map((p) => signal<AppStateProduct>(p)),
);
```

`products` is a `Signal` whose value is an **array of Signals**. This structure gives the framework the ability to update a single product's data (like `cartCount`) without re-rendering the entire list — only the specific `ProductCard` that reads that inner signal re-renders.

### Computed Values

```ts
export const cartCount = computed(() =>
  products().reduce((sum, p) => sum + p().cartCount, 0),
);
```

`cartCount` reads every inner product signal, so it re-evaluates whenever any product's `cartCount` changes. Any template that reads `cartCount()` will also update.

### localStorage Hydration

```ts
const loadState = (): AppStateProduct[] => {
  try {
    const localState = localStorage.getItem(STORAGE_KEY);
    if (!localState) return [];
    const parsed = JSON.parse(localState) as Partial<PersistedState>;
    return Array.isArray(parsed.products) ? parsed.products : [];
  } catch {
    return [];
  }
};
```

On module load, any previously persisted cart state is read from `localStorage` and used to seed the signal. This means the cart survives page refreshes.

### Subscribe for Auto-Save

```ts
products.subscribe(saveState, true);
```

Whenever the product array signal itself changes (e.g., after `setProducts` loads new data), `saveState()` writes the current snapshot to `localStorage`.

### Mutation Actions

```ts
export const addToCart = (productId: number) => {
  const productSignal = products().find((p) => p().id === productId);
  if (!productSignal) return;
  const current = productSignal();
  productSignal({ ...current, cartCount: current.cartCount + 1 });
  saveState();
};
```

Actions look up the individual inner signal and call it with an updated value. Because the inner signal changed, any UI bound to that specific product will re-render.

---

## Data Fetching

### HTTP Utility

**`utils/http.ts`** — a thin `fetch` wrapper typed with generics:

```ts
const sendRequest = <TRequest, TResponse>(
  method: HttpMethod,
  endpoint: string,
  body?: TRequest,
) => {
  return new Promise<TResponse>((resolve, reject) => {
    fetch(`${apiBaseURL}${endpoint}`, { method, headers: { … }, body: … })
      .then((res) => { … })
      .catch((error) => { reject(…) });
  });
};

export const GET  = <T>(endpoint: string) => sendRequest<never, T>('GET', endpoint);
export const POST = <TReq, TRes>(endpoint: string, data: TReq) => …;
export const PUT  = <TReq, TRes>(endpoint: string, data: TReq) => …;
```

### Endpoint Function

**`utils/endpoints.ts`**:

```ts
export const getAllProducts = () => {
  return GET<ProductListApiResponse>('/products');
};
```

The Products page calls `getAllProducts()` from its `onMount` hook (see [Products page](#products-home) below).

---

## Components

### Navbar

**`components/Navbar/Navbar.ts`**

The Navbar demonstrates several patterns at once:

```ts
export const Navbar = defineComponent('store-navbar', () => {
  return {
    template: html`
      <nav class="navbar">
        <a class="logoLink" @click=${navigate('/')}>
          <img class="logo" src=${logoPath} alt="DVT Logo" />
        </a>
        <div class="navigationButtonsContainer">
          <a
            class=${currentPath() === '/' ? 'navigationButton active' : 'navigationButton'}
            @click=${navigate('/')}
          >
            <span class="navigationText">Home</span>
            <img class="navigationIcon" src=${homeIconPath} alt="Home Icon" />
          </a>
          <a
            class=${currentPath() === '/my-cart' ? 'navigationButton active' : 'navigationButton'}
            @click=${navigate('/my-cart')}
          >
            <span class="navigationText">My Cart</span>
            <img class="navigationIcon" src=${cartIconPath} alt="My Cart Icon" />
            <span class="cartCounter" ${when(cartCount() > 0)}>${cartCount()}</span>
          </a>
        </div>
      </nav>
    `,
    styles,
  };
});
```

| Pattern | How It's Used |
|---------|---------------|
| **`navigate()`** — compiler-injected global | `@click=${navigate('/')}` performs client-side navigation |
| **`currentPath()`** — compiler-injected global | Reactive ternary: `currentPath() === '/' ? 'active' : ''` adds an `active` class to the current route's link |
| **`when()`** | `${when(cartCount() > 0)}` conditionally shows the cart badge only when the cart is non-empty |
| **Imported signal** | `cartCount` is imported from `global-state.ts`; whenever any product's `cartCount` changes, the badge number updates |

### Loader

**`components/Loader/Loader.ts`**

A minimal component that accepts a single `text` prop:

```ts
type LoaderProps = {
  text: string;
};

export const Loader = defineComponent<LoaderProps>('ui-loader', ({ props }) => {
  return {
    template: html`
      <div class="loaderContainer">
        <div class="spinner"></div>
        <p>${props.text}</p>
      </div>
    `,
    styles,
  };
});
```

Called from the Products page: `${Loader({ text: 'Loading Products...' })}`.

### ProductGrid

**`components/ProductGrid/ProductGrid.ts`**

Demonstrates the `repeat()` directive with keyed reconciliation and an empty-state fallback:

```ts
type ProductGridProps = {
  products: () => Signal<AppStateProduct>[];
};

export const ProductGrid = defineComponent<ProductGridProps>('product-grid', ({ props }) => {
  return {
    template: html`
      <div class="productGrid">
        ${repeat(
          props.products(),            // signal array to iterate
          (product) => ProductCard({ product }),  // render each item
          html`<p>No products found.</p>`,        // empty-state fallback
          (product) => product().id,              // key function
        )}
      </div>
    `,
    styles,
  };
});
```

| `repeat()` parameter | Value | Purpose |
|----------------------|-------|---------|
| Items | `props.products()` | The array of `Signal<AppStateProduct>` to render |
| Template | `(product) => ProductCard({ product })` | Renders a `ProductCard` child for each item |
| Empty template | `html\`<p>No products found.</p>\`` | Shown when the array is empty |
| Key function | `(product) => product().id` | Enables efficient DOM diffing when the array changes |

Note: `products` is passed **as a function** (`() => Signal<AppStateProduct>[]`), not as a raw array. This lets `repeat()` subscribe to array changes reactively.

### ProductCard

**`components/ProductCard/ProductCard.ts`**

Each card receives a single inner product signal:

```ts
type ProductCardProps = {
  product: Signal<AppStateProduct>;
};

export const ProductCard = defineComponent<ProductCardProps>('product-card', ({ props }) => {
  const product = props.product;

  const addCurrentToCart = (event: Event) => {
    event.stopPropagation();   // prevent click from reaching the card's navigate()
    addToCart(product().id);
  };

  return {
    template: html`
      <div class="productCard" @click=${navigate(`/product-details/${product().id}`)}>
        <img class="productImage" src=${product().image} alt=${product().title} />
        <div class="productDetails">
          <h5 title=${product().title} class="productTitle">${product().title}</h5>
          <p class="productPrice">R${product().price}</p>
        </div>
        <button
          class=${product().cartCount > 0 ? 'addToCartButton added' : 'addToCartButton'}
          @click=${addCurrentToCart}
        >
          ${product().cartCount > 0 ? 'Added to cart' : 'Add to Cart'}
          <img class="addToCartIcon" src=${addToCartIconPath} alt="Add to cart icon" />
          <span class="cartCounter" ${when(product().cartCount > 0)}>${product().cartCount}</span>
        </button>
      </div>
    `,
    styles,
  };
});
```

Things to notice:

- **Signal props** — the component reads `product()` to access data. When `addToCart()` updates the inner signal in `global-state.ts`, this card re-renders automatically.
- **`event.stopPropagation()`** — the "Add to Cart" button is nested inside the card that navigates on click. `stopPropagation()` prevents the card's `navigate()` from firing.
- **Reactive class** — the button class toggles between `'addToCartButton'` and `'addToCartButton added'` based on `product().cartCount > 0`.
- **`when()`** — the cart counter badge is only visible when items are in the cart.

---

## Pages

### Products (Home)

**`pages/Products/Products.ts`**

The landing page that fetches product data on mount:

```ts
export const ProductsPage = defineComponent('products-page', () => {
  return {
    template: html`
      <h1 class="productsTitle">Explore Our Products</h1>
      <p class="introText">…</p>
      <div ${when(productsLoading())}> ${Loader({ text: 'Loading Products...' })} </div>
      <div ${when(!productsLoading() && productsError() !== null)}>
        <h1 class="error">…error message…</h1>
      </div>
      <div ${when(!productsLoading() && productsError() === null)}> ${ProductGrid({ products })} </div>
    `,
    styles,
    onMount: () => {
      if (products().length > 0) {
        productsLoading(false);
        return;   // use cached data – don't fetch again
      }

      productsLoading(true);
      productsError(null);

      getAllProducts()
        .then((data) => {
          setProducts(data);
          productsLoading(false);
        })
        .catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          productsError(errorMessage);
          productsLoading(false);
        });
    },
  };
});
```

**Data-fetching pattern:**

1. `onMount` fires after the component is rendered.
2. If products are already cached (page revisit), skip the fetch.
3. Otherwise set `productsLoading(true)`, call the API, then update signals.
4. Three `when()` directives create mutual-exclusion zones—only one of loading / error / grid is visible at a time.

### Cart

**`pages/Cart/Cart.ts`**

Uses `whenElse()` to show either the empty-cart message or the cart contents:

```ts
export const CartPage = defineComponent('cart-page', () => {
  const cartProducts = computed(() => products().filter((p) => p().cartCount > 0));
  const totalPrice = computed(() =>
    products()
      .reduce((total, p) => total + p().cartCount * p().price, 0)
      .toFixed(2),
  );

  return {
    template: html`
      <div class="cartContainer">
        ${whenElse(
          cartCount() === 0,
          html`<p>Your cart is empty. <a href="/" @click=${goHome}>Select some items first.</a></p>`,
          html`
            <ul class="cartList">
              ${repeat(
                cartProducts(),
                (productSignal) => html`
                  <li class="cartItem">
                    <img src=${productSignal().image} alt=${productSignal().title} class="cartItemImage" />
                    <div>
                      <h3>${productSignal().title}</h3>
                      <p ${when(productSignal().cartCount > 1)}>Unit Price: R${productSignal().price}</p>
                      <p>Price: R${(productSignal().price * productSignal().cartCount).toFixed(2)}</p>
                      <button class="removeButton" @click=${() => removeItem(productSignal().id)}>
                        ${productSignal().cartCount === 1 ? 'Remove from Cart' : 'Remove One Item'}
                      </button>
                      <span class="cartCounter" ${when(productSignal().cartCount > 1)}>
                        ${productSignal().cartCount}
                      </span>
                    </div>
                  </li>
                `,
                null,
                (productSignal) => productSignal().id,
              )}
            </ul>
            <h2>Total Price: R${totalPrice()}</h2>
            <button class="checkoutButton" @click=${checkout}>Checkout</button>
          `,
        )}
      </div>
    `,
    styles,
  };
});
```

Patterns demonstrated:

| Pattern | Detail |
|---------|--------|
| **`whenElse()`** | Two-branch conditional — empty cart vs. full cart |
| **`repeat()` inside `whenElse()`** | Nested directive: `repeat()` runs inside the "else" branch |
| **`when()` inside `repeat()`** | "Unit Price" row only shows when `cartCount > 1` |
| **`computed()`** | `cartProducts` and `totalPrice` are computed from the products signal |
| **Ternary in template** | Button text toggles: `'Remove from Cart'` / `'Remove One Item'` |

### Product Details

**`pages/ProductDetails/ProductDetails.ts`**

Demonstrates **route parameters** via `({ route })`:

```ts
export const ProductDetailsPage = defineComponent('product-details-page', ({ route }) => {
  const productID = route.params.productID;
  const productSignal = products().find((p) => p().id.toString() === productID) ?? null;

  const addCurrentToCart = () => {
    if (!productSignal) return;
    addToCart(productSignal().id);
  };

  return {
    template: html`
      <div class="productDetailContainer">
        <div class="productImageContainer">
          <img src=${productSignal?.().image ?? ''} alt=${productSignal?.().title ?? ''} />
        </div>
        <div class="productInfo">
          <h1>${productSignal?.().title ?? ''}</h1>
          <p class="productPrice">R${productSignal?.().price ?? 0}</p>
          <p class="productDescription">${productSignal?.().description ?? ''}</p>
          <p>Category: ${productSignal?.().category ?? ''}</p>
          <button
            class=${(productSignal?.().cartCount ?? 0) > 0 ? 'addToCartButton added' : 'addToCartButton'}
            @click=${addCurrentToCart}
          >
            <span>${(productSignal?.().cartCount ?? 0) > 0 ? 'Added to Cart' : 'Add to Cart'}</span>
            <img class="addToCartIcon" src=${addToCartIconPath} alt="Add to cart icon" />
            <span class="cartCounter" ${when((productSignal?.().cartCount ?? 0) > 0)}>
              ${productSignal?.().cartCount ?? 0}
            </span>
          </button>
          <p ${when(productSignal === null)}>The product you are looking for does not exist.</p>
        </div>
      </div>
    `,
    styles,
  };
});
```

Key pattern:

- **`route.params.productID`** — the `:productID` segment from the route definition is accessible as a string.
- The component looks up the matching inner signal from the global `products()` array. Because it reads the signal, the page updates reactively if `addToCart` is called on this product.
- **Null-safe access** — `productSignal?.()` with `?? ''` fallbacks mean the template still renders without errors if the product is not found. A `when(productSignal === null)` block shows a "not found" message.

### Not Found

**`pages/NotFound/NotFound.ts`**

A catch-all 404 page:

```ts
type NotFoundProps = {
  propsError?: RouteError;
};

export const NotFound = defineComponent<NotFoundProps>('not-found-page', ({ props }) => {
  const returnHome = () => {
    navigate('/');
  };

  const errorToRender = props.propsError ?? {
    statusText: 'Oops!',
    error: { message: 'The page you requested does not exist.' },
  };

  return {
    template: html`
      <div class="errorPage">
        <h1>Oops!</h1>
        <p>${errorToRender.statusText ?? 'Not Found'}</p>
        <p>${errorToRender.error?.message ?? 'The page you requested does not exist.'}</p>
        <button class="returnHomeButton" @click=${returnHome}>Return Home</button>
      </div>
    `,
    styles,
  };
});
```

- Accepts an optional `propsError` prop. When the router triggers the `notFound` route it doesn't pass a prop, so the component falls back to a default error message.
- `navigate('/')` returns the user to the home page.

---

## Patterns Summary

A quick reference of every Thane pattern exercised in this example app:

| Pattern | Where It's Used |
|---------|----------------|
| `signal()` / `signal<Signal<T>[]>` (nested) | `global-state.ts` — product array |
| `computed()` | `global-state.ts` — `cartCount`, `totalPrice`; `Cart.ts` — `cartProducts` |
| `effect()` / `subscribe()` | `global-state.ts` — `products.subscribe(saveState, true)` |
| `defineComponent()` with props | `Loader`, `ProductCard`, `ProductGrid`, `NotFound` |
| `defineComponent()` with route | `ProductDetails` |
| `html\`\`` template | Every component |
| `css\`\`` / CSS module import | Every component (via `import styles from '*.module.css'`) |
| `@click` event binding | `Navbar`, `ProductCard`, `Cart`, `NotFound` |
| `event.stopPropagation()` | `ProductCard` — prevents card navigate when clicking "Add to Cart" |
| `when()` | `Navbar` (cart badge), `Products` (loading/error/success), `ProductCard` (badge), `Cart` (unit price, badge), `ProductDetails` (badge, not-found) |
| `whenElse()` | `Cart` — empty vs. full cart |
| `repeat()` with key function | `ProductGrid`, `Cart` |
| `repeat()` with empty fallback | `ProductGrid` — `html\`<p>No products found.</p>\`` |
| `navigate()` | `Navbar`, `ProductCard`, `ProductDetails`, `NotFound` |
| `currentPath()` | `Navbar` — active link styling |
| `route.params` | `ProductDetails` — `:productID` |
| `onMount` lifecycle | `Products` — data fetching |
| `mount()` with shell + router | `main.ts` — Bootstrap Mode B |
| `defineRoutes()` | `routes.ts` — 4 routes including `notFound` |
| localStorage persistence | `global-state.ts` — `loadState` / `saveState` |
| Module-level shared signals | `global-state.ts` — imported across components and pages |

---

## Next Steps

- [Getting Started](../getting-started.md) — Create your own project from scratch.
- [Signals](../signals.md) — Deep dive into the reactivity system.
- [Routing](../routing.md) — Explore code-splitting and all three bootstrap modes.
- [State Management](../state-management.md) — More patterns for managing application state.
- [API Reference](../api-reference.md) — Complete export and type reference.
