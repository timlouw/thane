/**
 * Post-Build Processor — HTTP dev server
 */

import { basename, join, extname, relative, resolve } from 'node:path';
import { brotliCompress, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';
import type { Server } from 'bun';
import { consoleColors, ansi, getContentType, logger } from '../../utils/index.js';

const brotliCompressAsync = promisify(brotliCompress);

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
  port?: number | undefined;
  open?: boolean | undefined;
  host?: string | undefined;
}

const BROWSER_ERROR_SENTINEL = 'THANE_BROWSER_ERROR';

type ResolvedBrowserLocation = {
  source: string;
  line: number;
  column: number;
};

type BrowserRelayMessage = {
  level: 'error' | 'pageerror' | 'unhandledrejection';
  pageUrl: string;
  args?: string[] | undefined;
  message?: string | undefined;
  source?: string | undefined;
  lineno?: number | undefined;
  colno?: number | undefined;
  stack?: string | undefined;
};

export class DevServer {
  private serverStarted = false;
  private server: Server<undefined> | null = null;
  private currentPort: number;
  private readonly serverPort: number;
  private readonly serverHost: string;
  private readonly autoOpen: boolean;
  private readonly options: DevServerOptions;

  constructor(options: DevServerOptions) {
    this.options = options;
    this.serverPort = options.port ?? 4200;
    this.currentPort = this.serverPort;
    this.serverHost = options.host ?? 'localhost';
    this.autoOpen = options.open ?? false;
  }

  get isStarted(): boolean {
    return this.serverStarted;
  }

  notifyLiveReloadClients(): void {
    if (!this.server || this.options.isProd) {
      return;
    }

    this.server.reload(this.createServeOptions(this.currentPort));
  }

  stop(): void {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }

    this.serverStarted = false;
  }

  private logBrowserRelayMessage(message: BrowserRelayMessage): void {
    const summaryMessage = this.formatBrowserMessage(
      message.level,
      message.message ?? ((message.args ?? []).join(' ') || 'Unknown browser error'),
    );
    const location = this.formatBrowserLocation(
      this.resolveBrowserLocation(message.source, message.lineno, message.colno),
    );
    const stackLines = this.compactStackLines(message.stack, summaryMessage, location);

    console.error(`[${BROWSER_ERROR_SENTINEL}] ${summaryMessage}`);

    if (location) {
      console.error(`source ${location}`);
    }

    for (const line of stackLines) {
      console.error(`stack ${line}`);
    }

    console.error('');
  }

  private formatBrowserMessage(level: BrowserRelayMessage['level'], message: string): string {
    const normalized = message.trim();
    if (level === 'pageerror' && !/^Uncaught\s+/u.test(normalized)) {
      return `Uncaught ${normalized}`;
    }

    return normalized;
  }

  private resolveBrowserLocation(source?: string, line?: number, column?: number): ResolvedBrowserLocation | null {
    if (!source || line == null || column == null) {
      return null;
    }

    const generatedFilePath = this.resolveGeneratedFilePath(source);
    if (generatedFilePath) {
      return {
        source: this.normalizeGeneratedSource(generatedFilePath),
        line,
        column,
      };
    }

    return this.createFallbackLocation(source, line, column);
  }

  private createFallbackLocation(source: string, line: number, column: number): ResolvedBrowserLocation {
    let compactSource = source;
    try {
      const parsed = new URL(source);
      compactSource = basename(parsed.pathname) || parsed.pathname || parsed.href;
    } catch {
      compactSource = basename(source);
    }

    return {
      source: compactSource,
      line,
      column,
    };
  }

  private formatBrowserLocation(location: ResolvedBrowserLocation | null): string {
    if (!location) {
      return '';
    }

    return `${location.source}:${location.line}:${location.column}`;
  }

  private compactStackLines(stack?: string, summaryMessage?: string, sourceLocation?: string): string[] {
    if (!stack) {
      return [];
    }

    const normalizedSummary = (summaryMessage ?? '').toLowerCase();
    const lines: string[] = [];
    const seen = new Set<string>();

    for (const rawLine of stack.split(/\r?\n/u)) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        continue;
      }

      const compactLine = trimmed.replace(/^(?:at\s+)/u, 'at ');
      const normalizedLine = compactLine.toLowerCase();
      if (normalizedSummary && normalizedLine.includes(normalizedSummary)) {
        continue;
      }

      const rewrittenLine = this.rewriteStackLine(compactLine).replace(/\s+/gu, ' ');
      const stackLocation = this.extractStackLocation(rewrittenLine);
      if (!stackLocation || seen.has(stackLocation) || (sourceLocation && stackLocation === sourceLocation)) {
        continue;
      }

      seen.add(stackLocation);
      lines.push(`at ${stackLocation}`);
    }

    return lines;
  }

  private rewriteStackLine(line: string): string {
    const locationMatch = line.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/u);
    if (!locationMatch) {
      return line;
    }

    const [, source, lineNumber, columnNumber] = locationMatch;
    const resolved = this.resolveBrowserLocation(source, Number(lineNumber), Number(columnNumber));
    if (!resolved) {
      return line.replace(/\(https?:\/\/[^/]+\//gu, '(').replace(/^(?:https?:\/\/[^/]+\/)/u, '');
    }

    return line.replace(locationMatch[0], this.formatBrowserLocation(resolved));
  }

  private extractStackLocation(line: string): string | null {
    const inParensMatch = line.match(/\(([^()]+:\d+:\d+)\)/u);
    if (inParensMatch?.[1]) {
      return inParensMatch[1];
    }

    const directMatch = line.match(/(?:^|\s)([^\s()]+:\d+:\d+)$/u);
    if (directMatch?.[1]) {
      return directMatch[1];
    }

    return null;
  }

  private resolveGeneratedFilePath(source: string): string | null {
    try {
      const parsed = new URL(source);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }

      const requestedPath = resolve(this.options.distDir, '.' + parsed.pathname);
      const canonicalDistDir = resolve(this.options.distDir);
      if (!requestedPath.startsWith(canonicalDistDir)) {
        return null;
      }

      return requestedPath;
    } catch {
      return null;
    }
  }

  private normalizeGeneratedSource(generatedFilePath: string): string {
    const relativePath = relative(resolve(this.options.distDir), generatedFilePath);
    return relativePath.replace(/\\/gu, '/');
  }

  static injectBrowserRelayScript(html: string): string {
    const script = `<script>
(() => {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  const queue = [];
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/__thane-browser-events';
  let socket;

  const serialize = (value) => {
    if (value instanceof Error) {
      return value.stack || value.message || String(value);
    }
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const send = (payload) => {
    const message = JSON.stringify({ ...payload, pageUrl: location.href });
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      return;
    }
    queue.push(message);
  };

  const connect = () => {
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      while (queue.length > 0) {
        const message = queue.shift();
        if (message) socket.send(message);
      }
    });
    socket.addEventListener('close', () => {
      setTimeout(connect, 500);
    });
  };

  connect();

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    send({ level: 'error', args: args.map(serialize) });
    originalError(...args);
  };

  window.addEventListener('error', (event) => {
    send({
      level: 'pageerror',
      message: event.message,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error && event.error.stack ? String(event.error.stack) : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    send({
      level: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : serialize(reason),
      stack: reason instanceof Error && reason.stack ? String(reason.stack) : undefined,
    });
  });
})();
</script>`;

    if (html.includes('</head>')) {
      return html.replace('</head>', `${script}</head>`);
    }
    return `${script}${html}`;
  }

  private createServeOptions(port: number): Bun.Serve.Options<undefined> {
    const { distDir, isProd, useGzip } = this.options;

    // Pre-resolve the canonical dist root for path-traversal checks
    const canonicalDistDir = resolve(distDir);

    const compressAndRespond = async (
      filePath: string,
      req: Request,
      contentType: string,
      cacheControl: string,
    ): Promise<Response> => {
      const acceptEncoding = req.headers.get('accept-encoding') ?? '';
      const canCompress =
        useGzip &&
        !contentType.startsWith('image/') &&
        !contentType.startsWith('video/') &&
        !contentType.startsWith('audio/');

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

    return {
      port,
      hostname: this.serverHost,
      ...(isProd
        ? {}
        : {
            development: {
              hmr: true,
            },
          }),
      fetch: async (req: Request, server) => {
        const url = new URL(req.url);
        const requestedUrl = url.pathname;

        if (!isProd && requestedUrl === '/__thane-browser-events') {
          if (server.upgrade(req)) {
            return undefined;
          }
          return new Response('WebSocket upgrade failed', { status: 400 });
        }

        const requestedPath = resolve(canonicalDistDir, '.' + requestedUrl);
        if (!requestedPath.startsWith(canonicalDistDir)) {
          return new Response('Forbidden', { status: 403 });
        }

        const indexPath = join(canonicalDistDir, 'index.html');
        const hasFileExtension = extname(requestedUrl).length > 0;

        try {
          const file = Bun.file(requestedPath);
          if (await file.exists()) {
            const stat = await file.stat();
            if (stat?.isFile()) {
              return compressAndRespond(
                requestedPath,
                req,
                getContentType(requestedUrl),
                'public, max-age=31536000, immutable',
              );
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
      websocket: {
        message: (_ws, rawMessage) => {
          try {
            const parsed = JSON.parse(rawMessage.toString()) as BrowserRelayMessage;
            this.logBrowserRelayMessage(parsed);
          } catch (error) {
            logger.verbose(
              `[browser] Failed to parse browser relay message: ${error instanceof Error ? error.message : error}`,
            );
          }
        },
      },
    };
  }

  start(port: number = this.serverPort): void {
    this.currentPort = port;

    try {
      this.server = Bun.serve(this.createServeOptions(port));

      if (!this.options.isProd) {
        console.info(consoleColors.cyan, 'Bun development mode enabled; Thane browser error relay active');
        console.info(consoleColors.cyan, `Watch terminal for ${BROWSER_ERROR_SENTINEL}`);
      }
      console.info(consoleColors.yellow, `Server running at ${this.server.url.href}`);
      console.info('');
      console.info('');
      this.serverStarted = true;

      if (this.autoOpen) {
        const url = this.server.url.href;
        // Cross-platform browser open — use spawn with arg array to avoid injection
        const { platform } = process;
        const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
        const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
        import('node:child_process')
          .then(({ spawn }) => {
            const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
            child.unref();
          })
          .catch(() => {});
      }
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
}
