import { defineComponent, html } from 'thane';

/** A child component without lifecycle hooks (registered lean), whose setup returns its template alone. */
export const ProbeCard = defineComponent<{ label: string }>(
  'hardening-probe-card',
  ({ props }) => html`<span class="card">${props.label}</span>`,
);
