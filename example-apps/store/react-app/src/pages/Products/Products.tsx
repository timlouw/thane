import { useEffect, useState } from 'react';
import ProductGrid from '../../components/ProductGrid/ProductGrid';
import { useAppState } from '../../context/AppStateProvider';
import styles from './Products.module.css';
import { getAllProducts } from '../../utils/endpoints';
import Loader from '../../components/Loader/Loader';

export default function Products() {
  const { state, dispatch } = useAppState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.products.length === 0) {
      getAllProducts()
        .then((data) => {
          dispatch({ type: 'SET_PRODUCTS', payload: data });
          setLoading(false);
        })
        .catch((error: unknown) => {
          console.error('Error fetching products:', error);
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          setError(errorMessage);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [state.products.length, dispatch]);

  return (
    <>
      <h1 className={styles.productsTitle}>Explore Our Products</h1>
      <p className={styles.introText}>
        Discover our wide range of products. From tech and clothing to jewelry, find the items you want most.
      </p>
      {loading ? (
        <Loader text="Loading Products..." />
      ) : error ? (
        <h1 className={styles.error}>There has been an error fetching the products - {error}</h1>
      ) : (
        <ProductGrid products={state.products} />
      )}
    </>
  );
}
