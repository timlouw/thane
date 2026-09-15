/**
 * Static server for benchmark builds. Serves `bench/.build/<label>/` under `/<label>/`
 * and the vendored benchmark stylesheet under `/css/`, with the cross-origin isolation
 * headers that `performance.measureUserAgentSpecificMemory()` requires.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface BenchServer {
  port: number;
  close(): Promise<void>;
}

export function startServer(options: { buildRoot: string; cssRoot: string; port: number }): Promise<BenchServer> {
  const buildRoot = resolve(options.buildRoot);
  const cssRoot = resolve(options.cssRoot);

  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const isCss = pathname.startsWith('/css/');
    const root = isCss ? cssRoot : buildRoot;
    const file = resolve(root, '.' + (isCss ? pathname.slice('/css'.length) : pathname));

    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end(`Not found: ${pathname}`);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    createReadStream(file).pipe(res);
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      resolvePromise({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
