import type {
  AddToCartPayload,
  AppState,
  AppStateProduct,
  RemoveFromCartPayload,
  SetProductsPayload,
} from '../models/app-state.models.js';

export const setProductsHandler = (state: AppState, payload: SetProductsPayload): AppState => {
  const existingCartCountById = new Map<number, number>(
    state.products.map((product) => [product.id, product.cartCount]),
  );
  const products: AppStateProduct[] = payload.map((product) => ({
    ...product,
    cartCount: existingCartCountById.get(product.id) ?? 0,
  }));

  const cartCount = products.reduce((sum, product) => sum + product.cartCount, 0);
  return { ...state, products, cartCount };
};

export const addToCartHandler = (state: AppState, payload: AddToCartPayload): AppState => {
  const products = state.products.map((product) => {
    if (product.id === payload) {
      return { ...product, cartCount: product.cartCount + 1 };
    }
    return product;
  });

  const cartCount = state.cartCount + 1;
  return { ...state, products, cartCount };
};

export const removeFromCartHandler = (state: AppState, payload: RemoveFromCartPayload): AppState => {
  const products = state.products.map((product) => {
    if (product.id === payload && product.cartCount > 0) {
      return { ...product, cartCount: product.cartCount - 1 };
    }
    return product;
  });

  const inCart = state.products.some((product) => product.id === payload && product.cartCount > 0);
  const cartCount = inCart ? state.cartCount - 1 : state.cartCount;
  return { ...state, products, cartCount };
};
