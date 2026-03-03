import { defineComponent } from 'thane';
import appStyles from './App.module.css';
import { Navbar } from './components/Navbar/Navbar.js';
import { currentPath } from './state/global-state.js';

export const App = defineComponent('store-app', () => {
  const syncPath = () => {
    currentPath(window.location.pathname);
  };

  return {
    template: html`
      <div class="appContainer">
        ${Navbar({})}
        <div class="routerOutletContainer" id="router-outlet"></div>
      </div>
    `,
    styles: appStyles,
    onMount: () => {
      window.addEventListener('popstate', syncPath);
    },
    onDestroy: () => {
      window.removeEventListener('popstate', syncPath);
    },
  };
});
