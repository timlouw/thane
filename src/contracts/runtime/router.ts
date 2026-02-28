/**
 * Router contracts — shared constants between compiler and runtime for routing.
 */

export const ROUTER_FN = {
  MOUNT: 'mount',
  DEFINE_ROUTES: 'defineRoutes',
  START_ROUTER: 'startRouter',
  STOP_ROUTER: 'stopRouter',
  NAVIGATE: 'navigate',
  NAVIGATE_BACK: 'navigateBack',
  GET_ROUTE_PARAM: 'getRouteParam',
} as const;

export type RouterFunctionName = (typeof ROUTER_FN)[keyof typeof ROUTER_FN];

export const ROUTER_PROP = {
  /** Property name for the lazy component loader in a route definition */
  COMPONENT: 'component',
  /** Property name for the route title */
  TITLE: 'title',
  /** Property name for the router option in mount() */
  ROUTER: 'router',
  /** Property name for routes inside the router option */
  ROUTES: 'routes',
  /** Property name for notFound inside the router option */
  NOT_FOUND: 'notFound',
  /** Property name for the outlet ID */
  OUTLET_ID: 'outletId',
  /** The default id for the router outlet element */
  DEFAULT_OUTLET_ID: 'router-outlet',
} as const;

export type RouterPropName = (typeof ROUTER_PROP)[keyof typeof ROUTER_PROP];
