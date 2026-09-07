import { ProductListApiResponse } from '../models/endpoint.models';
import { GET } from './http';

export const getAllProducts = () => {
  return GET<ProductListApiResponse>(`/products`);
};
