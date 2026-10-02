import { mount } from 'thane';
import { HotApp } from './app.js';

mount(HotApp, { target: document.getElementById('app')! });
