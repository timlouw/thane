import { signal, computed } from 'thane';
import type { Signal } from 'thane';
import type { AppStateProduct } from '../models/app-state.models.js';
import type { Product } from '../models/product.models.js';

const STORAGE_KEY = 'appState';

interface PersistedState {
  products: AppStateProduct[];
}

const loadState = (): AppStateProduct[] => {
  try {
    const localState = localStorage.getItem(STORAGE_KEY);
    if (!localState) return [];

    const parsed = JSON.parse(localState) as Partial<PersistedState>;
    return Array.isArray(parsed.products) ? parsed.products : [];
  } catch {
    return [];
  }
};

const hydratedProducts = loadState();

export const products = signal<Signal<AppStateProduct>[]>(hydratedProducts.map((p) => signal<AppStateProduct>(p)));

export const cartCount = computed(() => products().reduce((sum, p) => sum + p().cartCount, 0));

export const productsLoading = signal<boolean>(hydratedProducts.length === 0);
export const productsError = signal<string | null>(null);

const saveState = () => {
  try {
    const serialized = JSON.stringify({
      products: products().map((p) => p()),
    });
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    return;
  }
};

// Save whenever the product list changes (new products loaded)
products.subscribe(saveState, true);

export const setProducts = (payload: Product[]) => {
  const existingById = new Map<number, Signal<AppStateProduct>>(products().map((p) => [p().id, p]));

  const newProducts = payload.map((item) => {
    const existing = existingById.get(item.id);
    if (existing) {
      existing({ ...item, cartCount: existing().cartCount });
      return existing;
    }
    return signal<AppStateProduct>({ ...item, cartCount: 0 });
  });

  products(newProducts);
};

export const addToCart = (productId: number) => {
  const productSignal = products().find((p) => p().id === productId);
  if (!productSignal) return;
  const current = productSignal();
  productSignal({ ...current, cartCount: current.cartCount + 1 });
  saveState();
};

export const removeFromCart = (productId: number) => {
  const productSignal = products().find((p) => p().id === productId);
  if (!productSignal) return;
  const current = productSignal();
  if (current.cartCount <= 0) return;
  productSignal({ ...current, cartCount: current.cartCount - 1 });
  saveState();
};
