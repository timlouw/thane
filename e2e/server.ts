import { serve } from 'bun';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function createHandler(root: string) {
  return async (req: Request) => {
    const pathname = new URL(req.url).pathname;
    const clean = pathname === '/' ? '/index.html' : pathname;
    const filePath = resolve(root, '.' + clean);

    // Prevent path traversal — resolved path must stay within root
    if (!filePath.startsWith(root)) {
      return new Response('Forbidden', { status: 403 });
    }

    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback — return index.html for unmatched routes
    return new Response(Bun.file(resolve(root, 'index.html')));
  };
}

const contractRoot = resolve(process.cwd(), 'dist', 'e2e');
const routerRoot = resolve(process.cwd(), 'dist', 'e2e-router');

if (!existsSync(contractRoot)) {
  throw new Error(`Contract app build output missing at ${contractRoot}. Run e2e:build first.`);
}

if (!existsSync(routerRoot)) {
  throw new Error(`Router app build output missing at ${routerRoot}. Run e2e:build first.`);
}

serve({
  port: 4173,
  development: false,
  routes: { '/*': createHandler(contractRoot) },
});

serve({
  port: 4174,
  development: false,
  routes: { '/*': createHandler(routerRoot) },
});

console.log('E2E servers running on http://localhost:4173 (contract) and http://localhost:4174 (router)');
