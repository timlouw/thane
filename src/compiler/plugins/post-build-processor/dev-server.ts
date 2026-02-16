/**
 * Post-Build Processor — HTTP dev server with live reload
 */

import { join, extname, resolve } from 'node:path';
import { brotliCompress, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';
import type { Server } from 'bun';
import { consoleColors, ansi, getContentType, logger } from '../../utils/index.js';

const brotliCompressAsync = promisify(brotliCompress);

const injectLiveReloadScript = (html: string): string => {
  const script = `<script>new EventSource('/__live-reload').onmessage=()=>location.reload()</script>`;
  return html.replace('</body>', `${script}</body>`);
};

const promptForPort = async (): Promise<number> => {
  process.stdout.write(`${ansi.yellow}Enter a different port number: ${ansi.reset}`);

  for await (const line of console) {
    const port = parseInt(line, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      logger.error('dev-server', 'Invalid port number. Please enter a number between 1 and 65535.');
      process.stdout.write(`${ansi.yellow}Enter a different port number: ${ansi.reset}`);
      continue;
    }
    return port;
  }

  return 4200; // fallback
};

export interface DevServerOptions {
  distDir: string;
  isProd?: boolean | undefined;
  useGzip?: boolean | undefined;
}

interface SSEController {
  controller: ReadableStreamDefaultController;
  signal: AbortSignal;
}

export class DevServer {
  private serverStarted = false;
  private sseClients: SSEController[] = [];
  private server: Server<undefined> | null = null;
  private readonly serverPort = 4200;
  private readonly options: DevServerOptions;

  constructor(options: DevServerOptions) {
    this.options = options;
  }

  get isStarted(): boolean {
    return this.serverStarted;
  }

  notifyLiveReloadClients(): void {
    for (const client of this.sseClients) {
      try {
        client.controller.enqueue('data: reload\n\n');
      } catch {
        /* client disconnected */
      }
    }
  }

  start(port: number = this.serverPort): void {
    const { distDir, isProd, useGzip } = this.options;

    // Pre-resolve the canonical dist root for path-traversal checks
    const canonicalDistDir = resolve(distDir);

    const compressAndRespond = async (filePath: string, req: Request, contentType: string, cacheControl: string): Promise<Response> => {
      const acceptEncoding = req.headers.get('accept-encoding') ?? '';
      const canCompress = useGzip && !contentType.startsWith('image/') && !contentType.startsWith('video/') && !contentType.startsWith('audio/');

      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
      };

      if (canCompress) {
        const brotliQuality = isProd ? 11 : 4;
        headers['Vary'] = 'Accept-Encoding';
        const raw = await Bun.file(filePath).bytes();

        if (acceptEncoding.includes('br')) {
          headers['Content-Encoding'] = 'br';
          const compressed = await brotliCompressAsync(raw, {
            params: {
              [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
              [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality,
              [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
            },
          });
          return new Response(compressed, { headers });
        } else if (acceptEncoding.includes('gzip')) {
          headers['Content-Encoding'] = 'gzip';
          const compressed = Bun.gzipSync(raw, { level: 9 });
          return new Response(compressed, { headers });
        }
      }

      return new Response(Bun.file(filePath), { headers });
    };

    try {
      this.server = Bun.serve({
        port,
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          const requestedUrl = url.pathname;

          // Path-traversal guard: resolve the requested path and ensure it
          // stays within the dist directory.
          const requestedPath = resolve(canonicalDistDir, '.' + requestedUrl);
          if (!requestedPath.startsWith(canonicalDistDir)) {
            return new Response('Forbidden', { status: 403 });
          }

          const indexPath = join(canonicalDistDir, 'index.html');
          const hasFileExtension = extname(requestedUrl).length > 0;

          if (requestedUrl === '/__live-reload') {
            const stream = new ReadableStream({
              start: (controller) => {
                const sseClient: SSEController = { controller, signal: req.signal };
                this.sseClients.push(sseClient);

                req.signal.addEventListener('abort', () => {
                  this.sseClients = this.sseClients.filter((c) => c !== sseClient);
                });
              },
            });

            return new Response(stream, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
              },
            });
          }

          try {
            const file = Bun.file(requestedPath);
            if (await file.exists()) {
              const stat = await file.stat();
              if (stat?.isFile()) {
                return compressAndRespond(requestedPath, req, getContentType(requestedUrl), 'public, max-age=31536000, immutable');
              } else if (!hasFileExtension) {
                return compressAndRespond(indexPath, req, 'text/html', 'no-cache');
              }
              return new Response('Not Found', { status: 404 });
            }
            if (!hasFileExtension) {
              return compressAndRespond(indexPath, req, 'text/html', 'no-cache');
            }
            return new Response('Not Found', { status: 404 });
          } catch {
            if (!hasFileExtension) {
              return compressAndRespond(indexPath, req, 'text/html', 'no-cache');
            }
            return new Response('Not Found', { status: 404 });
          }
        },
      });

      console.info(consoleColors.cyan, 'Live reload enabled');
      console.info(consoleColors.yellow, `Server running at ${this.server.url.href}`);
      console.info('');
      console.info('');
      this.serverStarted = true;
    } catch (err: unknown) {
      const error = err as Error & { code?: string };
      if (error.code === 'EADDRINUSE') {
        logger.error('dev-server', `Port ${port} is already in use.`);
        void promptForPort().then((newPort) => this.start(newPort));
      } else {
        throw err;
      }
    }
  }

  static injectLiveReloadScript = injectLiveReloadScript;
}
