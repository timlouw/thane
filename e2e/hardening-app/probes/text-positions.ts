import { defineComponent, signal, html } from 'thane';
import { expose } from '../shared/expose.js';

// Text bindings at the start, middle and end of mixed text, two in a row, next to developer
// comments, inside <pre>, as sole content, and at the top level of the template.
export const TextPositions = defineComponent('hardening-text-positions', () => {
  const a = signal('A');
  const b = signal('B');
  expose('textPositions', { a, b });
  // prettier-ignore
  return html`top ${a()} level
    <div class="text-positions">
      <p class="text-start">${a()} tail</p>
      <p class="text-mid">head ${a()} tail</p>
      <p class="text-end">head ${a()}</p>
      <p class="text-two">${a()}${b()}</p>
      <p class="text-expr">${a() + '-' + b()}!</p>
      <p class="text-cmt"><!-- note -->${a()}<!-- other --> x ${b()}</p>
      <pre class="text-pre">line1
  ${a()} line2
${b()}</pre>
      <span class="text-sole">${b()}</span>
    </div>
    ${b()} end`;
});
