import { defineComponent, html, repeat, signal } from 'thane';

// Fragments that another module's template uses (the importedFragments probe): a static one, one that
// reads this module's signal and mounts a component this module does not export, and one with a list.
export const exportedTone = signal('calm');
export const exportedTags = signal(['a', 'b']);

const ExportedKid = defineComponent<{ n: number }>(({ props }) => ({
  template: html`<em class="exported-kid-n">${props.n}</em>`,
}));

export const ExportedStatic = html`<span class="exported-static">static</span>`;

export const ExportedBadge = html`<b class="exported-badge" data-tone=${exportedTone()}>${exportedTone()}</b
  >${ExportedKid({ n: 3 })}`;

export const ExportedTags = html`<ul class="exported-tags">
  ${repeat(exportedTags(), (tag) => html`<li class="exported-tag">${tag}</li>`, { key: (tag) => tag })}
</ul>`;
