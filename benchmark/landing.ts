import { defineComponent } from 'thane';
import { MyElementComponent } from './test';

export const AppComponent = defineComponent(() => {
  console.log('rendering landing page');

  return {
    template: html`
      <div>
        <h1>Welcome to the Landing Page</h1>
        <p>This is the main entry point of the application.</p>
        ${MyElementComponent({ color: 'red' })}
      </div>
    `,
  };
});
