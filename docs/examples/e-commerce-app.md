# Example Walk-Through: E-Commerce Store

> A guided tour of `example-apps/store/thane/`: a product catalogue with a cart, which uses routing, signals, data
> fetching, localStorage persistence and the directives. The code below is the app's own.

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
example-apps/store/thane/src/
├── app.ts                          # The shell: navbar and router outlet
├── main.ts                         # Entry point: mount()
├── routes.ts                       # Route table
├── models/
│   ├── app-state.models.ts         # A product with its cart count
│   ├── endpoint.models.ts          # API response types
│   └── product.models.ts           # The product the API returns
├── state/
│   └── global-state.ts             # Signals, computed values, actions
├── utils/
│   ├── endpoints.ts                # API calls
│   └── http.ts                     # A thin fetch wrapper
├── components/
│   ├── Loader/Loader.ts            # Spinner and text
│   ├── Navbar/Navbar.ts            # Top bar with the active link marked
│   ├── ProductCard/ProductCard.ts  # One product tile
│   └── ProductGrid/ProductGrid.ts  # repeat() over the cards
└── pages/
    ├── Products/Products.ts        # Home: fetches and shows the grid
    ├── Cart/Cart.ts                # The cart's lines and total
    ├── ProductDetails/ProductDetails.ts  # One product
    └── NotFound/NotFound.ts        # Unknown paths
```

Each component has a CSS module next to it (`Navbar.module.css`), imported as its `styles`.

---

## Models

**`product.models.ts`**: the product the API returns:

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

**`app-state.models.ts`**: the product with how many of it are in the cart, so that one signal holds both:

```ts
export interface AppStateProduct extends Product {
  cartCount: number;
}
```

**`endpoint.models.ts`**: the response of the product list:

```ts
export type ProductListApiResponse = Product[];
```

---

## Route Definitions

**`routes.ts`**

```ts
import { defineRoutes } from 'thane/router';
import { ProductsPage } from './pages/Products/Products.js';
import { CartPage } from './pages/Cart/Cart.js';
import { ProductDetailsPage } from './pages/ProductDetails/ProductDetails.js';
import { NotFound } from './pages/NotFound/NotFound.js';

export default defineRoutes({
  '/': { component: ProductsPage, meta: { title: 'Products' } },
  '/my-cart': { component: CartPage, meta: { title: 'My Cart' } },
  '/product-details/:productID': { component: ProductDetailsPage, meta: { title: 'Product Details' } },
  'notFound': { component: NotFound, meta: { title: 'Not Found' } },
});
```

| Route | What it is |
|-------|------------|
| `'/'` | The home page |
| `'/my-cart'` | The cart |
| `'/product-details/:productID'` | A path parameter: the page reads `route.params.productID` |
| `'notFound'` | Every path no route matches |

The pages are imported up front here; `component: () => import('./pages/Cart/Cart.js').then((m) => m.CartPage)`
loads one when its route is first visited instead ([Code Splitting](../routing.md#code-splitting)). `meta.title`
is the document's title on that route.

---

## Application Shell

**`app.ts`**

```ts
import { defineComponent, html } from 'thane';
import styles from './App.module.css';
import { Navbar } from './components/Navbar/Navbar.js';

export const App = defineComponent(() => ({
  template: html`
    <div class="appContainer">
      ${Navbar()}
      <router-outlet class="routerOutletContainer"></router-outlet>
    </div>
  `,
  styles,
}));
```

The shell renders the navbar, which every page shares, and the `<router-outlet>`, where the router puts the page of
the current route. Its selector, `app`, is derived from its name.

---

## Entry Point

**`main.ts`**

```ts
import { mount } from 'thane';
import { App } from './app.js';
import Routes from './routes.js';

mount(App, { routes: Routes });
```

One `mount()` call renders the shell into `document.body` and starts the router, which finds the shell's
`<router-outlet>` and shows the page of the URL. A plain click on an `<a href>` to one of the routes navigates in the
app from then on.

---

## Global State

**`state/global-state.ts`** holds the app's state:

1. an array of signals, one per product;
2. values computed from it (the cart's count);
3. its persistence in localStorage, read back on load;
4. the actions that change one product's signal.

### A Signal of Signals

```ts
export const products = signal<Signal<AppStateProduct>[]>(hydratedProducts.map((p) => signal<AppStateProduct>(p)));
```

`products` is a signal whose value is an array of signals. Adding a product to the cart writes that product's
signal alone: the bindings that read it (its card's button and counter, the navbar's count) update, and the list is
not touched.

### Computed Values

```ts
export const cartCount = computed(() => products().reduce((sum, p) => sum + p().cartCount, 0));
```

`cartCount` reads every product's signal, so it computes again when any product's `cartCount` changes, and every
binding that reads `cartCount()` updates.

### Reading the Saved State

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

When the module loads, the products saved last time seed the signals, so the cart survives a reload.

### Saving

```ts
products.subscribe(saveState, true);
```

Each time the array itself changes (`setProducts` after a fetch), `saveState()` writes the products to localStorage.
`true` skips the first call, which would only write back what was read.

### Actions

```ts
export const addToCart = (productId: number) => {
  const productSignal = products().find((p) => p().id === productId);
  if (!productSignal) return;
  const current = productSignal();
  productSignal({ ...current, cartCount: current.cartCount + 1 });
  saveState();
};
```

An action finds the product's signal and writes it a new value. `removeFromCart` does the same with one less.

---

## Data Fetching

### HTTP Utility

**`utils/http.ts`**: a thin `fetch` wrapper, typed by the response:

```ts
const apiBaseURL = env?.THANE_API_BASE_URL ?? 'https://fakestoreapi.com';

const sendRequest = <TRequest, TResponse>(method: HttpMethod, endpoint: string, body?: TRequest) => {
  return new Promise<TResponse>((resolve, reject: (reason?: unknown) => void) => {
    fetch(`${apiBaseURL}${endpoint}`, { method, headers: { … }, body: body ? JSON.stringify(body) : null })
      .then((res) => { … })
      .catch((error: unknown) => reject(…));
  });
};

export const GET = <TResponse>(endpoint: string) => sendRequest<never, TResponse>('GET', endpoint);
```

`THANE_API_BASE_URL` is read at build time: variables with the `THANE_` prefix are compiled in
([CLI](../cli.md)).

### Endpoint Function

**`utils/endpoints.ts`**:

```ts
export const getAllProducts = () => {
  return GET<ProductListApiResponse>('/products');
};
```

The products page calls `getAllProducts()` from its `onMount` ([below](#products-home)).

---

## Components

### Navbar

**`components/Navbar/Navbar.ts`**

```ts
import { defineComponent, html, when } from 'thane';
import { isActive } from 'thane/router';
import styles from './Navbar.module.css';
import { cartCount } from '../../state/global-state.js';

export const Navbar = defineComponent(() => ({
  template: html`
    <nav class="navbar">
      <a class="logoLink" href="/">
        <img class="logo" src="/assets/images/storefront-mark.svg" alt="Store logo" />
      </a>
      <div class="navigationButtonsContainer">
        <a class="navigationButton" class:active=${isActive('/')} href="/">
          <span class="navigationText">Home</span>
          <img class="navigationIcon" src="/assets/icons/home.svg" alt="Home Icon" />
        </a>
        <a class="navigationButton" class:active=${isActive('/my-cart')} href="/my-cart">
          <span class="navigationText">My Cart</span>
          <img class="navigationIcon" src="/assets/icons/cart.svg" alt="My Cart Icon" />
          <span class="cartCounter" ${when(cartCount() > 0)}>${cartCount()}</span>
        </a>
      </div>
    </nav>
  `,
  styles,
}));
```

| Pattern | How it is used |
|---------|----------------|
| `<a href>` | A link to a route: the router navigates in the app on a plain click |
| `class:active=${isActive('/')}` | `isActive()` from `thane/router` follows the current path; `class:active` adds the class while it is true |
| `when()` in a tag | The cart's counter is on the page only while the cart holds something |
| An imported signal | `cartCount` comes from `global-state.ts`; the counter updates with every product's count |

### Loader

**`components/Loader/Loader.ts`**

```ts
export const Loader = defineComponent<{ text: string }>(({ props }) => ({
  template: html`
    <div class="loaderContainer">
      <div class="spinner"></div>
      <p>${props.text}</p>
    </div>
  `,
  styles,
}));
```

A component with one prop, typed where it is defined. The products page calls it: `${Loader({ text: 'Loading Products...' })}`.

### ProductGrid

**`components/ProductGrid/ProductGrid.ts`**

```ts
type ProductGridProps = {
  products: ReadonlySignal<Signal<AppStateProduct>[]>;
};

export const ProductGrid = defineComponent<ProductGridProps>(({ props }) => ({
  template: html`
    <div class="productGrid">
      ${repeat(props.products(), (product) => ProductCard({ product }), {
        key: (product) => product().id,
        empty: html`<p>No products found.</p>`,
      })}
    </div>
  `,
  styles,
}));
```

| `repeat()` argument | Value | Purpose |
|---------------------|-------|---------|
| Items | `props.products()` | The product signals to show |
| Row | `(product) => ProductCard({ product })` | A `ProductCard` for each one |
| `key` | `(product) => product().id` | Which row is which product, so a row is moved, not built again, when the list changes |
| `empty` | `` html`<p>No products found.</p>` `` | Shown while the list is empty |

`products` is passed as the signal itself (`ProductGrid({ products })`, not `products()`): the grid reads it in its
template, so its list follows the signal.

### ProductCard

**`components/ProductCard/ProductCard.ts`**

```ts
export const ProductCard = defineComponent<{ product: Signal<AppStateProduct> }>(({ props }) => {
  const product = props.product;
  return {
    template: html`
      <div class="productCard" @click=${navigate(`/product-details/${product().id}`)}>
        <img class="productImage" src=${product().image} alt=${product().title} />
        <div class="productDetails">
          <h5 title=${product().title} class="productTitle">${product().title}</h5>
          <p class="productPrice">R${product().price}</p>
        </div>
        <button class="addToCartButton" class:added=${product().cartCount > 0} @click.stop=${addToCart(product().id)}>
          ${product().cartCount > 0 ? 'Added to cart' : 'Add to Cart'}
          <img class="addToCartIcon" src="/assets/icons/add-to-cart.svg" alt="Add to cart icon" />
          <span class="cartCounter" ${when(product().cartCount > 0)}>${product().cartCount}</span>
        </button>
      </div>
    `,
    styles,
  };
});
```

- **A signal as a prop**: the card reads `product()`. When `addToCart()` writes this product's signal, the card's
  bindings update.
- **A call as a handler**: `@click=${navigate(…)}` and `@click=${addToCart(…)}` run when the element is clicked.
- **`.stop`**: the button is inside the card, which navigates on a click; `@click.stop` stops the click there, so
  adding to the cart stays on the page.
- **`class:added`**: the button has the `added` class while the product is in the cart.

---

## Pages

### Products (Home)

**`pages/Products/Products.ts`**

```ts
export const ProductsPage = defineComponent(() => ({
  template: html`
    <h1 class="productsTitle">Explore Our Products</h1>
    <p class="introText">…</p>
    ${productsLoading()
      ? Loader({ text: 'Loading Products...' })
      : productsError() !== null
        ? html`<h1 class="error">There has been an error fetching the products - ${productsError()}</h1>`
        : ProductGrid({ products })}
  `,
  styles,
  onMount: () => {
    if (products().length > 0) {
      productsLoading(false);
      return;
    }
    productsLoading(true);
    productsError(null);
    getAllProducts()
      .then((data) => setProducts(data))
      .catch((error: unknown) => productsError(error instanceof Error ? error.message : 'An unknown error occurred'))
      .finally(() => productsLoading(false));
  },
}));
```

1. `onMount` runs once the page is on screen.
2. Products already loaded (a visit back, or the saved state) are not fetched again.
3. Otherwise the page shows the loader, fetches, and stores the products or the error.
4. A ternary in the template chooses one of three: the loader, the error, or the grid. Each branch is compiled like a
   `when()` branch, and only the one that shows is on the page.

### Cart

**`pages/Cart/Cart.ts`**

```ts
export const CartPage = defineComponent(() => {
  const cartProducts = computed(() => products().filter((p) => p().cartCount > 0));
  const totalPrice = computed(() =>
    products()
      .reduce((total, p) => total + p().cartCount * p().price, 0)
      .toFixed(2),
  );

  return {
    template: html`
      <div class="cartContainer">
        ${when(
          cartCount() === 0,
          html`<p>Your cart is empty. <a href="/">Select some items first.</a></p>`,
          html`
            <ul class="cartList">
              ${repeat(
                cartProducts(),
                (product) => html`
                  <li class="cartItem">
                    <img src=${product().image} alt=${product().title} class="cartItemImage" />
                    <div>
                      <h3>${product().title}</h3>
                      <p ${when(product().cartCount > 1)}>Unit Price: R${product().price}</p>
                      <p>Price: R${(product().price * product().cartCount).toFixed(2)}</p>
                      <button class="removeButton" @click=${removeFromCart(product().id)}>
                        ${product().cartCount === 1 ? 'Remove from Cart' : 'Remove One Item'}
                      </button>
                      <span class="cartCounter" ${when(product().cartCount > 1)}>${product().cartCount}</span>
                    </div>
                  </li>
                `,
                { key: (product) => product().id },
              )}
            </ul>
            <h2>Total Price: R${totalPrice()}</h2>
            <button class="checkoutButton" @click=${console.log('Proceeding to checkout...')}>Checkout</button>
          `,
        )}
      </div>
    `,
    styles,
  };
});
```

| Pattern | Detail |
|---------|--------|
| `when()` with two branches | The empty cart, or its lines |
| `repeat()` inside `when()` | The list is in the second branch |
| `when()` inside `repeat()` | The unit price shows while a line holds more than one |
| `computed()` | `cartProducts` and `totalPrice` follow the products |
| A link in a branch | "Select some items first." is a plain link to `/`, which the router follows |

### Product Details

**`pages/ProductDetails/ProductDetails.ts`**

```ts
// The selector names the page's route, which types route.params. The product is a signal, or undefined for an id
// no product has: when() shows its branch while there is one
export const ProductDetailsPage = defineComponent('product-details-page', ({ route }) => {
  const productID = route!.params.productID;
  const productSignal = products().find((p) => p().id.toString() === productID);

  return {
    template: html`
      <div class="productDetailContainer">
        ${when(
          productSignal,
          (product) => html`
            <div class="productImageContainer">
              <img src=${product().image} alt=${product().title} class="productDetailImage" />
            </div>
            <div class="productInfo">
              <h1 class="productTitle">${product().title}</h1>
              <p class="productPrice">R${product().price}</p>
              <p class="productDescription">${product().description}</p>
              <p class="productCategory">Category: ${product().category}</p>
              <button class="addToCartButton" class:added=${product().cartCount > 0} @click=${addToCart(product().id)}>
                <span>${product().cartCount > 0 ? 'Added to Cart' : 'Add to Cart'}</span>
                <img class="addToCartIcon" src="/assets/icons/add-to-cart.svg" alt="Add to cart icon" />
                <span class="cartCounter" ${when(product().cartCount > 0)}>${product().cartCount}</span>
              </button>
            </div>
          `,
          html`<p>The product you are looking for does not exist.</p>`,
        )}
      </div>
    `,
    styles,
  };
});
```

- **`route.params.productID`**: the `:productID` segment of the URL, a string. The route's types come from the route
  table; the page's explicit selector is how they find it.
- **A signal that may be missing**: `find()` gives the product's signal, or `undefined` for an id that no product has.
  `when(productSignal, (product) => …)` shows the branch while there is a signal, and the branch reads it as
  `product()`, so adding to the cart updates it. A missing product shows the other branch
  ([when()](../directives/when.md#narrowing)).

### Not Found

**`pages/NotFound/NotFound.ts`**

```ts
export const NotFound = defineComponent(() => ({
  template: html`
    <div class="errorPage">
      <h1>Oops!</h1>
      <p>The page you requested does not exist.</p>
      <button class="returnHomeButton" @click=${navigate('/')}>Return Home</button>
    </div>
  `,
  styles,
}));
```

The `notFound` route's page, for every path no route matches. `navigate('/')` takes the visitor home.

---

## Patterns Summary

| Pattern | Where it is used |
|---------|------------------|
| `signal()` of signals | `global-state.ts`: the products |
| `computed()` | `global-state.ts`: `cartCount`; `Cart.ts`: `cartProducts`, `totalPrice` |
| `signal.subscribe()` | `global-state.ts`: `products.subscribe(saveState, true)` |
| `defineComponent()` with props | `Loader`, `ProductCard`, `ProductGrid` |
| `defineComponent()` with an explicit selector and `route` | `ProductDetails` |
| CSS modules as `styles` | Every component |
| `<a href>` router links | `Navbar`, `Cart` |
| `class:name=${…}` | `Navbar` (`active`), `ProductCard` and `ProductDetails` (`added`) |
| `isActive()` | `Navbar`: the current route's link |
| A call as a handler | `ProductCard`, `Cart`, `ProductDetails`, `NotFound` |
| `@click.stop` | `ProductCard`: adding to the cart does not open the product |
| `when()` in a tag | `Navbar`, `ProductCard`, `Cart`, `ProductDetails`: the counters and the unit price |
| `when()` with two branches | `Cart`: empty or not |
| `when(value, (v) => …)` | `ProductDetails`: a product that may not exist |
| A ternary in a template | `Products`: loader, error or grid |
| `repeat()` with `key` | `ProductGrid`, `Cart` |
| `repeat()` with `empty` | `ProductGrid` |
| `navigate()` | `ProductCard`, `NotFound` |
| `route.params` | `ProductDetails`: `:productID` |
| `onMount` | `Products`: fetching |
| `mount(App, { routes })` | `main.ts` |
| `defineRoutes()` | `routes.ts`: three routes and `notFound` |
| localStorage persistence | `global-state.ts`: `loadState`, `saveState` |
| Module-level signals | `global-state.ts`: shared by the components and pages |

---

## Next Steps

- [Getting Started](../getting-started.md): a project of your own.
- [Signals](../signals.md): the reactivity system.
- [Routing](../routing.md): lazy pages, guards, heads, search values.
- [State Management](../state-management.md): more ways to hold an app's state.
- [API Reference](../api-reference.md): every export.
