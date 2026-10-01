import { defineComponent, html } from 'thane';
import { countCall } from './expose.js';

/**
 * A child component that counts its `onMount` and `onDestroy` calls per label in
 * `window.__counts.countingKidMount` / `window.__counts.countingKidDestroy` (children inside directives).
 */
export const CountingKid = defineComponent<{ label: string }>('hardening-counting-kid', ({ props }) => ({
  template: html`<em class="ckid">${props.label}</em>`,
  onMount: () => {
    countCall('countingKidMount', props.label);
  },
  onDestroy: () => {
    countCall('countingKidDestroy', props.label);
  },
}));
