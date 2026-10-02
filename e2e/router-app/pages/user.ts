import { defineComponent, signal, html } from 'thane';
import { visitCount } from '../store.js';

export const UserPage = defineComponent('user-page', ({ route }) => {
  visitCount(visitCount() + 1);

  const userId = signal(route!.params.id);

  return html`
    <section data-testid="user-page">
      <h2 data-testid="page-title">User Profile</h2>
      <div data-testid="user-id">${userId()}</div>
      <div data-testid="user-visit-count">${visitCount()}</div>
      <div data-testid="user-tab">${route!.search.tab}</div>
    </section>
  `;
});

export default UserPage;
