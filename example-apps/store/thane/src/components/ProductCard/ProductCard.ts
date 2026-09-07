import { defineComponent } from 'thane';
import type { Signal } from 'thane';
import type { AppStateProduct } from '../../models/app-state.models.js';
import { addToCart } from '../../state/global-state.js';
import styles from './ProductCard.module.css';

const addToCartIconPath = '/assets/icons/add-to-cart.svg';

type ProductCardProps = {
  product: Signal<AppStateProduct>;
};

export const ProductCard = defineComponent<ProductCardProps>('product-card', ({ props }) => {
  const product = props.product;

  const addCurrentToCart = (event: Event) => {
    event.stopPropagation();
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

export default ProductCard;
