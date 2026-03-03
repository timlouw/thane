import { defineRoutes } from 'thane/router';

const Routes = defineRoutes({
  '/': { component: () => import('./pages/home.js'), title: 'Home' },
  '/about': { component: () => import('./pages/about.js'), title: 'About' },
  '/users/:id': { component: () => import('./pages/user.js'), title: 'User' },
  'notFound': { component: () => import('./pages/not-found.js'), title: '404 — Not Found' },
});

type Routes = typeof Routes;

// Register routes for type-safe navigate() and getRouteParam()
declare module 'thane' {
  interface Register {
    routes: Routes;
  }
}

export default Routes;
