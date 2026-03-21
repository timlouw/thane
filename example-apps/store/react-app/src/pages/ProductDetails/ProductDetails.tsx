import { useParams } from 'react-router-dom';
import styles from './ProductDetails.module.css';
import { useAppState } from '../../context/AppStateProvider';
import NotFound from '../NotFound/NotFound';
import { RouteError } from '../../models/router.models';
import addToCartIcon from '../../assets/icons/add-to-cart.svg';

export default function ProductDetails() {
  const { productID } = useParams();
  const { state, dispatch } = useAppState();
  const notFoundError: RouteError = {
    statusText: 'Product Not Found',
    error: {
      message: 'The product you are looking for does not exist.',
    },
  };

  const product = state.products.find((product) => product.id.toString() === productID);

  const addToCart = () => {
    if (!product) return;
    dispatch({ type: 'ADD_TO_CART', payload: product.id });
  };

  return (
    <>
      {product ? (
        <div className={styles.productDetailContainer}>
          <div className={styles.productImageContainer}>
            <img src={product.image} alt={product.title} className={styles.productDetailImage} />
          </div>
          <div className={styles.productInfo}>
            <h1 className={styles.productTitle}>{product.title}</h1>
            <p className={styles.productPrice}>R{product.price}</p>
            <p className={styles.productDescription}>{product.description}</p>
            <p className={styles.productCategory}>Category: {product.category}</p>
            <button className={`${styles.addToCartButton} ${product.cartCount > 0 ? styles.added : ''}`} onClick={addToCart}>
              {product.cartCount > 0 ? 'Added to Cart' : 'Add to Cart'}
              <img className={styles.addToCartIcon} src={addToCartIcon} alt="Add to cart icon" />
              {product.cartCount > 0 && <span className={styles.cartCounter}>{product.cartCount}</span>}
            </button>
          </div>
        </div>
      ) : (
        <NotFound propsError={notFoundError} />
      )}
    </>
  );
}
