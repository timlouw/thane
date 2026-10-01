import { defineComponent, html } from 'thane';
import { IdsA } from '../shared/ids-a.js';
import { IdsB } from '../shared/ids-b.js';

// Two instances of one component and a second component, all using the same developer ids.
export const DuplicateIds = defineComponent('hardening-duplicate-ids', () => ({
  template: html`<div class="ids-page">
    <div class="ids-one">${IdsA({ n: 1 })}</div>
    <div class="ids-two">${IdsA({ n: 2 })}</div>
    <div class="ids-three">${IdsB({})}</div>
  </div>`,
}));
