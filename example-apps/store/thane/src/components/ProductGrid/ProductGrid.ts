import { defineComponent, html, repeat } from 'thane';
import type { ReadonlySignal, Signal } from 'thane';
import type { AppStateProduct } from '../../models/app-state.models.js';
import { ProductCard } from '../ProductCard/ProductCard.js';
import styles from './ProductGrid.module.css';

type ProductGridProps = {
  products: ReadonlySignal<Signal<AppStateProduct>[]>;
};

export const ProductGrid = defineComponent<ProductGridProps>(({ props }) => ({
  template: html`
    <div class="productGrid">
      ${repeat(props.products(), (product) => ProductCard({ product }), {
        key: (product) => product().id,
        empty: html`<p>No products found.</p>`,
      })}
    </div>
  `,
  styles,
}));
