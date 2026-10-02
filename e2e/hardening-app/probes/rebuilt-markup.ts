import { defineComponent, signal, html, repeat } from 'thane';
import { expose } from '../shared/expose.js';

// Markup the browser's parser rebuilds. A table written without <tbody> (the parser inserts
// one), a <p> followed by a block element (the parser closes the <p> first, and the stray </p>
// becomes a second, empty <p>), an unclosed <li> (closed by the next one), and a <select> with a
// static <option> before a repeat().
export const RebuiltMarkup = defineComponent('hardening-rebuilt-markup', () => {
  const t = signal('t1');
  const x = signal('x1');
  const opts = signal(['o1', 'o2']);
  const picks = signal(0);
  expose('rebuiltMarkup', { t, x, opts, picks });
  // prettier-ignore
  return html`<div class="rebuilt">
      <table class="rebuilt-table"><tr class="rebuilt-tr" title=${t()}><td class="rebuilt-td">${x()}</td><td class="rebuilt-td2" title=${t()} @click=${() => picks(picks() + 1)}>c</td></tr></table>
      <div class="rebuilt-pwrap"><p class="rebuilt-p">intro<div class="rebuilt-div" title=${t()}>${x()}</div></p><span class="rebuilt-after" title=${t()}>${x()}</span></div>
      <ul class="rebuilt-list"><li class="rebuilt-li" title=${t()}>one<li class="rebuilt-li2" title=${t()}>${x()}</ul>
      <select class="rebuilt-select"><option value="">Choose</option>${repeat(opts(), (o) => html`<option class="rebuilt-opt" value=${o}>${o}</option>`)}</select>
      <b class="rebuilt-picks">${picks()}</b>
    </div>`;
});
