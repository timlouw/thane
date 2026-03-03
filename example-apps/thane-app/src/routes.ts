import { defineRoutes } from 'thane/router';

const Routes = defineRoutes({
  '/': { component: () => import('./pages/Products/Products.js'), title: 'Products' },
  '/my-cart': { component: () => import('./pages/Cart/Cart.js'), title: 'My Cart' },
  '/product-details/:productID': {
    component: () => import('./pages/ProductDetails/ProductDetails.js'),
    title: 'Product Details',
  },
  'notFound': { component: () => import('./pages/NotFound/NotFound.js'), title: 'Not Found' },
});

type Routes = typeof Routes;

declare module 'thane' {
  interface Register {
    routes: Routes;
  }
}

export default Routes;
