import { defineComponent, signal, html, when } from 'thane';
import { expose } from '../shared/expose.js';
import { CountingKid } from '../shared/counting-kid.js';

// when() / when() as the only child of an element, next to text, and nested three deep,
// each with bindings, an event and a child component inside. The spec toggles each one five times
// and counts the children's onMount / onDestroy calls.
export const BranchPositions = defineComponent('hardening-branch-positions', () => {
  const t = signal('t0');
  const only = signal(true);
  const text = signal(true);
  const l1 = signal(true);
  const l2 = signal(true);
  const l3 = signal(true);
  const clicks = signal(0);
  const inc = () => clicks(clicks() + 1);
  expose('branchPositions', { t, only, text, l1, l2, l3, clicks });
  // prettier-ignore
  return html`<div class="branches">
      <section class="branches-only"><div class="branches-only-w" ${when(only())} title=${t()}>${t()}<button class="branches-only-btn" @click=${inc}>+</button>${CountingKid({ label: 'only' })}</div></section>
      <section class="branches-text">before ${when(text(), html`<i class="branches-then" title=${t()}>${t()}<button class="branches-then-btn" @click=${inc}>+</button>${CountingKid({ label: 'then' })}</i>`, html`<u class="branches-else" title=${t()}>${t()}</u>`)} after</section>
      <section class="branches-deep">
        <div class="branches-l1" ${when(l1())} title=${t()}>
          L1:${t()}
          ${when(l2(), html`<div class="branches-l2" title=${t()}>L2:${t()}<p class="branches-l3" ${when(l3())} title=${t()}>L3:${t()}<button class="branches-l3-btn" @click=${inc}>+</button>${CountingKid({ label: 'l3' })}</p></div>`, html`<span class="branches-l2-else">no</span>`)}
        </div>
      </section>
      <b class="branches-clicks">${clicks()}</b>
    </div>`;
});
