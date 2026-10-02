import { describe, test, expect } from 'bun:test';
import { matchRoute, defineRoutes, href, currentPath, isActive } from './router.js';
import type { Route, RoutesMap } from './router.js';

// ─────────────────────────────────────────────────────────────
//  Test helpers
// ─────────────────────────────────────────────────────────────

/** Stub route — the component fn is never called in these tests. */
const stubRoute = (title?: string): Route => ({
  component: () => Promise.resolve({}),
  meta: { title },
});

/** Stub notFound route used by defineRoutes tests. */
const stubNotFound = stubRoute('404');

/** The title a stub route carries */
const titleOf = (route: Route): string | undefined => (route.meta as { title?: string } | undefined)?.title;

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
    expect(titleOf(result!.route)).toBe('Home');
    expect(result!.params).toEqual({});
  });

  test('matches static path exactly', () => {
    const result = matchRoute('/about', routes);
    expect(result).not.toBeNull();
    expect(titleOf(result!.route)).toBe('About');
    expect(result!.params).toEqual({});
  });

  test('a trailing slash matches the route without it: a host serves a route page at /about/', () => {
    expect(matchRoute('/about/', routes)).toEqual({ pattern: '/about', route: routes['/about']!, params: {} });
    expect(matchRoute('/users/7/', routes)).toEqual({
      pattern: '/users/:id',
      route: routes['/users/:id']!,
      params: { id: '7' },
    });
    expect(matchRoute('/', routes)!.pattern).toBe('/');
  });

  test('matches nested static path exactly', () => {
    const result = matchRoute('/docs/guide', routes);
    expect(result).not.toBeNull();
    expect(titleOf(result!.route)).toBe('Guide');
    expect(result!.params).toEqual({});
  });

  // ── Parameterised matching ──

  test('matches single param route and extracts param', () => {
    const result = matchRoute('/users/42', routes);
    expect(result).not.toBeNull();
    expect(titleOf(result!.route)).toBe('User');
    expect(result!.params).toEqual({ id: '42' });
  });

  test('matches single param route with string value', () => {
    const result = matchRoute('/users/alice', routes);
    expect(result).not.toBeNull();
    expect(titleOf(result!.route)).toBe('User');
    expect(result!.params).toEqual({ id: 'alice' });
  });

  test('matches multi-param route and extracts all params', () => {
    const result = matchRoute('/posts/99/comments/7', routes);
    expect(result).not.toBeNull();
    expect(titleOf(result!.route)).toBe('Comment');
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
    expect(titleOf(result!.route)).toBe('404');
    expect(result!.params).toEqual({});
  });

  test('notFound is used even for deep unmatched paths', () => {
    const notFound = stubRoute('Not Found');
    const result = matchRoute('/a/b/c/d', routes, notFound);
    expect(result).not.toBeNull();
    expect(titleOf(result!.route)).toBe('Not Found');
  });

  // ── Edge cases ──

  test('exact match takes priority over parametric match', () => {
    const routesWithOverlap: RoutesMap = {
      '/users/me': stubRoute('Current User'),
      '/users/:id': stubRoute('User By ID'),
    };
    const result = matchRoute('/users/me', routesWithOverlap);
    expect(result).not.toBeNull();
    expect(titleOf(result!.route)).toBe('Current User');
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
    expect(titleOf(result!.route)).toBe('Empty 404');
  });

  test('param values are decoded; a malformed escape is kept as written', () => {
    expect(matchRoute('/users/hello%20world', routes)!.params).toEqual({ id: 'hello world' });
    expect(matchRoute('/users/caf%C3%A9', routes)!.params).toEqual({ id: 'café' });
    expect(matchRoute('/users/100%', routes)!.params).toEqual({ id: '100%' });
  });

  test('matches route with trailing static and param', () => {
    const trailingRoutes: RoutesMap = {
      '/api/:version/status': stubRoute('API Status'),
    };
    const result = matchRoute('/api/v2/status', trailingRoutes);
    expect(result).not.toBeNull();
    expect(titleOf(result!.route)).toBe('API Status');
    expect(result!.params).toEqual({ version: 'v2' });
  });
});

describe('href', () => {
  test('fills in every parameter, URL-encoded, and keeps the static segments', () => {
    expect(href('/users/:id', { id: 42 })).toBe('/users/42');
    expect(href('/users/:id/posts/:post', { id: 'a b', post: 'x/y?z' })).toBe('/users/a%20b/posts/x%2Fy%3Fz');
    expect(href('/:lang/about', { lang: 'en' })).toBe('/en/about');
  });

  test('what it gives, matchRoute reads back as the same params', () => {
    const routes: RoutesMap = { '/users/:id/posts/:post': stubRoute('Post') };
    const params = { id: 'café & co', post: '100%' };
    expect(matchRoute(href('/users/:id/posts/:post', params), routes)!.params).toEqual(params);
  });
});

// ─────────────────────────────────────────────────────────────
//  defineRoutes()
// ─────────────────────────────────────────────────────────────

describe('defineRoutes', () => {
  test('accepts eager component routes', () => {
    const eagerComponent = { __f: () => ({ root: {} as any }) } as any;
    const routes = defineRoutes({
      '/': { component: eagerComponent, meta: { title: 'Home' } },
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
    expect(titleOf(homeResult!.route)).toBe('Home');

    const itemResult = matchRoute('/items/abc', routeMap);
    expect(titleOf(itemResult!.route)).toBe('Item');
    expect(itemResult!.params).toEqual({ id: 'abc' });

    const missResult = matchRoute('/nope', routeMap, notFound);
    expect(titleOf(missResult!.route)).toBe('404');
  });
});

describe('currentPath and isActive', () => {
  test('currentPath is a readable signal, and no global', () => {
    expect(typeof currentPath).toBe('function');
    expect(typeof currentPath.subscribe).toBe('function');
    expect(currentPath()).toBe('');
    expect('currentPath' in globalThis).toBe(false);
  });

  test('isActive matches the current path: exactly, by parameters, or a section with /*', () => {
    const at = (path: string) => (currentPath as unknown as (value: string) => void)(path);
    try {
      at('/users/7');
      expect(isActive('/users/:id')).toBe(true);
      expect(isActive('/users')).toBe(false);
      expect(isActive('/users/*')).toBe(true);
      expect(isActive('/users/:id/posts')).toBe(false);
      expect(isActive('/*')).toBe(true);
      at('/users');
      expect(isActive('/users/*')).toBe(true);
      expect(isActive('/users/:id')).toBe(false);
      at('/about/');
      expect(isActive('/about')).toBe(true);
      at('/');
      expect(isActive('/')).toBe(true);
      expect(isActive('/about')).toBe(false);
    } finally {
      at('');
    }
  });

  test("isActive follows the path: it subscribes as currentPath does, which a template's binding uses", () => {
    const seen: string[] = [];
    const stop = isActive.subscribe((path) => seen.push(path), true);
    const at = (path: string) => (currentPath as unknown as (value: string) => void)(path);
    at('/x');
    at('/y');
    stop();
    at('');
    expect(seen).toEqual(['/x', '/y']);
  });
});
