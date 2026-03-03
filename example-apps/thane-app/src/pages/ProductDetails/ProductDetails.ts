import { computed, defineComponent, signal } from 'thane';
import styles from './ProductDetails.module.css';
import { addToCart, products } from '../../state/global-state.js';

const addToCartIconPath = '/assets/icons/add-to-cart.svg';

export const ProductDetailsPage = defineComponent('product-details-page', () => {
  const productID = signal(getRouteParam('productID'));

  const product = computed(() => products().find((item) => item.id.toString() === productID()) ?? null);
  const hasProduct = computed(() => product() !== null);
  const productTitle = computed(() => product()?.title ?? '');
  const productPrice = computed(() => product()?.price ?? 0);
  const productDescription = computed(() => product()?.description ?? '');
  const productCategory = computed(() => product()?.category ?? '');
  const isInCart = computed(() => (product()?.cartCount ?? 0) > 0);
  const cartItemCount = computed(() => product()?.cartCount ?? 0);
  const cartButtonText = computed(() => (isInCart() ? 'Added to Cart' : 'Add to Cart'));

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
          <h1 class="productTitle">${productTitle()}</h1>
          <p class="productPrice">R${productPrice()}</p>
          <p class="productDescription">${productDescription()}</p>
          <p class="productCategory">Category: ${productCategory()}</p>
          <button class=${isInCart() ? 'addToCartButton added' : 'addToCartButton'} @click=${addCurrentToCart}>
            <span>${cartButtonText()}</span>
            <img class="addToCartIcon" src=${addToCartIconPath} alt="Add to cart icon" />
            <span class="cartCounter" ${when(isInCart())}>${cartItemCount()}</span>
          </button>
          <p ${when(!hasProduct())}>The product you are looking for does not exist.</p>
        </div>
      </div>
    `,
    styles,
  };
});

export default ProductDetailsPage;
