import { defineComponent, html } from 'thane';
import styles from './Products.module.css';
import { ProductGrid } from '../../components/ProductGrid/ProductGrid.js';
import { Loader } from '../../components/Loader/Loader.js';
import { getAllProducts } from '../../utils/endpoints.js';
import { products, productsError, productsLoading, setProducts } from '../../state/global-state.js';

export const ProductsPage = defineComponent(() => ({
  template: html`
    <h1 class="productsTitle">Explore Our Products</h1>
    <p class="introText">
      Discover our wide range of products. From tech and clothing to jewelry, find the items you want most.
    </p>
    ${
      productsLoading()
        ? Loader({ text: 'Loading Products...' })
        : productsError() !== null
          ? html`<h1 class="error">There has been an error fetching the products - ${productsError()}</h1>`
          : ProductGrid({ products })
    }
  `,
  styles,
  onMount: () => {
    if (products().length > 0) {
      productsLoading(false);
      return;
    }
    productsLoading(true);
    productsError(null);
    getAllProducts()
      .then((data) => setProducts(data))
      .catch((error: unknown) => productsError(error instanceof Error ? error.message : 'An unknown error occurred'))
      .finally(() => productsLoading(false));
  },
}));
