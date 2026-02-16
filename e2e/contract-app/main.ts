import { mount } from 'thane';
import { ContractApp } from './contract-app.js';

const target = document.getElementById('app') ?? document.body;
const handle = mount(ContractApp, target);

// Expose the mount handle on window for e2e destroy test
(window as any).__mountHandle = handle;
