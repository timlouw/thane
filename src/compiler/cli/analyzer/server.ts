/**
 * Thane Bundle Analyzer — Lightweight HTTP Server
 *
 * Serves the self-contained analyzer HTML and auto-opens the browser.
 * @internal
 */

import { consoleColors } from '../../utils/index.js';

export function startAnalyzerServer(html: string, port: number): void {
  try {
    const server = Bun.serve({
      port,
      fetch() {
        return new Response(html, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          },
        });
      },
    });

    const url = server.url.href;
    console.info('');
    console.info(consoleColors.green, '  🔍 Thane Bundle Analyzer is ready!');
    console.info(consoleColors.yellow, '  ' + url);
    console.info('');
    console.info(consoleColors.cyan, '  Press Ctrl+C to stop the server');
    console.info('');

    // Try to open browser automatically
    const plat = process.platform;
    const open = plat === 'win32' ? 'start' : plat === 'darwin' ? 'open' : 'xdg-open';
    try {
      Bun.spawn([open, url], { stdout: 'ignore', stderr: 'ignore' });
    } catch {
      /* user can open manually */
    }
  } catch (err: unknown) {
    const error = err as Error & { code?: string };
    if (error.code === 'EADDRINUSE') {
      console.warn(`  Port ${port} in use, trying ${port + 1}...`);
      startAnalyzerServer(html, port + 1);
    } else {
      throw err;
    }
  }
}
