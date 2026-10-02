import { defineComponent, html } from 'thane';

/** A child component whose element carries the same developer id as one in its parent. */
export const IdsChild = defineComponent(
  'hardening-ids-child',
  () => html`<p id="dev-shared" class="ids-child-p" title="child">child</p>`,
);
