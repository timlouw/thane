import { Product } from './product.models.js';

export interface AppStateProduct extends Product {
  cartCount: number;
}
