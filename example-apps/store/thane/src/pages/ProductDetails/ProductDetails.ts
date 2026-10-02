import { defineComponent, html, when } from 'thane';
import styles from './ProductDetails.module.css';
import { addToCart, products } from '../../state/global-state.js';

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
