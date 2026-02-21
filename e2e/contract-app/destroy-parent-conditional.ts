import { defineComponent, signal } from 'thane';
import { DestroyTracker } from './destroy-tracker';

/**
 * Parent with a child inside a when() conditional.
 * When the conditional hides, the child's cleanup should fire.
 * When the parent is destroyed, all children should be cleaned up.
 */
export const DestroyParentConditional = defineComponent('destroy-parent-conditional', ({ props }) => {
  const showChild = signal(true);
  const toggle = () => showChild(!showChild());

  return {
    template: html`
      <div data-testid="destroy-conditional-root">
        <button data-testid="destroy-cond-toggle" @click=${toggle}>Toggle</button>
        <div data-testid="destroy-cond-status">${showChild() ? 'visible' : 'hidden'}</div>
        <div data-testid="destroy-cond-branch" ${when(showChild())}>
          ${DestroyTracker({ trackerId: 'cond-child' })}
        </div>
      </div>
    `,
  };
});
