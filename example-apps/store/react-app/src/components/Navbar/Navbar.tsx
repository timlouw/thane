import styles from './Navbar.module.css';
import { Link, NavLink } from 'react-router-dom';
import logo from '../../assets/images/storefront-mark.svg';
import cartIcon from '../../assets/icons/cart.svg';
import homeIcon from '../../assets/icons/home.svg';
import { useAppState } from '../../context/AppStateProvider';

export default function Navbar() {
  const { state } = useAppState();

  return (
    <nav className={styles.navbar}>
      <Link className={styles.logoLink} to="/">
        <img className={styles.logo} src={logo} alt="Storefront Logo" />
      </Link>
      <div className={styles.navigationButtonsContainer}>
        <NavLink className={({ isActive }) => (isActive ? `${styles.navigationButton} ${styles.active}` : styles.navigationButton)} to="/">
          <span className={styles.navigationText}>Home</span>
          <img className={styles.navigationIcon} src={homeIcon} alt="Home Icon" />
        </NavLink>
        <NavLink
          className={({ isActive }) => (isActive ? `${styles.navigationButton} ${styles.active}` : styles.navigationButton)}
          to="/my-cart"
        >
          <span className={styles.navigationText}>My Cart</span>
          <img className={styles.navigationIcon} src={cartIcon} alt="My Cart Icon" />
          {state.cartCount > 0 && <span className={styles.cartCounter}>{state.cartCount}</span>}
        </NavLink>
      </div>
    </nav>
  );
}
