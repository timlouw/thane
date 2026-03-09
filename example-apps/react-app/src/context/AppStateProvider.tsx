import React, { createContext, useReducer, useContext, ReactNode, useEffect } from 'react';
import { Action, AppState } from '../models/app-state.models';
import { addToCartHandler, removeFromCartHandler, setProductsHandler } from './ReducerHandlers';

const initialState: AppState = {
  products: [],
  cartCount: 0,
};

const AppStateContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
}>({
  state: initialState,
  dispatch: () => null,
});

const reducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'SET_PRODUCTS':
      return setProductsHandler(state, action);
    case 'ADD_TO_CART':
      return addToCartHandler(state, action);
    case 'REMOVE_FROM_CART':
      return removeFromCartHandler(state, action);

    default:
      return state;
  }
};

export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  const loadLocalState = (): AppState => {
    try {
      const localState = localStorage.getItem('appState');
      if (!localState) {
        return initialState;
      }
      return JSON.parse(localState) as AppState;
    } catch (err) {
      return initialState;
    }
  };

  const [state, dispatch] = useReducer(reducer, loadLocalState());

  const saveState = (state: AppState) => {
    try {
      const serializedState = JSON.stringify(state);
      localStorage.setItem('appState', serializedState);
    } catch (err) {
      console.error('Failed to save state to local storage:', err);
    }
  };

  useEffect(() => {
    saveState(state);
  }, [state]);

  return <AppStateContext.Provider value={{ state, dispatch }}>{children}</AppStateContext.Provider>;
};

export const useAppState = () => useContext(AppStateContext);
