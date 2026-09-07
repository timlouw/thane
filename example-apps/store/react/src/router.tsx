import { createBrowserRouter } from 'react-router-dom';
import App from './App';
import Products from './pages/Products/Products';
import NotFound from './pages/NotFound/NotFound';
import Cart from './pages/Cart/Cart';
import ProductDetails from './pages/ProductDetails/ProductDetails';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <NotFound />,
    children: [
      {
        index: true,
        path: '/',
        element: <Products />,
      },
      {
        path: 'my-cart',
        element: <Cart />,
      },
      {
        path: 'product-details/:productID',
        element: <ProductDetails />,
      },
    ],
  },
]);
