/**
 * Pure grammar-generation utilities for the Tagged Templates extension.
 *
 * These helpers are free of any VS Code dependency so they can be:
 *   1. Unit-tested with `bun test` directly (no extension host needed).
 *   2. Imported by extension.ts at runtime inside VS Code.
 *
 * Single source of truth — do NOT duplicate these functions elsewhere.
 */

// ============================================================================
// Language ID → TextMate grammar scope name mapping
// ============================================================================

/**
 * Maps VS Code language IDs to their TextMate grammar scope names.
 * These are the scope names used by VS Code's built-in grammars and common
 * extensions. When a user configures a tag → language mapping, this table
 * resolves the language ID to the grammar include path.
 */
export const LANGUAGE_SCOPES: Record<string, string> = {
	// Markup / template
	html: 'text.html.basic',
	xml: 'text.xml',
	markdown: 'text.html.markdown',
	pug: 'text.pug',

	// Stylesheets
	css: 'source.css',
	scss: 'source.css.scss',
	less: 'source.css.less',

	// JavaScript / TypeScript
	javascript: 'source.js',
	typescript: 'source.ts',
	typescriptreact: 'source.tsx',
	javascriptreact: 'source.jsx',

	// Data formats
	json: 'source.json',
	yaml: 'source.yaml',
	toml: 'source.toml',
	ini: 'source.ini',

	// Query languages
	sql: 'source.sql',
	graphql: 'source.graphql',

	// Systems languages
	c: 'source.c',
	cpp: 'source.cpp',
	csharp: 'source.cs',
	java: 'source.java',
	go: 'source.go',
	rust: 'source.rust',
	swift: 'source.swift',
	kotlin: 'source.kotlin',
	dart: 'source.dart',

	// Scripting
	python: 'source.python',
	ruby: 'source.ruby',
	php: 'text.html.php',
	lua: 'source.lua',
	perl: 'source.perl',
	r: 'source.r',
	shellscript: 'source.shell',
	powershell: 'source.powershell',

	// Shaders
	glsl: 'source.glsl',

	// Config / infra
	dockerfile: 'source.dockerfile',
	makefile: 'source.makefile',

	// Other
	regex: 'source.js.regexp',
};

// ============================================================================
// Grammar generation helpers
// ============================================================================

/**
 * Escapes a string for safe use inside a RegExp pattern.
 */
export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Maps a VS Code language ID to the embedded block scope name used in
 * the grammar's `contentName`. Must match what is declared in
 * package.json `embeddedLanguages`.
 */
export function embeddedBlockScope(languageId: string): string {
	const scopeKey: Record<string, string> = {
		shellscript: 'shell',
		javascriptreact: 'javascript',
		typescriptreact: 'typescript',
	};
	return `meta.embedded.block.${scopeKey[languageId] ?? languageId}`;
}

export interface TagMapping {
	tag: string;
	languageId: string;
	grammarScope: string;
	embeddedScope: string;
}

/**
 * Resolves user configuration into validated tag mappings.
 *
 * Returns only mappings whose language ID is present in LANGUAGE_SCOPES.
 * Unrecognised languages are silently skipped — the caller can add UI
 * warnings if desired (e.g. `vscode.window.showWarningMessage`).
 */
export function resolveTagMappings(tags: Record<string, string>): TagMapping[] {
	const mappings: TagMapping[] = [];

	for (const [tag, languageId] of Object.entries(tags)) {
		const trimmedTag = tag.trim();
		const trimmedLang = languageId.trim().toLowerCase();

		if (!trimmedTag || !trimmedLang) continue;

		const grammarScope = LANGUAGE_SCOPES[trimmedLang];
		if (!grammarScope) continue;

		mappings.push({
			tag: trimmedTag,
			languageId: trimmedLang,
			grammarScope,
			embeddedScope: embeddedBlockScope(trimmedLang),
		});
	}

	return mappings;
}

/**
 * Generates the TextMate injection grammar JSON for the given tag mappings.
 */
export function generateGrammar(mappings: TagMapping[]): {
	fileTypes: string[];
	injectionSelector: string;
	patterns: object[];
	repository: Record<string, any>;
	scopeName: string;
} {
	const injectionSelector = [
		'L:source.js -comment -(string -meta.embedded)',
		'L:source.jsx -comment -(string -meta.embedded)',
		'L:source.js.jsx -comment -(string -meta.embedded)',
		'L:source.ts -comment -(string -meta.embedded)',
		'L:source.tsx -comment -(string -meta.embedded)',
	].join(', ');

	const patterns: object[] = [];
	const repository: Record<string, any> = {};

	for (const mapping of mappings) {
		const key = `tag-${mapping.tag}`;
		patterns.push({ include: `#${key}` });

		repository[key] = {
			name: `string.js.taggedTemplate.taggedTemplates.${mapping.languageId}`,
			contentName: mapping.embeddedScope,
			begin: `(\\b${escapeRegex(mapping.tag)}\\s*)(\`)`,
			beginCaptures: {
				'1': { name: 'entity.name.function.tagged-template.js' },
				'2': { name: 'punctuation.definition.string.template.begin.js' },
			},
			end: '(`)',
			endCaptures: {
				'0': { name: 'string.js' },
				'1': { name: 'punctuation.definition.string.template.end.js' },
			},
			patterns: [
				{ include: 'source.ts#template-substitution-element' },
				{ include: mapping.grammarScope },
			],
		};
	}

	return {
		fileTypes: [],
		injectionSelector,
		patterns,
		repository,
		scopeName: 'inline.tagged-templates',
	};
}
