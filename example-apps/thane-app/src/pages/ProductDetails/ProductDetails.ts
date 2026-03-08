import { computed, defineComponent } from 'thane';
import styles from './ProductDetails.module.css';
import { addToCart, products } from '../../state/global-state.js';

const addToCartIconPath = '/assets/icons/add-to-cart.svg';

export const ProductDetailsPage = defineComponent('product-details-page', ({ route }) => {
  const productID = route.params.productID;

  const product = computed(() => products().find((item) => item.id.toString() === productID) ?? null);

  const addCurrentToCart = () => {
    const selectedProduct = product();
    if (!selectedProduct) return;
    addToCart(selectedProduct.id);
  };

  return {
    template: html`
      <div class="productDetailContainer">
        <div class="productImageContainer">
          <img src=${product()?.image ?? ''} alt=${product()?.title ?? ''} class="productDetailImage" />
        </div>
        <div class="productInfo">
          <h1 class="productTitle">${product()?.title ?? ''}</h1>
          <p class="productPrice">R${product()?.price ?? 0}</p>
          <p class="productDescription">${product()?.description ?? ''}</p>
          <p class="productCategory">Category: ${product()?.category ?? ''}</p>
          <button
            class=${(product()?.cartCount ?? 0) > 0 ? 'addToCartButton added' : 'addToCartButton'}
            @click=${addCurrentToCart}
          >
            <span>${(product()?.cartCount ?? 0) > 0 ? 'Added to Cart' : 'Add to Cart'}</span>
            <img class="addToCartIcon" src=${addToCartIconPath} alt="Add to cart icon" />
            <span class="cartCounter" ${when((product()?.cartCount ?? 0) > 0)}>${product()?.cartCount ?? 0}</span>
          </button>
          <p ${when(product() === null)}>The product you are looking for does not exist.</p>
        </div>
      </div>
    `,
    styles,
  };
});

export default ProductDetailsPage;
