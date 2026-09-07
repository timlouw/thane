import { Product, ProductID } from './product.models';

const ACTIONS_ARRAY = ['SET_PRODUCTS', 'ADD_TO_CART', 'REMOVE_FROM_CART'] as const;

interface BaseAction {
  type: (typeof ACTIONS_ARRAY)[number];
  payload: unknown;
}

export interface AppStateProduct extends Product {
  cartCount: number;
}

export interface SetProductsAction extends BaseAction {
  type: 'SET_PRODUCTS';
  payload: Product[];
}

export interface AddToCartAction extends BaseAction {
  type: 'ADD_TO_CART';
  payload: ProductID;
}

export interface RemoveFromCartAction extends BaseAction {
  type: 'REMOVE_FROM_CART';
  payload: ProductID;
}

export type Action = SetProductsAction | AddToCartAction | RemoveFromCartAction;

export interface AppState {
  products: AppStateProduct[];
  cartCount: number;
}
