/**
 * Post-Build Processor — HTTP dev server
 */

import { basename, join, extname, relative, resolve, sep } from 'node:path';
import type { Server } from 'bun';
import { consoleColors, ansi, getContentType, logger } from '../../utils/index.js';
import { compress } from './compression.js';
import type { HotUpdate } from '../../cli/hot-updates.js';
import { HOT_MODULE_PREFIX, HOT_PACKAGE_PREFIX } from '../component-precompiler/hot-modules.js';

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

/** The topic every page's browser-event socket subscribes to: `reload`, or a rebuild's hot updates as JSON */
const RELOAD_TOPIC = 'thane-reload';

/**
 * The file a request path points at inside `distDir`, or null when the path is malformed or
 * leaves the directory. A URL pathname is percent-encoded (`My%20Logo.png`); it is decoded
 * before it is resolved, so file names with spaces or non-ASCII characters are found, and the
 * containment check runs on the decoded path, so an encoded `..%2F` cannot slip past it.
 */
export const resolveRequestPath = (distDir: string, pathname: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const root = resolve(distDir);
  const requested = resolve(root, '.' + decoded);
  if (requested !== root && !requested.startsWith(root + sep)) return null;
  return requested;
};

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
  private readonly serverPort: number;
  private readonly serverHost: string;
  private readonly autoOpen: boolean;
  private readonly options: DevServerOptions;

  constructor(options: DevServerOptions) {
    this.options = options;
    this.serverPort = options.port ?? 4200;
    this.serverHost = options.host ?? 'localhost';
    this.autoOpen = options.open ?? false;
  }

  get isStarted(): boolean {
    return this.serverStarted;
  }

  /** Sends a rebuild's hot updates to every open page, which swaps the changed components (see runtime/hot.ts) */
  hotUpdate(updates: HotUpdate[]): void {
    if (!this.server || this.options.isProd) return;
    this.server.publish(RELOAD_TOPIC, JSON.stringify({ hot: updates }));
  }

  /** Reloads every page open on the development server (after a rebuild, or a changed asset or index.html) */
  reloadPages(): void {
    if (!this.server || this.options.isProd) {
      return;
    }

    this.server.publish(RELOAD_TOPIC, 'reload');
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

      return resolveRequestPath(this.options.distDir, parsed.pathname);
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
  // Components register for hot swapping (runtime/hot.ts); a hot update runs changed modules again, in
  // order, their imports read from the modules the page has loaded, and each one's new exports replace its
  // old ones for the modules run after it. False: the page reloads instead.
  window.__thaneHot = {};
  const applyHotUpdates = (updates) => {
    const modules = window.__thaneModules;
    if (!Array.isArray(updates) || !modules || updates.some((update) => !modules.has(update.key))) return false;
    try {
      for (const update of updates) {
        const require = (id) => {
          const key = id.startsWith('${HOT_PACKAGE_PREFIX}')
            ? 'pkg:' + id.slice(${HOT_PACKAGE_PREFIX.length})
            : id.slice(${HOT_MODULE_PREFIX.length});
          if (!modules.has(key)) throw new Error('not loaded in the page: ' + key);
          return modules.get(key);
        };
        const module = { exports: {} };
        new Function('require', 'module', 'exports', update.code)(require, module, module.exports);
        modules.set(update.key, module.exports);
      }
      return true;
    } catch (error) {
      console.error('[thane] a hot update failed, so the page reloads:', error);
      return false;
    }
  };
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
    socket.addEventListener('message', (event) => {
      if (event.data === 'reload') location.reload();
      else if (!applyHotUpdates(JSON.parse(event.data).hot)) location.reload();
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
      // Images, audio, video and woff fonts are compressed formats already
      const canCompress =
        useGzip &&
        !contentType.startsWith('image/') &&
        !contentType.startsWith('video/') &&
        !contentType.startsWith('audio/') &&
        !contentType.startsWith('font/woff');

      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
      };

      if (canCompress) {
        headers['Vary'] = 'Accept-Encoding';
        const raw = await Bun.file(filePath).bytes();
        const encoding = acceptEncoding.includes('br') ? 'br' : acceptEncoding.includes('gzip') ? 'gzip' : null;

        if (encoding) {
          headers['Content-Encoding'] = encoding;
          return new Response(await compress(raw, encoding, isProd), { headers });
        }
      }

      return new Response(Bun.file(filePath), { headers });
    };

    return {
      port,
      hostname: this.serverHost,
      // Production answers a failing request with a bare 500: Bun's development error page shows the
      // stack, which a served production build must not do
      ...(isProd
        ? {
            development: false,
            error: () => new Response('Internal Server Error', { status: 500 }),
          }
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

        const requestedPath = resolveRequestPath(canonicalDistDir, requestedUrl);
        if (requestedPath === null) {
          return new Response('Forbidden', { status: 403 });
        }

        const indexPath = join(canonicalDistDir, 'index.html');
        const hasFileExtension = extname(requestedUrl).length > 0;

        try {
          const file = Bun.file(requestedPath);
          if (await file.exists()) {
            const stat = await file.stat();
            if (stat?.isFile()) {
              // Development files are revalidated: an asset keeps its name when it is edited, and so
              // does every output file under --no-hash-file-names, and a reloaded page must see the change
              return await compressAndRespond(
                requestedPath,
                req,
                getContentType(requestedUrl),
                isProd ? 'public, max-age=31536000, immutable' : 'no-cache',
              );
            }
          }
        } catch {
          // Not a readable file: answered below like a missing one
        }

        // A static route's own page, which a production build writes with the route's head in it
        if (!hasFileExtension) {
          const routePage = join(requestedPath, 'index.html');
          if (await Bun.file(routePage).exists())
            return compressAndRespond(routePage, req, getContentType(routePage), 'no-cache');
        }

        // Anything else that is not a file: a missing asset, or a client route served by index.html (if there is one)
        return hasFileExtension || !(await Bun.file(indexPath).exists())
          ? new Response('Not Found', { status: 404 })
          : compressAndRespond(indexPath, req, getContentType(indexPath), 'no-cache');
      },
      websocket: {
        open: (ws) => {
          ws.subscribe(RELOAD_TOPIC);
        },
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
    try {
      this.server = Bun.serve(this.createServeOptions(port));

      if (!this.options.isProd) {
        console.info(
          consoleColors.cyan,
          'Development server: open pages reload after each rebuild; browser errors are relayed here',
        );
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
