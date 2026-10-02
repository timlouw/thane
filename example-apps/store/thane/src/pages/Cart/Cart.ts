import { computed, defineComponent, html, when, repeat } from 'thane';
import styles from './Cart.module.css';
import { cartCount, products, removeFromCart } from '../../state/global-state.js';

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
