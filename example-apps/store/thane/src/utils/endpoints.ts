import type { ProductListApiResponse } from '../models/endpoint.models.js';
import { GET } from './http.js';

export const getAllProducts = () => {
  return GET<ProductListApiResponse>('/products');
};
