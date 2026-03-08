import { describe, test, expect } from 'bun:test';
import { matchRoute, defineRoutes } from './router.js';
import type { Route, RoutesMap } from './router.js';

// ─────────────────────────────────────────────────────────────
//  Test helpers
// ─────────────────────────────────────────────────────────────

/** Stub route — the component fn is never called in these tests. */
const stubRoute = (title?: string): Route => ({
  component: () => Promise.resolve({}),
  title,
});

/** Stub notFound route used by defineRoutes tests. */
const stubNotFound = stubRoute('404');

// ─────────────────────────────────────────────────────────────
//  matchRoute()
// ─────────────────────────────────────────────────────────────

describe('matchRoute', () => {
  const routes: RoutesMap = {
    '/': stubRoute('Home'),
    '/about': stubRoute('About'),
    '/users/:id': stubRoute('User'),
    '/posts/:postId/comments/:commentId': stubRoute('Comment'),
    '/docs/guide': stubRoute('Guide'),
  };

  // ── Exact matching ──

  test('matches root path exactly', () => {
    const result = matchRoute('/', routes);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('Home');
    expect(result!.params).toEqual({});
  });

  test('matches static path exactly', () => {
    const result = matchRoute('/about', routes);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('About');
    expect(result!.params).toEqual({});
  });

  test('matches nested static path exactly', () => {
    const result = matchRoute('/docs/guide', routes);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('Guide');
    expect(result!.params).toEqual({});
  });

  // ── Parameterised matching ──

  test('matches single param route and extracts param', () => {
    const result = matchRoute('/users/42', routes);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('User');
    expect(result!.params).toEqual({ id: '42' });
  });

  test('matches single param route with string value', () => {
    const result = matchRoute('/users/alice', routes);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('User');
    expect(result!.params).toEqual({ id: 'alice' });
  });

  test('matches multi-param route and extracts all params', () => {
    const result = matchRoute('/posts/99/comments/7', routes);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('Comment');
    expect(result!.params).toEqual({ postId: '99', commentId: '7' });
  });

  // ── No match ──

  test('returns null for unmatched path with no notFound', () => {
    const result = matchRoute('/nonexistent', routes);
    expect(result).toBeNull();
  });

  test('returns null when segment count mismatch prevents match', () => {
    const result = matchRoute('/users', routes);
    expect(result).toBeNull();
  });

  test('returns null for extra segments', () => {
    const result = matchRoute('/users/42/extra', routes);
    expect(result).toBeNull();
  });

  test('returns null for partial prefix match', () => {
    const result = matchRoute('/about/extra', routes);
    expect(result).toBeNull();
  });

  // ── Not found fallback ──

  test('returns notFound route when no match and notFound provided', () => {
    const notFound = stubRoute('404');
    const result = matchRoute('/nonexistent', routes, notFound);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('404');
    expect(result!.params).toEqual({});
  });

  test('notFound is used even for deep unmatched paths', () => {
    const notFound = stubRoute('Not Found');
    const result = matchRoute('/a/b/c/d', routes, notFound);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('Not Found');
  });

  // ── Edge cases ──

  test('exact match takes priority over parametric match', () => {
    const routesWithOverlap: RoutesMap = {
      '/users/me': stubRoute('Current User'),
      '/users/:id': stubRoute('User By ID'),
    };
    const result = matchRoute('/users/me', routesWithOverlap);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('Current User');
    expect(result!.params).toEqual({});
  });

  test('empty routes map returns null', () => {
    const result = matchRoute('/anything', {});
    expect(result).toBeNull();
  });

  test('empty routes map with notFound returns notFound', () => {
    const notFound = stubRoute('Empty 404');
    const result = matchRoute('/anything', {}, notFound);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('Empty 404');
  });

  test('param values can contain special characters (url-encoded segments)', () => {
    const result = matchRoute('/users/hello%20world', routes);
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ id: 'hello%20world' });
  });

  test('matches route with trailing static and param', () => {
    const trailingRoutes: RoutesMap = {
      '/api/:version/status': stubRoute('API Status'),
    };
    const result = matchRoute('/api/v2/status', trailingRoutes);
    expect(result).not.toBeNull();
    expect(result!.route.title).toBe('API Status');
    expect(result!.params).toEqual({ version: 'v2' });
  });
});

// ─────────────────────────────────────────────────────────────
//  defineRoutes()
// ─────────────────────────────────────────────────────────────

describe('defineRoutes', () => {
  test('accepts eager component routes', () => {
    const eagerComponent = { __f: () => ({ root: {} as any }) } as any;
    const routes = defineRoutes({
      '/': { component: eagerComponent, title: 'Home' },
      'notFound': stubNotFound,
    });

    expect(routes['/']?.component).toBe(eagerComponent);
  });

  test('returns the same routes object (identity function)', () => {
    const routes = {
      '/': stubRoute('Home'),
      '/about': stubRoute('About'),
      'notFound': stubNotFound,
    };
    const result = defineRoutes(routes);
    expect(result).toBe(routes);
  });

  test('accepts parameterised routes with static prefix', () => {
    const routes = defineRoutes({
      '/users/:id': stubRoute('User'),
      '/posts/:id/edit': stubRoute('Edit Post'),
      'notFound': stubNotFound,
    });
    expect(Object.keys(routes)).toContain('/users/:id');
    expect(Object.keys(routes)).toContain('/posts/:id/edit');
    expect(Object.keys(routes)).toContain('notFound');
  });

  test('throws for root-level param (/:param)', () => {
    expect(() => {
      defineRoutes({
        '/:slug': stubRoute('Dynamic'),
        'notFound': stubNotFound,
      } as any);
    }).toThrow('Root-level route parameter');
  });

  test('throws for root-level param with trailing segments (/:param/sub)', () => {
    expect(() => {
      defineRoutes({
        '/:category/items': stubRoute('Items'),
        'notFound': stubNotFound,
      } as any);
    }).toThrow('Root-level route parameter');
  });

  test('error message includes the offending route key', () => {
    expect(() => {
      defineRoutes({
        '/:bad': stubRoute('Bad'),
        'notFound': stubNotFound,
      } as any);
    }).toThrow('/:bad');
  });

  test('allows valid routes alongside each other', () => {
    const routes = defineRoutes({
      '/': stubRoute('Home'),
      '/about': stubRoute('About'),
      '/users/:id': stubRoute('User'),
      '/a/b/c': stubRoute('Deep'),
      'notFound': stubNotFound,
    });
    expect(Object.keys(routes)).toHaveLength(5);
  });

  test('single valid route passes validation', () => {
    const routes = defineRoutes({
      '/settings': stubRoute('Settings'),
      'notFound': stubNotFound,
    });
    expect(Object.keys(routes)).toContain('/settings');
    expect(Object.keys(routes)).toContain('notFound');
  });

  test('multiple root-level params all throw', () => {
    expect(() => {
      defineRoutes({
        '/:a': stubRoute('A'),
        '/:b': stubRoute('B'),
        'notFound': stubNotFound,
      } as any);
    }).toThrow('Root-level route parameter');
  });

  test('notFound key is not treated as a route pattern', () => {
    // notFound should not trigger the root-level param validation
    const routes = defineRoutes({
      '/': stubRoute('Home'),
      'notFound': stubNotFound,
    });
    expect(routes.notFound).toBe(stubNotFound);
  });
});

// ─────────────────────────────────────────────────────────────
//  matchRoute + defineRoutes integration
// ─────────────────────────────────────────────────────────────

describe('matchRoute + defineRoutes integration', () => {
  test('routes from defineRoutes work with matchRoute', () => {
    const config = defineRoutes({
      '/': stubRoute('Home'),
      '/items/:id': stubRoute('Item'),
      'notFound': stubNotFound,
    });

    // Separate notFound from the route map (mirrors what mount.ts does)
    const { notFound, ...routeMap } = config;

    const homeResult = matchRoute('/', routeMap);
    expect(homeResult!.route.title).toBe('Home');

    const itemResult = matchRoute('/items/abc', routeMap);
    expect(itemResult!.route.title).toBe('Item');
    expect(itemResult!.params).toEqual({ id: 'abc' });

    const missResult = matchRoute('/nope', routeMap, notFound);
    expect(missResult!.route.title).toBe('404');
  });
});

describe('currentPath global', () => {
  test('is exposed as a readable signal-like global', () => {
    const currentPathGlobal = (globalThis as any).currentPath;

    expect(currentPathGlobal).toBeTruthy();
    expect(typeof currentPathGlobal).toBe('function');
    expect(typeof currentPathGlobal.subscribe).toBe('function');
    expect(currentPathGlobal()).toBe('');
  });
});
