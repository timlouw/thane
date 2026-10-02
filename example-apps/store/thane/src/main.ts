import { mount } from 'thane';
import { App } from './app.js';
import Routes from './routes.js';

mount(App, { routes: Routes });
