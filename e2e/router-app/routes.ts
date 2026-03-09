import { defineRoutes } from 'thane/router';
import HomePage from './pages/home.js';

const Routes = defineRoutes({
  '/': { component: HomePage, title: 'Home' },
  '/about': { component: () => import('./pages/about.js'), title: 'About' },
  '/users/:id': { component: () => import('./pages/user.js'), title: 'User' },
  'notFound': { component: () => import('./pages/not-found.js'), title: '404 — Not Found' },
});

export default Routes;
