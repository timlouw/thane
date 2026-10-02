import { defineComponent, signal, html, when } from 'thane';
import { expose } from '../shared/expose.js';
import { IdsChild } from '../shared/ids-child.js';

// A lookup inside a when() that shows later must not find a same-id element of a child
// component that sits before it (the id lookup searched the whole component root, children included).
export const ChildSameId = defineComponent('hardening-child-same-id', () => {
  const t = signal('own');
  const show = signal(false);
  expose('childSameId', { t, show });
  return {
    template: html`<div class="ids-nested">
      ${IdsChild()}
      <div ${when(show())}><p id="dev-shared" class="ids-own-p" title=${t()}>own</p></div>
    </div>`,
  };
});
