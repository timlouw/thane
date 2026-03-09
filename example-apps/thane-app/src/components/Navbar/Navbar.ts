import { defineComponent } from 'thane';
import styles from './Navbar.module.css';
import { cartCount } from '../../state/global-state.js';

const logoPath = '/assets/images/dvt-logo.svg';
const cartIconPath = '/assets/icons/cart.svg';
const homeIconPath = '/assets/icons/home.svg';

export const Navbar = defineComponent('store-navbar', () => {
  return {
    template: html`
      <nav class="navbar">
        <a class="logoLink" @click=${navigate('/')}>
          <img class="logo" src=${logoPath} alt="DVT Logo" />
        </a>
        <div class="navigationButtonsContainer">
          <a class=${currentPath() === '/' ? 'navigationButton active' : 'navigationButton'} @click=${navigate('/')}>
            <span class="navigationText">Home</span>
            <img class="navigationIcon" src=${homeIconPath} alt="Home Icon" />
          </a>
          <a
            class=${currentPath() === '/my-cart' ? 'navigationButton active' : 'navigationButton'}
            @click=${navigate('/my-cart')}
          >
            <span class="navigationText">My Cart</span>
            <img class="navigationIcon" src=${cartIconPath} alt="My Cart Icon" />
            <span class="cartCounter" ${when(cartCount() > 0)}>${cartCount()}</span>
          </a>
        </div>
      </nav>
    `,
    styles,
  };
});

export default Navbar;
