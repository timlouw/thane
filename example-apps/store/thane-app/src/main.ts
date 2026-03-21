import { mount } from 'thane';
import { App } from './app.js';
import Routes from './routes.js';

mount({
  component: App,
  router: { routes: Routes },
});
