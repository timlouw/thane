import React from 'react';
import ReactDOM from 'react-dom/client';
import './main.css';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AppStateProvider } from './context/AppStateProvider';

let rootElement = document.getElementById('root');

if (!rootElement) {
  console.log('root element does not exist in index.html - creating root element');
  rootElement = document.createElement('div');
  rootElement.id = 'root';
  document.body.appendChild(rootElement);
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppStateProvider>
      <RouterProvider router={router} />
    </AppStateProvider>
  </React.StrictMode>,
);
