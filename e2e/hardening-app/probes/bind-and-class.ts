import { defineComponent, signal, html } from 'thane';
import { expose } from '../shared/expose.js';

// Two-way bindings (an input, a checkbox, a select) and class toggles
export const BindAndClass = defineComponent('hardening-bind-and-class', () => {
  const name = signal('ada');
  const agree = signal(false);
  const size = signal('m');
  expose('bindAndClass', { name, agree, size });
  return {
    template: html`<form>
      <input class="bc-name field" bind:value=${name} class:empty=${name() === ''} class:long=${name().length > 5} />
      <input class="bc-agree" type="checkbox" bind:checked=${agree} />
      <select class="bc-size" bind:value=${size}>
        <option value="s">S</option>
        <option value="m">M</option>
        <option value="l">L</option>
      </select>
      <p class="bc-out">${name()} ${agree() ? 'agreed' : 'not yet'} ${size()}</p>
    </form>`,
  };
});
