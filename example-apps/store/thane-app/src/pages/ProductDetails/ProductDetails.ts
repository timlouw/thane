import { defineComponent } from 'thane';
import styles from './ProductDetails.module.css';
import { addToCart, products } from '../../state/global-state.js';

const addToCartIconPath = '/assets/icons/add-to-cart.svg';

export const ProductDetailsPage = defineComponent('product-details-page', ({ route }) => {
  const productID = route!.params.productID;
  const productSignal = products().find((p) => p().id.toString() === productID) ?? null;

  const addCurrentToCart = () => {
    if (!productSignal) return;
    addToCart(productSignal().id);
  };

  return {
    template: html`
      <div class="productDetailContainer">
        <div class="productImageContainer">
          <img src=${productSignal?.().image ?? ''} alt=${productSignal?.().title ?? ''} class="productDetailImage" />
        </div>
        <div class="productInfo">
          <h1 class="productTitle">${productSignal?.().title ?? ''}</h1>
          <p class="productPrice">R${productSignal?.().price ?? 0}</p>
          <p class="productDescription">${productSignal?.().description ?? ''}</p>
          <p class="productCategory">Category: ${productSignal?.().category ?? ''}</p>
          <button
            class=${(productSignal?.().cartCount ?? 0) > 0 ? 'addToCartButton added' : 'addToCartButton'}
            @click=${addCurrentToCart}
          >
            <span>${(productSignal?.().cartCount ?? 0) > 0 ? 'Added to Cart' : 'Add to Cart'}</span>
            <img class="addToCartIcon" src=${addToCartIconPath} alt="Add to cart icon" />
            <span class="cartCounter" ${when((productSignal?.().cartCount ?? 0) > 0)}
              >${productSignal?.().cartCount ?? 0}</span
            >
          </button>
          <p ${when(productSignal === null)}>The product you are looking for does not exist.</p>
        </div>
      </div>
    `,
    styles,
  };
});

export default ProductDetailsPage;
