import { defineRoutes } from 'thane/router';
import { ProductsPage } from './pages/Products/Products.js';
import { CartPage } from './pages/Cart/Cart.js';
import { ProductDetailsPage } from './pages/ProductDetails/ProductDetails.js';
import { NotFound } from './pages/NotFound/NotFound.js';

export default defineRoutes({
  '/': { component: ProductsPage, meta: { title: 'Products' } },
  '/my-cart': { component: CartPage, meta: { title: 'My Cart' } },
  '/product-details/:productID': { component: ProductDetailsPage, meta: { title: 'Product Details' } },
  'notFound': { component: NotFound, meta: { title: 'Not Found' } },
});
