
import { defineComponent, signal, mount } from 'thane';

export const App = defineComponent('test-app', () => {
  const items = signal([{ id: 1, label: 'A' }]);
  const click = (item: any) => {};
  return {
    template: html`
      <ul>
        ${repeat(items(), (item) => html`<li><a @click=${() => click(item)}>${item.label}</a></li>`, (item) => item.id)}
      </ul>
    `,
  };
});
mount(App);
