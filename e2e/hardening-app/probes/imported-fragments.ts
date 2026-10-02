import { defineComponent, signal, html, when, repeat } from 'thane';
import { expose } from '../shared/expose.js';
import {
  ExportedStatic,
  ExportedBadge,
  ExportedTags,
  exportedTone,
  exportedTags,
} from '../shared/exported-fragments.js';

// Fragments another module exports. The static one is written out in place; the ones with bindings
// are mounted at the top level, in a when() branch and in rows, and follow their module's signals.
export const ImportedFragments = defineComponent('hardening-imported-fragments', () => {
  const open = signal(true);
  const rows = signal([1, 2]);
  expose('importedFragments', { open, rows, tone: exportedTone, tags: exportedTags });
  return html`<div class="imported">
    <p class="imported-top">${ExportedStatic}${ExportedBadge}</p>
    <div class="imported-branch">${when(open(), ExportedTags)}</div>
    <ol class="imported-rows">
      ${repeat(rows(), (row) => html`<li class="imported-row">${row}${ExportedBadge}</li>`, { key: (row) => row })}
    </ol>
  </div>`;
});
