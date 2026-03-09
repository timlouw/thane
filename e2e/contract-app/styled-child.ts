import { defineComponent } from 'thane';

/**
 * Minimal styled child component for CSS scoping/isolation tests.
 *
 * Uses class names that are intentionally shared with the parent template
 * (`.leak-target`) so we can verify that class-based scoping prevents cross-
 * component style leaking.
 */
export const StyledChild = defineComponent('styled-child', () => ({
  template: html`
    <div data-testid="css-child-styled">child-blue</div>
    <div data-testid="css-child-isolated" class="leak-target">child-bg</div>
    <div data-testid="css-child-inherits" class="parent-scoped">cascade-check</div>
  `,
  styles: css`
    [data-testid='css-child-styled'] {
      color: rgb(0, 0, 255);
    }
    .leak-target {
      background-color: rgb(255, 0, 0);
    }
  `,
}));
