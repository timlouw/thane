import { computed, defineComponent } from 'thane';
import styles from './Cart.module.css';
import { cartCount, products, removeFromCart } from '../../state/global-state.js';

export const CartPage = defineComponent('cart-page', () => {
  const cartProducts = computed(() => products().filter((p) => p().cartCount > 0));
  const totalPrice = computed(() =>
    products()
      .reduce((total, p) => total + p().cartCount * p().price, 0)
      .toFixed(2),
  );

  const removeItem = (productId: number) => {
    removeFromCart(productId);
  };

  const checkout = () => {
    console.log('Proceeding to checkout...');
  };

  const goHome = (event: Event) => {
    event.preventDefault();
    navigate('/');
  };

  return {
    template: html`
      <div class="cartContainer">
        ${whenElse(
          cartCount() === 0,
          html`<p>
            Your cart is empty.
            <a href="/" @click=${goHome}>Select some items first.</a>
          </p>`,
          html`
            <ul class="cartList">
              ${repeat(
                cartProducts(),
                (productSignal) => html`
                  <li class="cartItem">
                    <img src=${productSignal().image} alt=${productSignal().title} class="cartItemImage" />
                    <div>
                      <h3>${productSignal().title}</h3>
                      <p ${when(productSignal().cartCount > 1)}>${'Unit Price: R' + productSignal().price}</p>
                      <p>Price: R${(productSignal().price * productSignal().cartCount).toFixed(2)}</p>
                      <button class="removeButton" @click=${() => removeItem(productSignal().id)}>
                        ${productSignal().cartCount === 1 ? 'Remove from Cart' : 'Remove One Item'}
                      </button>
                      <span class="cartCounter" ${when(productSignal().cartCount > 1)}
                        >${productSignal().cartCount}</span
                      >
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

export default CartPage;
