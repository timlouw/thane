import { defineComponent, html } from 'thane';
import { navigate } from 'thane/router';

export const AboutPage = defineComponent(
  'meta-about',
  () =>
    html`<main>
      <h1 class="about">About</h1>
      <a class="to-home" href="/" @click.prevent=${() => navigate('/')}>Home</a>
    </main>`,
);
