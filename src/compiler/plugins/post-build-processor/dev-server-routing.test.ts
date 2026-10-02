/**
 * Characterisation of dev-server request routing and compression.
 *
 * Real `DevServer` instances on port 0 serve a temporary dist directory. Each request pins the
 * status, the headers the server sets, and the body (decoded, for compressed responses: a change to the
 * compression may change the compressed bytes but not what they decode to).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { DevServer, type DevServerOptions } from './dev-server.js';

const INDEX = '<!doctype html><p>index</p>';
const MAIN_JS = 'console.log(1);'.repeat(50);

let root = '';
let dist = '';
let distWithoutIndex = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'thane-dev-server-'));
  dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(join(dist, 'dir.d'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), INDEX);
  writeFileSync(join(dist, 'main.js'), MAIN_JS);
  writeFileSync(join(dist, 'assets', 'My Logo.png'), 'PNGDATA');
  writeFileSync(join(dist, 'café.txt'), 'cafe');
  writeFileSync(join(root, 'secret.txt'), 'secret');
  distWithoutIndex = join(root, 'dist-without-index');
  mkdirSync(distWithoutIndex);
  writeFileSync(join(distWithoutIndex, 'main.js'), MAIN_JS);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Served {
  status: number;
  /** The headers the server sets itself */
  headers: Record<string, string>;
  /** The body, decoded according to Content-Encoding */
  body: string;
}

const OWN_HEADERS = ['cache-control', 'content-encoding', 'content-type', 'vary'];

/** Start a server for the duration of `fn`, with its console output silenced. */
const withServer = async (
  options: Partial<DevServerOptions>,
  fn: (get: (path: string, acceptEncoding?: string) => Promise<Served>) => Promise<void>,
) => {
  const info = console.info;
  console.info = () => {};
  const server = new DevServer({ distDir: dist, host: 'localhost', port: 0, ...options });
  try {
    server.start(0);
  } finally {
    console.info = info;
  }
  const base = (server as unknown as { server: { url: URL } }).server.url.href.replace(/\/$/, '');
  const get = async (path: string, acceptEncoding = 'identity'): Promise<Served> => {
    const res = await fetch(base + path, {
      headers: { 'accept-encoding': acceptEncoding },
      decompress: false,
    } as RequestInit);
    const raw = new Uint8Array(await res.arrayBuffer());
    const encoding = res.headers.get('content-encoding');
    const decoded = encoding === 'br' ? brotliDecompressSync(raw) : encoding === 'gzip' ? gunzipSync(raw) : raw;
    const headers: Record<string, string> = {};
    for (const name of OWN_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null && (res.status === 200 || name !== 'content-type')) headers[name] = value;
    }
    return { status: res.status, headers, body: new TextDecoder().decode(decoded) };
  };
  try {
    await fn(get);
  } finally {
    server.stop();
  }
};

/** A production server lets a file be cached for a year; a development server has it revalidated */
const cacheOf = (isProd: boolean): string => (isProd ? 'public, max-age=31536000, immutable' : 'no-cache');
const file = (isProd: boolean, contentType: string, body: string, extra: Record<string, string> = {}): Served => ({
  status: 200,
  headers: { 'cache-control': cacheOf(isProd), 'content-type': contentType, ...extra },
  body,
});
const index = (extra: Record<string, string> = {}): Served => ({
  status: 200,
  headers: { 'cache-control': 'no-cache', 'content-type': 'text/html; charset=utf-8', ...extra },
  body: INDEX,
});
const status = (code: number, body: string): Served => ({ status: code, headers: {}, body });

/** Routes whose outcome does not depend on the server options, apart from compression headers. */
const routes = (isProd: boolean, vary: Record<string, string>): Array<[string, Served]> => [
  ['/', index(vary)],
  ['/main.js', file(isProd, 'text/javascript; charset=utf-8', MAIN_JS, vary)],
  ['/main.js?v=1', file(isProd, 'text/javascript; charset=utf-8', MAIN_JS, vary)],
  // A directory without an extension falls back to index.html; with an extension it is a 404
  ['/assets', index(vary)],
  ['/assets/', index(vary)],
  ['/dir.d', status(404, 'Not Found')],
  // Extension-less paths are client routes
  ['/about', index(vary)],
  ['/nested/route/x', index(vary)],
  ['/v1.2/users', index(vary)],
  ['/missing.js', status(404, 'Not Found')],
  ['/missing.css', status(404, 'Not Found')],
  // Percent-encoded names are decoded before the lookup
  ['/assets/My%20Logo.png', file(isProd, 'image/png', 'PNGDATA')],
  ['/caf%C3%A9.txt', file(isProd, 'text/plain; charset=utf-8', 'cafe', vary)],
  // Traversal and malformed escapes are refused
  ['/..%2F..%2Fsecret.txt', status(403, 'Forbidden')],
  ['/..%2Fsecret.txt', status(403, 'Forbidden')],
  ['/assets/%E0%A4%A', status(403, 'Forbidden')],
];

describe('dev server routing without compression', () => {
  test('development server', async () => {
    await withServer({ isProd: false, useGzip: false }, async (get) => {
      for (const [path, expected] of routes(false, {})) {
        expect([path, await get(path)]).toEqual([path, expected]);
      }
      // The browser-event socket path refuses a plain request in development
      expect(await get('/__thane-browser-events')).toEqual(status(400, 'WebSocket upgrade failed'));
      // Compression is off: accept-encoding is ignored
      expect(await get('/main.js', 'br, gzip')).toEqual(file(false, 'text/javascript; charset=utf-8', MAIN_JS));
    });
  });

  test('production server: the socket path is an ordinary client route', async () => {
    await withServer({ isProd: true, useGzip: false }, async (get) => {
      for (const [path, expected] of routes(true, {})) {
        expect([path, await get(path)]).toEqual([path, expected]);
      }
      expect(await get('/__thane-browser-events')).toEqual(index());
    });
  });
});

describe('a dist without index.html', () => {
  for (const isProd of [false, true]) {
    for (const useGzip of [false, true]) {
      test(`${isProd ? 'production' : 'development'}${useGzip ? ', useGzip' : ''}: client routes get a 404`, async () => {
        await withServer({ distDir: distWithoutIndex, isProd, useGzip }, async (get) => {
          expect(await get('/')).toEqual(status(404, 'Not Found'));
          expect(await get('/about', 'br, gzip')).toEqual(status(404, 'Not Found'));
          expect(await get('/missing.js')).toEqual(status(404, 'Not Found'));
          expect((await get('/main.js')).status).toBe(200);
        });
      });
    }
  }
});

describe('dev server routing with useGzip', () => {
  for (const isProd of [false, true]) {
    test(`${isProd ? 'production' : 'development'}: routes, Vary on compressible responses`, async () => {
      await withServer({ isProd, useGzip: true }, async (get) => {
        for (const [path, expected] of routes(isProd, { vary: 'Accept-Encoding' })) {
          expect([path, await get(path)]).toEqual([path, expected]);
        }
      });
    });

    test(`${isProd ? 'production' : 'development'}: brotli is preferred, gzip next, identity otherwise`, async () => {
      await withServer({ isProd, useGzip: true }, async (get) => {
        const vary = { vary: 'Accept-Encoding' };
        expect(await get('/main.js', 'br')).toEqual(
          file(isProd, 'text/javascript; charset=utf-8', MAIN_JS, { ...vary, 'content-encoding': 'br' }),
        );
        expect(await get('/main.js', 'gzip')).toEqual(
          file(isProd, 'text/javascript; charset=utf-8', MAIN_JS, { ...vary, 'content-encoding': 'gzip' }),
        );
        expect(await get('/main.js', 'gzip, deflate, br')).toEqual(
          file(isProd, 'text/javascript; charset=utf-8', MAIN_JS, { ...vary, 'content-encoding': 'br' }),
        );
        expect(await get('/main.js', 'deflate')).toEqual(file(isProd, 'text/javascript; charset=utf-8', MAIN_JS, vary));
        // The index.html fallback is compressed too
        expect(await get('/about', 'gzip')).toEqual(index({ ...vary, 'content-encoding': 'gzip' }));
        // Images are never compressed and carry no Vary
        expect(await get('/assets/My%20Logo.png', 'br')).toEqual(file(isProd, 'image/png', 'PNGDATA'));
      });
    });
  }
});

describe('page reloads', () => {
  /** A started server, and a page's browser-event socket connected to it */
  const withSocket = async (fn: (server: DevServer, messages: string[]) => Promise<void>) => {
    const info = console.info;
    console.info = () => {};
    const server = new DevServer({ distDir: dist, host: 'localhost', port: 0, isProd: false });
    try {
      server.start(0);
    } finally {
      console.info = info;
    }
    const url = (server as unknown as { server: { url: URL } }).server.url;
    const socket = new WebSocket(`ws://${url.host}/__thane-browser-events`);
    const messages: string[] = [];
    socket.addEventListener('message', (event) => messages.push(String(event.data)));
    try {
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve);
        socket.addEventListener('error', reject);
      });
      await fn(server, messages);
    } finally {
      socket.close();
      server.stop();
    }
  };

  const waitFor = async (condition: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !condition(); i++) await Bun.sleep(10);
  };

  test('development: every open page is told to reload', async () => {
    await withSocket(async (server, messages) => {
      server.reloadPages();
      await waitFor(() => messages.length > 0);
      expect(messages).toEqual(['reload']);
    });
  });

  test('development: a hot update goes to every open page', async () => {
    await withSocket(async (server, messages) => {
      const update = { key: 'src/card.ts', code: 'module.exports = 1;', needs: { thane: ['signal'] } };
      server.hotUpdate([update]);
      await waitFor(() => messages.length > 0);
      expect(messages.map((message) => JSON.parse(message))).toEqual([{ hot: [update] }]);
    });
  });

  test('the page script reloads when told to, and when a hot update does not apply', () => {
    const html = DevServer.injectBrowserRelayScript('<head></head>');
    expect(html).toContain("if (event.data === 'reload') location.reload();");
    expect(html).toContain('else if (!applyHotUpdates(JSON.parse(event.data).hot)) location.reload();');
    // Components register for swapping before the app's module runs
    expect(html.indexOf('window.__thaneHot = {};')).toBeGreaterThan(-1);
    expect(html).toContain("id.startsWith('__thane_package__:')");
  });

  /**
   * The page script, run with a fake socket and page: `modules` is what the page's modules registered. Returns
   * a function that sends a hot update, and how often the page reloaded.
   */
  const page = (modules: Map<string, unknown>) => {
    const script = /<script>([\s\S]*)<\/script>/.exec(DevServer.injectBrowserRelayScript(''))![1]!;
    const listeners = new Map<string, (event: { data: string }) => void>();
    class FakeSocket {
      static OPEN = 1;
      readyState = 0;
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        listeners.set(type, listener);
      }
      send() {}
    }
    const reloads = { count: 0 };
    const location = { protocol: 'http:', host: 'x', href: 'http://x/', reload: () => reloads.count++ };
    const window = { __thaneModules: modules, addEventListener() {} };
    const console = { error() {} };
    new Function('window', 'WebSocket', 'location', 'console', 'setTimeout', script)(
      window,
      FakeSocket,
      location,
      console,
      () => {},
    );
    const send = (update: object) => listeners.get('message')!({ data: JSON.stringify({ hot: [update] }) });
    return { send, reloads };
  };
  const CODE = 'module.exports = { made: require("__thane_package__:thane").signal(2) };';

  test('the page runs an update whose package bindings its modules registered, and keeps its new exports', () => {
    const modules = new Map<string, unknown>([
      ['src/card.ts', {}],
      ['pkg:thane', { signal: (n: number) => n * 2 }],
    ]);
    const { send, reloads } = page(modules);
    send({ key: 'src/card.ts', code: CODE, needs: { thane: ['signal'] } });
    expect(reloads.count).toBe(0);
    expect(modules.get('src/card.ts')).toEqual({ made: 4 });
  });

  test('the page reloads for an update that reads a binding no module registered, or a module it has not loaded', () => {
    const modules = new Map<string, unknown>([
      ['src/card.ts', {}],
      ['pkg:thane', { signal: () => 0 }],
    ]);
    const { send, reloads } = page(modules);
    send({ key: 'src/card.ts', code: CODE, needs: { thane: ['signal', 'effect'] } });
    send({ key: 'src/card.ts', code: CODE, needs: { 'thane/router': ['navigate'] } });
    send({ key: 'src/other.ts', code: CODE, needs: {} });
    // A whole namespace is there when a module registered it whole
    send({ key: 'src/card.ts', code: CODE, needs: { thane: ['*'] } });
    expect(reloads.count).toBe(4);
    modules.set('pkg*:thane', true);
    send({ key: 'src/card.ts', code: CODE, needs: { thane: ['*'] } });
    expect(reloads.count).toBe(4);
  });
});

describe('a request handler that fails', () => {
  // The options the server is started with (the method is private to the class, not to the test)
  const serveOptions = (isProd: boolean) =>
    (new DevServer({ distDir: dist, host: 'localhost', port: 0, isProd }) as any).createServeOptions(0);

  test('production: a bare 500, without Bun development error page and its stack', async () => {
    const options = serveOptions(true);
    expect(options.development).toBe(false);
    const response: Response = options.error(new Error('boom at /secret/place.ts:1:1'));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
  });

  test('development: Bun development mode, whose error page helps while developing', () => {
    const options = serveOptions(false);
    expect(options.development).toEqual({ hmr: true });
    expect(options.error).toBeUndefined();
  });
});
