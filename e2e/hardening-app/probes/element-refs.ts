import { defineComponent, signal, html, ref, when } from 'thane';
import { expose } from '../shared/expose.js';

// Element refs: the input is focused from onMount through its ref; a ref in a when() branch is the element
// while the branch shows and null while it is hidden; a handler reads another element through its ref.
export const ElementRefs = defineComponent('hardening-element-refs', () => {
  const input = ref<HTMLInputElement>();
  const panel = ref<HTMLDivElement>();
  const canvas = ref<HTMLCanvasElement>();
  const open = signal(true);
  const copied = signal('');
  expose('elementRefs', { open, input, panel, canvas });
  return {
    template: html`<div>
      <input class="refs-input" ${input} value="typed" />
      <button class="refs-copy" @click=${() => copied(input.el.value)}>copy</button>
      <b class="refs-copied">${copied()}</b>
      ${when(open(), html`<div class="refs-panel" ${panel}>panel</div>`)}
      <canvas ${canvas} width="20" height="10"></canvas>
    </div>`,
    onMount: () => input.el.focus(),
  };
});
