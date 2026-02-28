import { defineComponent, signal } from 'thane';
import { visitCount, sharedMessage } from '../store.js';

export const HomePage = defineComponent('home-page', () => {
  visitCount(visitCount() + 1);

  const localCount = signal(0);
  const increment = () => localCount(localCount() + 1);
  const setMessage = () => sharedMessage('hello from home');

  return {
    template: html`
      <section data-testid="home-page">
        <h2 data-testid="page-title">Home</h2>
        <div data-testid="home-local-count">${localCount()}</div>
        <button data-testid="home-increment" @click=${increment}>+1</button>
        <button data-testid="home-set-message" @click=${setMessage}>Set Message</button>
        <div data-testid="home-visit-count">${visitCount()}</div>
      </section>
    `,
  };
});

export default HomePage;
