import { mount } from 'thane';
import { App } from './app.js';
import Routes from './routes.js';
import { currentPath } from './state/global-state.js';

currentPath(window.location.pathname);

mount({
  component: App,
  router: { routes: Routes },
});
