import { defineComponent, signal } from 'thane';
import { DestroyTracker } from './destroy-tracker';

/**
 * Grandchild component that itself contains a DestroyTracker.
 * Tests recursive destroy: parent → child → grandchild chain.
 */
export const DestroyGrandchild = defineComponent('destroy-grandchild', () => ({
  template: html`
    <div data-testid="destroy-grandchild-root"> ${DestroyTracker({ trackerId: 'grandchild-tracker' })} </div>
  `,
}));
