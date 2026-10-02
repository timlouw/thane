import { defineComponent, html } from 'thane';
import { navigate } from 'thane/router';
import styles from './NotFound.module.css';

export const NotFound = defineComponent(() => ({
  template: html`
    <div class="errorPage">
      <h1>Oops!</h1>
      <p>The page you requested does not exist.</p>
      <button class="returnHomeButton" @click=${navigate('/')}>Return Home</button>
    </div>
  `,
  styles,
}));
