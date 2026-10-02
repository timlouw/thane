import { defineComponent, html, when } from 'thane';
import { isActive } from 'thane/router';
import styles from './Navbar.module.css';
import { cartCount } from '../../state/global-state.js';

export const Navbar = defineComponent(() => ({
  template: html`
    <nav class="navbar">
      <a class="logoLink" href="/">
        <img class="logo" src="/assets/images/storefront-mark.svg" alt="Store logo" />
      </a>
      <div class="navigationButtonsContainer">
        <a class="navigationButton" class:active=${isActive('/')} href="/">
          <span class="navigationText">Home</span>
          <img class="navigationIcon" src="/assets/icons/home.svg" alt="Home Icon" />
        </a>
        <a class="navigationButton" class:active=${isActive('/my-cart')} href="/my-cart">
          <span class="navigationText">My Cart</span>
          <img class="navigationIcon" src="/assets/icons/cart.svg" alt="My Cart Icon" />
          <span class="cartCounter" ${when(cartCount() > 0)}>${cartCount()}</span>
        </a>
      </div>
    </nav>
  `,
  styles,
}));
