import { defineComponent } from 'thane';
import { LeakyChild } from './leaky-child';

/**
 * Simple parent that embeds a LeakyChild.
 * When this parent is destroyed, LeakyChild.onDestroy is never called.
 */
export const ParentWithChild = defineComponent('parent-with-child', () => ({
  template: html`
    <div>
      <span>Parent component</span>
      ${LeakyChild({})}
    </div>
  `,
}));
