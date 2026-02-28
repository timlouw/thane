import { defineComponent } from 'thane';
import { visitCount, sharedMessage } from '../store.js';

export const AboutPage = defineComponent('about-page', () => {
  visitCount(visitCount() + 1);

  const setMessage = () => sharedMessage('hello from about');

  return {
    template: html`
      <section data-testid="about-page">
        <h2 data-testid="page-title">About</h2>
        <p data-testid="about-text">This is the about page.</p>
        <button data-testid="about-set-message" @click=${setMessage}>Set Message</button>
        <div data-testid="about-visit-count">${visitCount()}</div>
        <div data-testid="about-shared-message">${sharedMessage()}</div>
      </section>
    `,
  };
});

export default AboutPage;
