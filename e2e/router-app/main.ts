import { mount } from 'thane';
import { Shell } from './shell.js';
import Routes from './routes.js';

mount({
  component: Shell,
  router: {
    routes: Routes,
    scrollRestoration: true,
  },
});
