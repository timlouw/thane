import { defineComponent, html } from 'thane';
import styles from './App.module.css';
import { Navbar } from './components/Navbar/Navbar.js';

export const App = defineComponent(() => ({
  template: html`
    <div class="appContainer">
      ${Navbar()}
      <router-outlet class="routerOutletContainer"></router-outlet>
    </div>
  `,
  styles,
}));
