/**
 * Runs a Thane CLI command in every app folder that owns a tsconfig.json:
 * the e2e apps, the benchmark harness, the benchmark example and the Thane store example.
 *
 * Usage: bun scripts/apps.ts <types|typecheck>
 */
import { $ } from 'bun';
import { resolve } from 'node:path';

const command = process.argv[2];
if (command !== 'types' && command !== 'typecheck') {
  console.error('Usage: bun scripts/apps.ts <types|typecheck>');
  process.exit(1);
}

const repoRoot = resolve(import.meta.dir, '..');
const cli = resolve(repoRoot, 'src/compiler/cli/thane.ts');
const apps = ['e2e', 'bench', 'example-apps/benchmark', 'example-apps/store/thane'];

for (const app of apps) {
  console.log(`\n[${command}] ${app}`);
  await $`bun ${cli} ${command}`.cwd(resolve(repoRoot, app));
}
