import { defineComponent } from 'thane';
import { DestroyTracker } from './destroy-tracker';
import { DestroyGrandchild } from './destroy-grandchild';

/**
 * Parent that tests nested child destroy (3 levels deep):
 *   DestroyParentNested → DestroyTracker (direct child)
 *                       → DestroyGrandchild → DestroyTracker (grandchild)
 *
 * Destroying this parent should fire onDestroy for BOTH trackers.
 */
export const DestroyParentNested = defineComponent('destroy-parent-nested', () => ({
  template: html`
    <div data-testid="destroy-nested-root">
      <span>Nested parent</span>
      ${DestroyTracker({ trackerId: 'nested-direct' })}
      ${DestroyGrandchild({})}
    </div>
  `,
}));
