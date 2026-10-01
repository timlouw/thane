import { defineComponent, signal, html, when, whenElse } from 'thane';
import { expose } from '../shared/expose.js';

// Directives at the top level of the template: a when() element and a whenElse() that are
// direct children of the component root, next to a static element.
export const TopLevelBranches = defineComponent('hardening-top-level-branches', () => {
  const t = signal('t0');
  const a = signal(true);
  const b = signal(false);
  expose('topLevelBranches', { t, a, b });
  return {
    // prettier-ignore
    template: html`<b class="top-w" ${when(a())} title=${t()}>${t()}</b>${whenElse(b(), html`<i class="top-then" title=${t()}>${t()}</i>`, html`<u class="top-else" title=${t()}>${t()}</u>`)}<span class="top-static">S</span>`,
  };
});
