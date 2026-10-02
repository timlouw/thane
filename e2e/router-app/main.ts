import { mount } from 'thane';
import { navigate } from 'thane/router';
import { Shell } from './shell.js';
import Routes from './routes.js';

mount(Shell, { routes: Routes, scrollRestoration: true });

// The specs navigate from outside the app, as code that imports navigate does
(window as unknown as { navigate: typeof navigate }).navigate = navigate;
