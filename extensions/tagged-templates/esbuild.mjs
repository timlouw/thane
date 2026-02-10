/**
 * esbuild bundle script for the Tagged Template Literals extension.
 *
 * Bundles the extension source AND the imported compiler lint rules into
 * a single CJS file at dist/extension.js.  This handles:
 *
 *   - ESM → CJS conversion (the compiler source is ESM, VS Code needs CJS)
 *   - .js extension imports resolving to .ts source files
 *   - Tree-shaking: only the rules + their tiny dependency graph are included
 *
 * External modules (not bundled):
 *   - `vscode`      — provided by the VS Code runtime
 *   - `typescript`   — shipped as a production dependency in the .vsix
 */

import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	outfile: 'dist/extension.js',
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	sourcemap: true,
	minify: false,
	external: [
		'vscode',      // Provided by VS Code at runtime
		'typescript',  // Shipped as a production dependency
	],
};

if (isWatch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
	console.log('[esbuild] Watching for changes...');
} else {
	await esbuild.build(options);
	console.log('[esbuild] Build complete → dist/extension.js');
}
