import { defineComponent, signal } from 'thane';
import styles from './Loader.module.css';

type LoaderProps = {
  text: string;
};

export const Loader = defineComponent<LoaderProps>('ui-loader', ({ props }) => {
  const text = signal(props.text);

  return {
    template: html`
      <div class="loaderContainer">
        <div class="spinner"></div>
        <p>${text()}</p>
      </div>
    `,
    styles,
  };
});

export default Loader;
