import { AddToCartAction, AppState, RemoveFromCartAction, SetProductsAction } from '../models/app-state.models';

export const setProductsHandler = (state: AppState, action: SetProductsAction) => {
  return { ...state, products: action.payload.map((product) => ({ ...product, cartCount: 0 })) };
};

export const addToCartHandler = (state: AppState, action: AddToCartAction) => {
  const products = state.products.map((product) => {
    if (product.id === action.payload) {
      return { ...product, cartCount: product.cartCount + 1 };
    }
    return product;
  });

  const newCartCount = state.cartCount + 1;
  return { ...state, products, cartCount: newCartCount };
};

export const removeFromCartHandler = (state: AppState, action: RemoveFromCartAction) => {
  const products = state.products.map((product) => {
    if (product.id === action.payload && product.cartCount > 0) {
      return { ...product, cartCount: product.cartCount - 1 };
    }
    return product;
  });

  const productInCart = state.products.find((product) => product.id === action.payload && product.cartCount > 0);
  const newCartCount = productInCart ? state.cartCount - 1 : state.cartCount;
  return { ...state, products, cartCount: newCartCount };
};
