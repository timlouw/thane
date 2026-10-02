import { mount } from 'thane';
import { ContractApp } from './contract-app.js';

const handle = mount(ContractApp, { target: document.getElementById('app') ?? undefined });

// Expose the mount handle on window for e2e destroy test
(window as any).__mountHandle = handle;
