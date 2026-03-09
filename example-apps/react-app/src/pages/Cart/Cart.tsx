import { Link } from 'react-router-dom';
import { useAppState } from '../../context/AppStateProvider';
import styles from './Cart.module.css';
import { AppStateProduct } from '../../models/app-state.models';

export default function Cart() {
  const { state, dispatch } = useAppState();

  const removeFromCart = (product: AppStateProduct) => {
    dispatch({ type: 'REMOVE_FROM_CART', payload: product.id });
  };

  const checkout = () => {
    console.log('Proceeding to checkout...');
  };

  return (
    <div className={styles.cartContainer}>
      {state.cartCount > 0 ? (
        <>
          <ul className={styles.cartList}>
            {state.products
              .filter((product) => product.cartCount > 0)
              .map((product) => (
                <li key={product.id} className={styles.cartItem}>
                  <img src={product.image} alt={product.title} className={styles.cartItemImage} />
                  <div>
                    <h3>{product.title}</h3>
                    {product.cartCount > 1 && <p>Unit Price: R{product.price}</p>}
                    <p>Price: R{(product.price * product.cartCount).toFixed(2)}</p>
                    <button
                      className={styles.removeButton}
                      onClick={() => {
                        removeFromCart(product);
                      }}
                    >
                      {product.cartCount === 1 ? 'Remove from Cart' : 'Remove One Item'}
                    </button>
                    {product.cartCount > 1 && <span className={styles.cartCounter}>{product.cartCount}</span>}
                  </div>
                </li>
              ))}
          </ul>
          <h2>
            Total Price: R
            {state.products
              .reduce((total, product) => {
                return total + product.cartCount * product.price;
              }, 0)
              .toFixed(2)}
          </h2>
          <button className={styles.checkoutButton} onClick={checkout}>
            Checkout
          </button>
        </>
      ) : (
        <p>
          Your cart is empty. <Link to="/">Select some items first.</Link>
        </p>
      )}
    </div>
  );
}
