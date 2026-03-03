import { computed, defineComponent } from 'thane';
import styles from './Cart.module.css';
import { cartCount, products, removeFromCart } from '../../state/global-state.js';

export const CartPage = defineComponent('cart-page', () => {
  const cartProducts = computed(() => products().filter((product) => product.cartCount > 0));
  const totalPrice = computed(() =>
    products()
      .reduce((total, product) => total + product.cartCount * product.price, 0)
      .toFixed(2),
  );

  const removeItem = (productId: number) => {
    removeFromCart(productId);
  };

  const checkout = () => {
    console.log('Proceeding to checkout...');
  };

  return {
    template: html`
      <div class="cartContainer">
        ${whenElse(
          cartCount() === 0,
          html`<p>Your cart is empty. Select some items first.</p>`,
          html`
            <ul class="cartList">
              ${repeat(
                cartProducts(),
                (product) => html`
                  <li class="cartItem">
                    <img src=${product.image} alt=${product.title} class="cartItemImage" />
                    <div>
                      <h3>${product.title}</h3>
                      <p>${product.cartCount > 1 ? 'Unit Price: R' + product.price : ''}</p>
                      <p>Price: R${(product.price * product.cartCount).toFixed(2)}</p>
                      <button class="removeButton" @click=${() => removeItem(product.id)}>
                        ${product.cartCount === 1 ? 'Remove from Cart' : 'Remove One Item'}
                      </button>
                      <span class="cartCounter">${product.cartCount}</span>
                    </div>
                  </li>
                `,
                null,
                (product) => product.id,
              )}
            </ul>
          `,
        )}
        <h2>Total Price: R${totalPrice()}</h2>
        <button class="checkoutButton" @click=${checkout}>Checkout</button>
      </div>
    `,
    styles,
  };
});

export default CartPage;
