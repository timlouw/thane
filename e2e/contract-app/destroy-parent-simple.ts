import { defineComponent, signal } from 'thane';
import { DestroyTracker } from './destroy-tracker';

/**
 * Parent that embeds a DestroyTracker as a top-level child (concise arrow).
 * Tests the concise arrow shorthand path + top-level child mount.
 */
export const DestroyParentSimple = defineComponent('destroy-parent-simple', () => ({
  template: html`
    <div data-testid="destroy-simple-root">
      <span>Simple parent</span>
      ${DestroyTracker({ trackerId: 'simple-child' })}
    </div>
  `,
}));
