import { serve } from 'bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'dist', 'e2e');
const port = Number(process.env.PORT || 4173);

if (!existsSync(root)) {
  throw new Error(`Build output missing at ${root}. Run e2e build first.`);
}

serve({
  port,
  development: false,
  routes: {
    '/*': async req => {
      const pathname = new URL(req.url).pathname;
      const clean = pathname === '/' ? '/index.html' : pathname;
      const filePath = join(root, clean);
      const file = Bun.file(filePath);

      if (await file.exists()) {
        return new Response(file);
      }

      return new Response(Bun.file(join(root, 'index.html')));
    },
  },
});

console.log(`Contract app server running on http://localhost:${port}`);
