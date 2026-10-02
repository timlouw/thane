import { defineComponent, signal, html } from 'thane';
import { navigate, setMeta } from 'thane/router';

// The product's data "arrives" after the route: its head fields follow with setMeta()
export const ProductPage = defineComponent('meta-product', ({ route }) => {
  const name = signal('Loading');
  setTimeout(() => {
    name(`Widget ${route!.params.id}`);
    setMeta({ title: name(), description: 'A fine widget', image: '/img/widget.png', author: 'Grace Hopper' });
  }, 50);
  return {
    template: html`<main>
      <h1 class="product">${name()}</h1>
      <a class="to-home" href="/" @click.prevent=${() => navigate('/')}>Home</a>
    </main>`,
  };
});
