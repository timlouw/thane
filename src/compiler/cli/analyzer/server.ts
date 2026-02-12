/**
 * Thane Bundle Analyzer — Lightweight HTTP Server
 *
 * Serves the self-contained analyzer HTML and auto-opens the browser.
 * @internal
 */

import http from 'http';
import { consoleColors } from '../../utils/index.js';

export function startAnalyzerServer(html: string, port: number): void {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(html);
  });

  server.on('error', (err: Error & { code?: string }) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`  Port ${port} in use, trying ${port + 1}...`);
      startAnalyzerServer(html, port + 1);
    } else {
      throw err;
    }
  });

  server.listen(port, () => {
    const url = 'http://localhost:' + port + '/';
    console.info('');
    console.info(consoleColors.green, '  🔍 Thane Bundle Analyzer is ready!');
    console.info(consoleColors.yellow, '  ' + url);
    console.info('');
    console.info(consoleColors.cyan, '  Press Ctrl+C to stop the server');
    console.info('');

    // Try to open browser automatically
    const plat = process.platform;
    const open = plat === 'win32' ? 'start' : plat === 'darwin' ? 'open' : 'xdg-open';
    import('child_process')
      .then((cp) => { cp.exec(open + ' ' + url); })
      .catch(() => { /* user can open manually */ });
  });
}
