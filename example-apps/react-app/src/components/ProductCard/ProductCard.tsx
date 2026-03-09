import styles from './ProductCard.module.css';
import { useAppState } from '../../context/AppStateProvider';
import addToCartIcon from '../../assets/icons/add-to-cart.svg';
import { useNavigate } from 'react-router-dom';
import { AppStateProduct } from '../../models/app-state.models';

interface ProductCardProps {
  product: AppStateProduct;
}

export default function ProductCard({ product }: ProductCardProps) {
  const { dispatch } = useAppState();
  const navigate = useNavigate();

  const navigateToProductDetails = (productID: number) => {
    navigate(`/product-details/${productID.toString()}`);
  };

  const addToCart = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    dispatch({ type: 'ADD_TO_CART', payload: product.id });
  };

  return (
    <div
      className={styles.productCard}
      onClick={() => {
        navigateToProductDetails(product.id);
      }}
    >
      <img src={product.image} alt={product.title} className={styles.productImage} />
      <div className={styles.productDetails}>
        <h5 title={product.title} className={styles.productTitle}>
          {product.title}
        </h5>
        <p className={styles.productPrice}>R{product.price}</p>
      </div>
      <button
        className={product.cartCount > 0 ? `${styles.addToCartButton} ${styles.added}` : styles.addToCartButton}
        onClick={(event) => {
          addToCart(event);
        }}
      >
        {product.cartCount > 0 ? 'Added to cart' : 'Add to Cart'}
        <img className={styles.addToCartIcon} src={addToCartIcon} alt="Add to cart icon" />
        {product.cartCount > 0 && <span className={styles.cartCounter}>{product.cartCount}</span>}
      </button>
    </div>
  );
}
