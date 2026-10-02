/** 'thane/router': the router functions an app calls, and the types of route heads. */
export { currentPath, defineRoutes, href, isActive, navigate, navigateBack, setMeta } from './router.js';
export type { AppRouteMeta } from './router.js';
export { linkTag, metaName, metaProperty } from './router-head.js';
export type { CustomMetaField, HeadTag, RouteImage, RouteMeta, SiteMeta } from './router-head.js';
export { searchFlag, searchNumber, searchOneOf, searchString } from './router-search.js';
export type { SearchParser, SearchSchema } from './router-search.js';
