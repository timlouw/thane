/**
 * esbuild bundle script for the Tagged Template Literals extension.
 *
 * Builds two bundles:
 *   1. dist/extension.js       — the VS Code extension (CJS)
 *   2. dist/ts-plugin/index.js — TypeScript server plugin (CJS)
 *
 * External modules:
 *   - `vscode`      — provided by VS Code at runtime
 *   - `typescript`  — provided by tsserver at runtime (for the plugin)
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
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
	],
};

/** @type {import('esbuild').BuildOptions} */
const tsPluginOptions = {
	entryPoints: ['src/ts-plugin.ts'],
	bundle: true,
	outfile: 'dist/ts-plugin/index.js',
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	sourcemap: false,
	minify: false,
	external: [
		'typescript',  // Provided by tsserver at runtime
	],
};

/**
 * Writes a package.json into dist/ts-plugin/ and copies the plugin into
 * node_modules/thane-ts-plugin/ so tsserver can resolve it by package name.
 * (tsserver rejects relative paths — only bare package names are allowed.)
 */
function installPluginToNodeModules() {
	const pluginDir = path.resolve('dist/ts-plugin');
	const pkg = JSON.stringify({
		name: 'thane-ts-plugin',
		version: '0.1.0',
		main: './index.js',
	}, null, 2);
	fs.writeFileSync(path.join(pluginDir, 'package.json'), pkg);

	// Also install into node_modules so tsserver can resolve by package name
	const nmDir = path.resolve('node_modules/thane-ts-plugin');
	fs.mkdirSync(nmDir, { recursive: true });
	fs.copyFileSync(path.join(pluginDir, 'index.js'), path.join(nmDir, 'index.js'));
	fs.writeFileSync(path.join(nmDir, 'package.json'), pkg);
}

if (isWatch) {
	const ctx = await esbuild.context(extensionOptions);
	await ctx.watch();
	await esbuild.build(tsPluginOptions);
	installPluginToNodeModules();
	console.log('[esbuild] Watching for changes...');
} else {
	await Promise.all([
		esbuild.build(extensionOptions),
		esbuild.build(tsPluginOptions),
	]);
	installPluginToNodeModules();
	console.log('[esbuild] Build complete → dist/extension.js + dist/ts-plugin/index.js');
}
