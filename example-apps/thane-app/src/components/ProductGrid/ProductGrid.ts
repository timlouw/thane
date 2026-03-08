import { defineComponent } from 'thane';
import type { AppStateProduct } from '../../models/app-state.models.js';
import { ProductCard } from '../ProductCard/ProductCard.js';
import styles from './ProductGrid.module.css';

type ProductGridProps = {
  products: () => AppStateProduct[];
};

export const ProductGrid = defineComponent<ProductGridProps>('product-grid', ({ props }) => {
  return {
    template: html`
      <div class="productGrid">
        ${repeat(
          props.products(),
          (product) => ProductCard({ product }),
          html`<p>No products found.</p>`,
          (product) => product.id,
        )}
      </div>
    `,
    styles,
  };
});

export default ProductGrid;
