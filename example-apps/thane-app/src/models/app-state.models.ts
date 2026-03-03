import { Product, ProductID } from './product.models.js';

export interface AppStateProduct extends Product {
  cartCount: number;
}

export interface AppState {
  products: AppStateProduct[];
  cartCount: number;
}

export interface RouteError {
  statusText?: string;
  error?: {
    message?: string;
  };
}

export type SetProductsPayload = Product[];
export type AddToCartPayload = ProductID;
export type RemoveFromCartPayload = ProductID;
