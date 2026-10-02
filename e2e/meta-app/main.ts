/**
 * Route heads: the site's meta, each route's, custom fields, a meta function and setMeta(). Its own
 * TypeScript project, so its generated route types do not meet the router app's.
 */
import { mount } from 'thane';
import Routes from './routes.js';

mount(Routes, { scrollRestoration: false });
