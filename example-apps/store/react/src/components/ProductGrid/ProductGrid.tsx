import styles from './ProductGrid.module.css';
import ProductCard from '../ProductCard/ProductCard';
import { AppStateProduct } from '../../models/app-state.models';

interface ProductGridProps {
  products: AppStateProduct[];
}

export default function ProductGrid({ products }: ProductGridProps) {
  return (
    <div className={styles.productGrid}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
