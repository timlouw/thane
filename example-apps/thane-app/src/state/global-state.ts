import { signal } from 'thane';
import type { AppState, AppStateProduct } from '../models/app-state.models.js';
import type { Product } from '../models/product.models.js';
import { addToCartHandler, removeFromCartHandler, setProductsHandler } from './reducer-handlers.js';

const STORAGE_KEY = 'appState';

const initialState: AppState = {
  products: [],
  cartCount: 0,
};

const loadState = (): AppState => {
  try {
    const localState = localStorage.getItem(STORAGE_KEY);
    if (!localState) {
      return initialState;
    }

    const parsed = JSON.parse(localState) as Partial<AppState>;
    const products = Array.isArray(parsed.products) ? (parsed.products as AppStateProduct[]) : [];
    const cartCount =
      typeof parsed.cartCount === 'number'
        ? parsed.cartCount
        : products.reduce((sum, product) => sum + product.cartCount, 0);

    return { products, cartCount };
  } catch {
    return initialState;
  }
};

const hydratedState = loadState();

export const products = signal<AppStateProduct[]>(hydratedState.products);
export const cartCount = signal<number>(hydratedState.cartCount);
export const productsLoading = signal<boolean>(hydratedState.products.length === 0);
export const productsError = signal<string | null>(null);

const saveState = () => {
  try {
    const serializedState = JSON.stringify({
      products: products(),
      cartCount: cartCount(),
    });
    localStorage.setItem(STORAGE_KEY, serializedState);
  } catch {
    return;
  }
};

products.subscribe(saveState, true);
cartCount.subscribe(saveState, true);

const getCurrentState = (): AppState => ({
  products: products(),
  cartCount: cartCount(),
});

const applyState = (state: AppState) => {
  products(state.products);
  cartCount(state.cartCount);
};

export const setProducts = (payload: Product[]) => {
  const nextState = setProductsHandler(getCurrentState(), payload);
  applyState(nextState);
};

export const addToCart = (productId: number) => {
  const nextState = addToCartHandler(getCurrentState(), productId);
  applyState(nextState);
};

export const removeFromCart = (productId: number) => {
  const nextState = removeFromCartHandler(getCurrentState(), productId);
  applyState(nextState);
};
