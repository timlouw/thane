/**
 * Post-Build Processor — HTTP dev server with live reload
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import { consoleColors, ansi, getContentType, logger } from '../../utils/index.js';

const injectLiveReloadScript = (html: string): string => {
  const script = `<script>new EventSource('/__live-reload').onmessage=()=>location.reload()</script>`;
  return html.replace('</body>', `${script}</body>`);
};

const promptForPort = (): Promise<number> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${ansi.yellow}Enter a different port number: ${ansi.reset}`, (answer: string) => {
      rl.close();
      const port = parseInt(answer, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        logger.error('dev-server', 'Invalid port number. Please enter a number between 1 and 65535.');
        resolve(promptForPort());
      } else {
        resolve(port);
      }
    });
  });
};

export interface DevServerOptions {
  distDir: string;
  isProd?: boolean | undefined;
  useGzip?: boolean | undefined;
}

export class DevServer {
  private serverStarted = false;
  private sseClients: http.ServerResponse[] = [];
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
      client.write('data: reload\n\n');
    }
  }

  start(port: number = this.serverPort): void {
    const { distDir, isProd, useGzip } = this.options;

    const compressAndServe = (filePath: string, req: http.IncomingMessage, res: http.ServerResponse, contentType: string, cacheControl: string): void => {
      const acceptEncoding = req.headers['accept-encoding'] || '';
      const canCompress = useGzip && !contentType.startsWith('image/') && !contentType.startsWith('video/') && !contentType.startsWith('audio/');

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', cacheControl);

      if (canCompress) {
        const brotliQuality = isProd ? 11 : 4;

        res.setHeader('Vary', 'Accept-Encoding');
        if (acceptEncoding.includes('br')) {
          res.setHeader('Content-Encoding', 'br');
          const brotli = zlib.createBrotliCompress({
            params: {
              [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
              [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality,
              [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
            },
          });
          fs.createReadStream(filePath).pipe(brotli).pipe(res);
        } else if (acceptEncoding.includes('gzip')) {
          res.setHeader('Content-Encoding', 'gzip');
          const gzip = zlib.createGzip({ level: 9 });
          fs.createReadStream(filePath).pipe(gzip).pipe(res);
        } else {
          fs.createReadStream(filePath).pipe(res);
        }
      } else {
        fs.createReadStream(filePath).pipe(res);
      }
    };

    const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const requestedUrl = req.url || '/';
      const requestedPath = path.join(distDir, requestedUrl);
      const indexPath = path.join(distDir, 'index.html');
      const hasFileExtension = path.extname(requestedUrl).length > 0;

      if (requestedUrl === '/__live-reload') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        this.sseClients.push(res);
        req.on('close', () => {
          this.sseClients = this.sseClients.filter((client) => client !== res);
        });
        return;
      }

      try {
        const stat = await fs.promises.stat(requestedPath);
        if (stat.isFile()) {
          compressAndServe(requestedPath, req, res, getContentType(requestedUrl), 'public, max-age=31536000, immutable');
        } else if (!hasFileExtension) {
          compressAndServe(indexPath, req, res, 'text/html', 'no-cache');
        } else {
          res.statusCode = 404;
          res.end('Not Found');
        }
      } catch {
        if (!hasFileExtension) {
          compressAndServe(indexPath, req, res, 'text/html', 'no-cache');
        } else {
          res.statusCode = 404;
          res.end('Not Found');
        }
      }
    });

    server.on('error', async (err: Error & { code?: string }) => {
      if (err.code === 'EADDRINUSE') {
        logger.error('dev-server', `Port ${port} is already in use.`);
        const newPort = await promptForPort();
        this.start(newPort);
      } else {
        throw err;
      }
    });

    const url = `http://localhost:${port}/`;
    server.listen(port, () => {
      console.info(consoleColors.cyan, 'Live reload enabled');
      console.info(consoleColors.yellow, `Server running at ${url}`);
      console.info('');
      console.info('');
      this.serverStarted = true;
    });
  }

  static injectLiveReloadScript = injectLiveReloadScript;
}
