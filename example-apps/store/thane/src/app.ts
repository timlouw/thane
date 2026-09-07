import { defineComponent } from 'thane';
import appStyles from './App.module.css';
import { Navbar } from './components/Navbar/Navbar.js';

export const App = defineComponent('store-app', () => {
  return {
    template: html`
      <div class="appContainer">
        ${Navbar({})}
        <div class="routerOutletContainer" id="router-outlet"></div>
      </div>
    `,
    styles: appStyles,
  };
});
