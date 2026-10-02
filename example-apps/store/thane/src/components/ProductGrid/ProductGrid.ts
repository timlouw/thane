import { defineComponent, html, repeat } from 'thane';
import type { Signal } from 'thane';
import type { AppStateProduct } from '../../models/app-state.models.js';
import { ProductCard } from '../ProductCard/ProductCard.js';
import styles from './ProductGrid.module.css';

type ProductGridProps = {
  products: () => Signal<AppStateProduct>[];
};

export const ProductGrid = defineComponent<ProductGridProps>('product-grid', ({ props }) => {
  return {
    template: html`
      <div class="productGrid">
        ${repeat(props.products(), (product) => ProductCard({ product }), {
          key: (product) => product().id,
          empty: html`<p>No products found.</p>`,
        })}
      </div>
    `,
    styles,
  };
});

export default ProductGrid;
