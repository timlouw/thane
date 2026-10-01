import { defineComponent, html } from 'thane';

// The setup declares a helper function that returns an object literal before its own return.
export const HelperReturn = defineComponent('hardening-helper-return', ({ root }) => {
  function helper() {
    return { a: 1 };
  }
  helper();
  return {
    template: html`<p class="helper-return">helper</p>`,
    onMount: () => {
      root.setAttribute('data-mounted', 'yes');
    },
  };
});
