import { defineComponent, signal, mount } from 'thane';

type CartItem = {
  id: number;
  title: string;
  price: number;
  cartCount: number;
};

const initialProducts = (): CartItem[] => [
  { id: 1, title: 'Cart A', price: 10, cartCount: 1 },
  { id: 2, title: 'Cart B', price: 20, cartCount: 2 },
];

const initialCount = () => initialProducts().reduce((sum, product) => sum + product.cartCount, 0);

const CartApp = defineComponent('cart-e2e-app', () => {
  const products = signal<CartItem[]>(initialProducts());
  const cartCount = signal<number>(initialCount());

  const cartRows = () => products().filter((product) => product.cartCount > 0);

  const addSecond = () => {
    products(
      products().map((product) => {
        if (product.id === 2) {
          return { ...product, cartCount: product.cartCount + 1 };
        }
        return product;
      }),
    );
    cartCount(cartCount() + 1);
  };

  const removeOne = (productId: number) => {
    let removed = false;
    products(
      products().map((product) => {
        if (product.id === productId && product.cartCount > 0) {
          removed = true;
          return { ...product, cartCount: product.cartCount - 1 };
        }
        return product;
      }),
    );

    if (removed) {
      cartCount(Math.max(0, cartCount() - 1));
    }
  };

  const clearCart = () => {
    products(products().map((product) => ({ ...product, cartCount: 0 })));
    cartCount(0);
  };

  const resetCart = () => {
    products(initialProducts());
    cartCount(initialCount());
  };

  return {
    template: html`
      <main>
        <h1 data-testid="cart-app-title">Cart E2E App</h1>
        <button data-testid="cart-add-second" @click=${addSecond}>add-second</button>
        <button data-testid="cart-clear" @click=${clearCart}>clear-cart</button>
        <button data-testid="cart-reset" @click=${resetCart}>reset-cart</button>

        ${whenElse(
          cartCount() === 0,
          html`<p data-testid="cart-empty">Your cart is empty.</p>`,
          html`
            <ul data-testid="cart-list">
              ${repeat(
                cartRows(),
                (product) => html`
                  <li data-testid="cart-row">
                    <h3 data-testid="cart-title">${product.title}</h3>
                    <p data-testid="cart-row-total">Price: R${(product.price * product.cartCount).toFixed(2)}</p>
                    <button data-testid="cart-remove-one" @click=${() => removeOne(product.id)}>
                      ${product.cartCount === 1 ? 'Remove from Cart' : 'Remove One Item'}
                    </button>
                  </li>
                `,
                null,
                (product) => product.id,
              )}
            </ul>
          `,
        )}

        <h2 data-testid="cart-total">Total Items: ${cartCount()}</h2>
      </main>
    `,
  };
});

mount({
  component: CartApp,
  target: document.getElementById('app') ?? undefined,
});
