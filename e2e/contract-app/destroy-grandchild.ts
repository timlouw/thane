import { defineComponent, signal, html } from 'thane';
import { DestroyTracker } from './destroy-tracker';

/**
 * Grandchild component that itself contains a DestroyTracker.
 * Tests recursive destroy: parent → child → grandchild chain.
 */
export const DestroyGrandchild = defineComponent(
  'destroy-grandchild',
  () => html`
    <div data-testid="destroy-grandchild-root"> ${DestroyTracker({ trackerId: 'grandchild-tracker' })} </div>
  `,
);
