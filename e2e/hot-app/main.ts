import { mount } from 'thane';
import { HotApp } from './app.js';

// The entry: when it changes, the page reloads
document.title = 'hot 1';
mount(HotApp, { target: document.getElementById('app')! });
