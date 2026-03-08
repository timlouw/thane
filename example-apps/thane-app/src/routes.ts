import { defineRoutes } from 'thane/router';
import ProductsPage from './pages/Products/Products.js';
import CartPage from './pages/Cart/Cart.js';
import ProductDetailsPage from './pages/ProductDetails/ProductDetails.js';
import NotFound from './pages/NotFound/NotFound.js';

const Routes = defineRoutes({
  '/': { component: ProductsPage, title: 'Products' },
  '/my-cart': { component: CartPage, title: 'My Cart' },
  '/product-details/:productID': {
    component: ProductDetailsPage,
    title: 'Product Details',
  },
  'notFound': { component: NotFound, title: 'Not Found' },
});

export default Routes;
