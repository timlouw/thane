import { defineComponent } from 'thane';
import styles from './Loader.module.css';

type LoaderProps = {
  text: string;
};

export const Loader = defineComponent<LoaderProps>('ui-loader', ({ props }) => {
  return {
    template: html`
      <div class="loaderContainer">
        <div class="spinner"></div>
        <p>${props.text}</p>
      </div>
    `,
    styles,
  };
});

export default Loader;
