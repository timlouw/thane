import { defineComponent } from 'thane';
import styles from './css-import-child.css';

/**
 * Child component that imports its styles from an external .css file.
 * Verifies the css-file-import path through the GlobalCSSBundlerPlugin.
 */
export const CssImportChild = defineComponent('css-import-child', () => ({
  template: html`
    <div data-testid="css-import-text" class="css-import-text">css-file-styled</div>
    <div data-testid="css-import-border" class="css-import-border">css-file-border</div>
  `,
  styles,
}));
