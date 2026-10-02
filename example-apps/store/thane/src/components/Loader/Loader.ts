import { defineComponent, html } from 'thane';
import styles from './Loader.module.css';

export const Loader = defineComponent<{ text: string }>(({ props }) => ({
  template: html`
    <div class="loaderContainer">
      <div class="spinner"></div>
      <p>${props.text}</p>
    </div>
  `,
  styles,
}));
