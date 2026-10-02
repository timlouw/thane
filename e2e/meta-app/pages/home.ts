import { defineComponent, html } from 'thane';
import { navigate } from 'thane/router';

export const HomePage = defineComponent(
  'meta-home',
  () =>
    html`<main>
      <h1 class="home">Home</h1>
      <a class="to-about" href="/about" @click.prevent=${() => navigate('/about')}>About</a>
      <a class="to-product" href="/products/42" @click.prevent=${() => navigate('/products/42')}>Product</a>
    </main>`,
);
