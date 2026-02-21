#!/usr/bin/env bun

/**
 * Thane CLI entry point
 *
 * The Bun runtime check runs before any imports so that users who
 * accidentally invoke the CLI via Node.js get a clear, actionable
 * error instead of a cryptic module-resolution failure.
 */

if (typeof globalThis.Bun === 'undefined') {
  console.error(
    'Error: Thane CLI requires the Bun runtime.\n\n' +
    '  Install Bun: https://bun.sh\n' +
    '    curl -fsSL https://bun.sh/install | bash   (macOS/Linux)\n' +
    '    powershell -c "irm bun.sh/install.ps1 | iex"  (Windows)\n\n' +
    '  Then run: bun thane <command>\n',
  );
  process.exit(1);
}

const { cliMain } = await import('./cli-common.js');

cliMain().catch((err: unknown) => {
  console.error('CLI Error:', err);
  process.exit(1);
});
