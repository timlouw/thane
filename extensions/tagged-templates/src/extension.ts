import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { activateLinter, deactivateLinter } from './linter.js';

// ============================================================================
// Language ID → TextMate grammar scope name mapping
// ============================================================================

/**
 * Maps VS Code language IDs to their TextMate grammar scope names.
 * These are the scope names used by VS Code's built-in grammars and common
 * extensions. When a user configures a tag → language mapping, this table
 * resolves the language ID to the grammar include path.
 */
const LANGUAGE_SCOPES: Record<string, string> = {
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
// Grammar generation
// ============================================================================

/**
 * Escapes a tag name for use in a regex pattern.
 * Only word characters are expected, but escape just in case.
 */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Maps a VS Code language ID to the embedded block scope name used in
 * the grammar's `contentName`. This must match what's declared in
 * package.json `embeddedLanguages`.
 */
function embeddedBlockScope(languageId: string): string {
	// Map language IDs to the block scope keys used in package.json
	const scopeKey: Record<string, string> = {
		shellscript: 'shell',
		javascriptreact: 'javascript',
		typescriptreact: 'typescript',
	};
	return `meta.embedded.block.${scopeKey[languageId] ?? languageId}`;
}

interface TagMapping {
	tag: string;
	languageId: string;
	grammarScope: string;
	embeddedScope: string;
}

/**
 * Resolves user configuration into validated tag mappings.
 */
function resolveTagMappings(tags: Record<string, string>): TagMapping[] {
	const mappings: TagMapping[] = [];

	for (const [tag, languageId] of Object.entries(tags)) {
		const trimmedTag = tag.trim();
		const trimmedLang = languageId.trim().toLowerCase();

		if (!trimmedTag || !trimmedLang) {
			continue;
		}

		const grammarScope = LANGUAGE_SCOPES[trimmedLang];
		if (!grammarScope) {
			vscode.window.showWarningMessage(
				`Tagged Templates: Unknown language ID "${trimmedLang}" for tag "${trimmedTag}". ` +
				`Supported: ${Object.keys(LANGUAGE_SCOPES).join(', ')}`
			);
			continue;
		}

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
function generateGrammar(mappings: TagMapping[]): object {
	const injectionSelector = [
		'L:source.js -comment -(string -meta.embedded)',
		'L:source.jsx -comment -(string -meta.embedded)',
		'L:source.js.jsx -comment -(string -meta.embedded)',
		'L:source.ts -comment -(string -meta.embedded)',
		'L:source.tsx -comment -(string -meta.embedded)',
	].join(', ');

	const patterns: object[] = [];
	const repository: Record<string, object> = {};

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

/**
 * Generates the reinjection grammar that ensures ${...} expressions
 * inside embedded blocks get proper TypeScript highlighting.
 */
function generateReinjectionGrammar(mappings: TagMapping[]): object {
	const embeddedScopes = mappings.map(m => m.embeddedScope);

	// Build the injection selector: inject into all embedded block scopes
	// across all JS/TS source types
	const sourceScopes = ['source.js', 'source.jsx', 'source.js.jsx', 'source.ts', 'source.tsx'];
	const selectorParts: string[] = [];

	for (const source of sourceScopes) {
		if (embeddedScopes.length > 0) {
			const embedded = embeddedScopes.join(`, ${source} `);
			selectorParts.push(`L:${source} ${embedded}`);
		}
	}

	return {
		fileTypes: [],
		injectionSelector: selectorParts.join(', '),
		patterns: [
			{ include: 'source.ts#template-substitution-element' },
		],
		scopeName: 'inline.tagged-templates.reinjection',
	};
}

// ============================================================================
// File I/O
// ============================================================================

function getSyntaxesDir(context: vscode.ExtensionContext): string {
	return path.join(context.extensionPath, 'syntaxes');
}

function getGrammarPath(context: vscode.ExtensionContext): string {
	return path.join(getSyntaxesDir(context), 'template-tags.json');
}

function getReinjectionPath(context: vscode.ExtensionContext): string {
	return path.join(getSyntaxesDir(context), 'template-reinjection.json');
}

/**
 * Writes a grammar file only if the content has actually changed.
 * Returns true if the file was written (content differed).
 */
function writeIfChanged(filePath: string, content: string): boolean {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	try {
		const existing = fs.readFileSync(filePath, 'utf-8');
		if (existing === content) {
			return false;
		}
	} catch {
		// File doesn't exist yet
	}

	fs.writeFileSync(filePath, content, 'utf-8');
	return true;
}

// ============================================================================
// Extension lifecycle
// ============================================================================

function getTagConfig(): Record<string, string> {
	const config = vscode.workspace.getConfiguration('tagged-templates');
	return config.get<Record<string, string>>('tags') ?? { html: 'html', css: 'css' };
}

function regenerateGrammars(context: vscode.ExtensionContext): boolean {
	const tags = getTagConfig();
	const mappings = resolveTagMappings(tags);

	if (mappings.length === 0) {
		vscode.window.showWarningMessage(
			'Tagged Templates: No valid tag mappings configured. Syntax highlighting will be inactive.'
		);
		return false;
	}

	const grammar = generateGrammar(mappings);
	const reinjection = generateReinjectionGrammar(mappings);

	const grammarJson = JSON.stringify(grammar, null, 2) + '\n';
	const reinjectionJson = JSON.stringify(reinjection, null, 2) + '\n';

	const grammarChanged = writeIfChanged(getGrammarPath(context), grammarJson);
	const reinjectionChanged = writeIfChanged(getReinjectionPath(context), reinjectionJson);

	return grammarChanged || reinjectionChanged;
}

function promptReload(message: string): void {
	vscode.window
		.showInformationMessage(message, 'Reload Window')
		.then(selection => {
			if (selection === 'Reload Window') {
				vscode.commands.executeCommand('workbench.action.reloadWindow');
			}
		});
}

export function activate(context: vscode.ExtensionContext): void {
	// Generate grammars on first activation
	const changed = regenerateGrammars(context);
	if (changed) {
		promptReload(
			'Tagged Templates: Grammar files have been updated. Reload the window to apply syntax highlighting.'
		);
	}

	// Activate the Thane linter (shared rules from the compiler)
	const linterEnabled = vscode.workspace
		.getConfiguration('tagged-templates')
		.get<boolean>('linter.enabled', true);

	if (linterEnabled) {
		activateLinter(context);
	}

	// Watch for configuration changes
	const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('tagged-templates.tags')) {
			const changed = regenerateGrammars(context);
			if (changed) {
				promptReload(
					'Tagged Templates: Tag configuration changed. Reload the window to apply the new syntax highlighting.'
				);
			}
		}
	});

	context.subscriptions.push(configWatcher);
}

export function deactivate(): void {
	deactivateLinter();
}
