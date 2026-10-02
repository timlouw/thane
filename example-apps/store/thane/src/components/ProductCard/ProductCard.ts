import { defineComponent, html, when } from 'thane';
import type { Signal } from 'thane';
import { navigate } from 'thane/router';
import type { AppStateProduct } from '../../models/app-state.models.js';
import { addToCart } from '../../state/global-state.js';
import styles from './ProductCard.module.css';

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
