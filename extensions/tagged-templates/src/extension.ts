import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { activateLinter, deactivateLinter } from './linter.js';
import {
  LANGUAGE_SCOPES,
  escapeRegex,
  embeddedBlockScope,
  resolveTagMappings as resolveTagMappingsCore,
  generateGrammar,
  type TagMapping,
} from './grammar-utils.js';

// ============================================================================
// Grammar generation — re-exports + VS Code-aware wrappers
// ============================================================================

/**
 * Wraps the core resolveTagMappings to add VS Code UI warnings for
 * unrecognised language IDs.
 */
function resolveTagMappings(tags: Record<string, string>): TagMapping[] {
  // Detect unknown languages before delegating to the core resolver
  for (const [tag, languageId] of Object.entries(tags)) {
    const trimmedTag = tag.trim();
    const trimmedLang = languageId.trim().toLowerCase();
    if (!trimmedTag || !trimmedLang) continue;
    if (!LANGUAGE_SCOPES[trimmedLang]) {
      vscode.window.showWarningMessage(
        `Tagged Templates: Unknown language ID "${trimmedLang}" for tag "${trimmedTag}". ` +
          `Supported: ${Object.keys(LANGUAGE_SCOPES).join(', ')}`,
      );
    }
  }
  return resolveTagMappingsCore(tags);
}

/**
 * Generates the reinjection grammar that ensures ${...} expressions
 * inside embedded blocks get proper TypeScript highlighting.
 */
function generateReinjectionGrammar(mappings: TagMapping[]): object {
  const embeddedScopes = mappings.map((m) => m.embeddedScope);

  // Build the injection selector: inject into all embedded block scopes
  // across all JS/TS source types.
  // IMPORTANT: every selector part needs the L: prefix for left-injection
  // priority, so ${...} expressions get TypeScript scoping over the
  // embedded language (HTML, CSS, etc.).
  const sourceScopes = ['source.js', 'source.jsx', 'source.js.jsx', 'source.ts', 'source.tsx'];
  const selectorParts: string[] = [];

  for (const source of sourceScopes) {
    for (const scope of embeddedScopes) {
      selectorParts.push(`L:${source} ${scope}`);
    }
  }

  return {
    fileTypes: [],
    injectionSelector: selectorParts.join(', '),
    patterns: [{ include: 'source.ts#template-substitution-element' }],
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
// HTML Autocomplete inside html`` tagged templates
// ============================================================================

/**
 * A set of common HTML elements for autocomplete inside html`` templates.
 */
const HTML_ELEMENTS = [
  'div',
  'span',
  'p',
  'a',
  'button',
  'input',
  'form',
  'label',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
  'section',
  'article',
  'nav',
  'header',
  'footer',
  'main',
  'aside',
  'img',
  'video',
  'audio',
  'canvas',
  'svg',
  'select',
  'option',
  'textarea',
  'details',
  'summary',
  'dialog',
  'slot',
  'template',
  'style',
  'script',
  'link',
  'meta',
  'br',
  'hr',
  'pre',
  'code',
  'blockquote',
  'strong',
  'em',
];

/**
 * Common HTML attributes (global + form/input).
 */
const HTML_ATTRIBUTES = [
  'id',
  'class',
  'style',
  'title',
  'hidden',
  'tabindex',
  'role',
  'aria-label',
  'aria-hidden',
  'aria-disabled',
  'aria-expanded',
  'data-',
  'src',
  'href',
  'alt',
  'type',
  'name',
  'value',
  'placeholder',
  'disabled',
  'checked',
  'readonly',
  'required',
  'autofocus',
  'min',
  'max',
  'step',
  'pattern',
  'action',
  'method',
  'target',
  'width',
  'height',
  'for',
  'rel',
];

/**
 * Thane-specific directives and binding syntax.
 */
const THANE_DIRECTIVES = [
  { label: '@click', detail: 'Thane click event binding' },
  { label: '@input', detail: 'Thane input event binding' },
  { label: '@change', detail: 'Thane change event binding' },
  { label: '@submit', detail: 'Thane submit event binding' },
  { label: '@keydown', detail: 'Thane keydown event binding' },
  { label: '@keyup', detail: 'Thane keyup event binding' },
  { label: '@focus', detail: 'Thane focus event binding' },
  { label: '@blur', detail: 'Thane blur event binding' },
  { label: '@mouseenter', detail: 'Thane mouseenter event binding' },
  { label: '@mouseleave', detail: 'Thane mouseleave event binding' },
];

/**
 * Returns true if the cursor position is inside a tagged template literal
 * whose tag matches the given name (e.g. 'html' or 'css').
 */
function isInsideTaggedTemplate(document: vscode.TextDocument, position: vscode.Position, tagName: string): boolean {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Walk backward from cursor to find the nearest backtick-start of a tagged template
  // We look for `html\s*\`` pattern before our position.
  let i = offset - 1;
  let backtickDepth = 0;

  while (i >= 0) {
    const ch = text[i];
    if (ch === '`') {
      backtickDepth++;
      if (backtickDepth % 2 === 1) {
        // This backtick might be the opening of a tagged template
        // Check if preceded by the target tag
        const before = text.substring(Math.max(0, i - 10), i).trimEnd();
        if (before.endsWith(tagName)) {
          return true;
        }
        // Also check if we're in a nested template expression ${...}
        // In that case, continue searching
      }
    } else if (ch === '$' && i + 1 < text.length && text[i + 1] === '{') {
      // Template expression start — adjust depth
    }
    i--;
  }

  // Simple fallback: use regex on the line context
  const textBefore = text.substring(0, offset);
  // Find last tag` before offset, then check if there's a matching close `
  const lastTag = textBefore.lastIndexOf(tagName + '`');
  if (lastTag === -1) return false;

  const afterTag = text.substring(lastTag + tagName.length + 1);
  // Count backticks to determine if we're still inside
  let depth = 0;
  for (let j = 0; j < offset - (lastTag + tagName.length + 1); j++) {
    if (afterTag[j] === '`' && (j === 0 || afterTag[j - 1] !== '\\')) {
      depth++;
    }
  }
  // If depth is even, we're inside the template (haven't hit the closing backtick)
  return depth % 2 === 0;
}

/**
 * CompletionItemProvider for html`` tagged template literals.
 *
 * Provides:
 * - HTML element names (after `<`)
 * - HTML attributes and Thane directives (after space inside a tag)
 */
class HtmlTemplateCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    if (!isInsideTaggedTemplate(document, position, 'html')) {
      return undefined;
    }

    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.substring(0, position.character);

    // After `<` — suggest HTML elements
    if (textBeforeCursor.match(/<\w*$/)) {
      return HTML_ELEMENTS.map((el) => {
        const item = new vscode.CompletionItem(el, vscode.CompletionItemKind.Property);
        item.detail = `HTML <${el}>`;
        item.insertText = new vscode.SnippetString(`${el}$1>$0</${el}>`);
        return item;
      });
    }

    // Inside an opening tag (after a space) — suggest attributes and directives
    if (textBeforeCursor.match(/<\w+[^>]*\s+[\w@-]*$/)) {
      const attrs = HTML_ATTRIBUTES.map((attr) => {
        const item = new vscode.CompletionItem(attr, vscode.CompletionItemKind.Field);
        item.detail = 'HTML attribute';
        if (attr.endsWith('-')) {
          item.insertText = new vscode.SnippetString(`${attr}$1="$2"`);
        } else {
          item.insertText = new vscode.SnippetString(`${attr}="$1"`);
        }
        return item;
      });

      const directives = THANE_DIRECTIVES.map((d) => {
        const item = new vscode.CompletionItem(d.label, vscode.CompletionItemKind.Event);
        item.detail = d.detail;
        item.insertText = new vscode.SnippetString(`${d.label}=\${$1}`);
        return item;
      });

      return [...attrs, ...directives];
    }

    return undefined;
  }
}

// ============================================================================
// CSS Autocomplete inside css`` tagged templates
// ============================================================================

/**
 * Common CSS properties for autocomplete inside css`` templates.
 */
const CSS_PROPERTIES = [
  // Layout & Box Model
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'float',
  'clear',
  'overflow',
  'overflow-x',
  'overflow-y',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'box-sizing',
  'vertical-align',

  // Flexbox
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-flow',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-self',
  'align-content',
  'gap',
  'row-gap',
  'column-gap',
  'order',

  // Grid
  'grid',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-column',
  'grid-row',
  'grid-area',
  'grid-gap',
  'grid-auto-flow',
  'grid-auto-columns',
  'grid-auto-rows',
  'place-items',
  'place-content',
  'place-self',

  // Typography
  'color',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-decoration',
  'text-transform',
  'text-indent',
  'text-overflow',
  'white-space',
  'word-break',
  'word-wrap',
  'overflow-wrap',

  // Background
  'background',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'background-attachment',
  'background-clip',

  // Border
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'border-collapse',
  'border-spacing',

  // Effects
  'opacity',
  'box-shadow',
  'text-shadow',
  'outline',
  'outline-offset',
  'visibility',
  'cursor',
  'pointer-events',
  'user-select',
  'filter',
  'backdrop-filter',
  'mix-blend-mode',

  // Transforms & Animation
  'transform',
  'transform-origin',
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'transition-delay',
  'animation',
  'animation-name',
  'animation-duration',
  'animation-timing-function',
  'animation-delay',
  'animation-iteration-count',
  'animation-direction',
  'animation-fill-mode',
  'animation-play-state',

  // Misc
  'content',
  'list-style',
  'list-style-type',
  'table-layout',
  'resize',
  'appearance',
  'scroll-behavior',
  'object-fit',
  'object-position',
  'aspect-ratio',
  'container-type',
  'container-name',
];

/**
 * Common CSS value keywords mapped by property category for richer autocomplete.
 */
const CSS_VALUE_MAP: Record<string, string[]> = {
  'display': ['none', 'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents'],
  'position': ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
  'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'justify-content': ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'],
  'align-items': ['flex-start', 'flex-end', 'center', 'baseline', 'stretch'],
  'align-self': ['auto', 'flex-start', 'flex-end', 'center', 'baseline', 'stretch'],
  'align-content': ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'stretch'],
  'overflow': ['visible', 'hidden', 'scroll', 'auto', 'clip'],
  'overflow-x': ['visible', 'hidden', 'scroll', 'auto', 'clip'],
  'overflow-y': ['visible', 'hidden', 'scroll', 'auto', 'clip'],
  'text-align': ['left', 'right', 'center', 'justify', 'start', 'end'],
  'text-decoration': ['none', 'underline', 'overline', 'line-through'],
  'text-transform': ['none', 'capitalize', 'uppercase', 'lowercase'],
  'text-overflow': ['clip', 'ellipsis'],
  'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'],
  'font-weight': ['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
  'font-style': ['normal', 'italic', 'oblique'],
  'cursor': [
    'auto',
    'default',
    'pointer',
    'move',
    'text',
    'wait',
    'help',
    'not-allowed',
    'crosshair',
    'grab',
    'grabbing',
  ],
  'visibility': ['visible', 'hidden', 'collapse'],
  'box-sizing': ['content-box', 'border-box'],
  'border-style': ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'],
  'background-size': ['auto', 'cover', 'contain'],
  'background-repeat': ['repeat', 'repeat-x', 'repeat-y', 'no-repeat', 'space', 'round'],
  'background-position': ['top', 'right', 'bottom', 'left', 'center'],
  'background-attachment': ['scroll', 'fixed', 'local'],
  'background-clip': ['border-box', 'padding-box', 'content-box', 'text'],
  'object-fit': ['fill', 'contain', 'cover', 'none', 'scale-down'],
  'resize': ['none', 'both', 'horizontal', 'vertical'],
  'list-style-type': [
    'none',
    'disc',
    'circle',
    'square',
    'decimal',
    'lower-alpha',
    'upper-alpha',
    'lower-roman',
    'upper-roman',
  ],
  'pointer-events': ['auto', 'none'],
  'user-select': ['auto', 'none', 'text', 'all'],
  'scroll-behavior': ['auto', 'smooth'],
  'grid-auto-flow': ['row', 'column', 'dense', 'row dense', 'column dense'],
  'animation-direction': ['normal', 'reverse', 'alternate', 'alternate-reverse'],
  'animation-fill-mode': ['none', 'forwards', 'backwards', 'both'],
  'animation-play-state': ['running', 'paused'],
  'word-break': ['normal', 'break-all', 'keep-all', 'break-word'],
  'float': ['none', 'left', 'right', 'inline-start', 'inline-end'],
  'clear': ['none', 'left', 'right', 'both', 'inline-start', 'inline-end'],
  'appearance': ['none', 'auto'],
};

/**
 * Common CSS pseudo-selectors.
 */
const CSS_PSEUDO_SELECTORS = [
  ':hover',
  ':focus',
  ':active',
  ':visited',
  ':first-child',
  ':last-child',
  ':nth-child()',
  ':nth-of-type()',
  ':first-of-type',
  ':last-of-type',
  ':not()',
  ':is()',
  ':where()',
  ':has()',
  ':focus-visible',
  ':focus-within',
  ':empty',
  ':disabled',
  ':enabled',
  ':checked',
  ':required',
  ':optional',
  ':valid',
  ':invalid',
  ':placeholder-shown',
  ':read-only',
  ':read-write',
  '::before',
  '::after',
  '::placeholder',
  '::selection',
  '::first-line',
  '::first-letter',
  '::marker',
  '::backdrop',
];

/**
 * CompletionItemProvider for css`` tagged template literals.
 *
 * Provides:
 * - CSS property names (at line start or after `{` / `;`)
 * - CSS values (after `:` in a property declaration)
 * - Pseudo-selectors (after `:` or `::` outside a declaration block)
 */
class CssTemplateCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    if (!isInsideTaggedTemplate(document, position, 'css')) {
      return undefined;
    }

    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.substring(0, position.character);

    // After `:` or `::` at a selector boundary — suggest pseudo-selectors
    // We detect selector context by checking whether we're NOT inside a `{…}` block
    // on this line (no unmatched `{` before cursor without `}` after it on same line).
    const selectorPseudo = textBeforeCursor.match(/::?\s*[\w-]*$/);
    if (selectorPseudo) {
      // Only offer pseudo-selectors if this looks like a selector line (no `;`, has `{` balance = 0)
      const trimmed = textBeforeCursor.trimStart();
      const hasPropertyColon = /^\s*[\w-]+\s*:/.test(trimmed) && !trimmed.includes('{');
      if (!hasPropertyColon) {
        return CSS_PSEUDO_SELECTORS.map((pseudo) => {
          const item = new vscode.CompletionItem(pseudo, vscode.CompletionItemKind.Keyword);
          item.detail = 'CSS pseudo-selector';
          if (pseudo.endsWith('()')) {
            const name = pseudo.slice(0, -1);
            item.insertText = new vscode.SnippetString(`${name}$1)`);
          }
          return item;
        });
      }
    }

    // After `: ` inside a property — suggest values for that property
    const propertyValueMatch = textBeforeCursor.match(/^\s*([\w-]+)\s*:\s*([\w-]*)$/);
    if (propertyValueMatch) {
      const property = propertyValueMatch[1]!;
      const values = CSS_VALUE_MAP[property];
      if (values) {
        return values.map((val) => {
          const item = new vscode.CompletionItem(val, vscode.CompletionItemKind.Value);
          item.detail = `${property} value`;
          item.insertText = new vscode.SnippetString(`${val};$0`);
          return item;
        });
      }
      // Fallback: generic value keywords
      return ['inherit', 'initial', 'unset', 'revert'].map((val) => {
        const item = new vscode.CompletionItem(val, vscode.CompletionItemKind.Value);
        item.detail = 'CSS global value';
        item.insertText = new vscode.SnippetString(`${val};$0`);
        return item;
      });
    }

    // At line start or after `{` / `;` — suggest CSS property names
    if (textBeforeCursor.match(/^\s*[\w-]*$/) || textBeforeCursor.match(/[{;]\s*[\w-]*$/)) {
      return CSS_PROPERTIES.map((prop) => {
        const item = new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property);
        item.detail = 'CSS property';
        item.insertText = new vscode.SnippetString(`${prop}: $1;$0`);
        return item;
      });
    }

    return undefined;
  }
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
      'Tagged Templates: No valid tag mappings configured. Syntax highlighting will be inactive.',
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
  vscode.window.showInformationMessage(message, 'Reload Window').then((selection) => {
    if (selection === 'Reload Window') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  });
}

// Output channel for extension diagnostics (visible in Output panel dropdown)
let outputChannel: vscode.OutputChannel;

function log(msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
  outputChannel.appendLine(`[${ts}] ${msg}`);
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Tagged Templates');
  context.subscriptions.push(outputChannel);
  log('Extension activating...');
  log(`Extension path: ${context.extensionPath}`);

  // Verify ts-plugin is in node_modules
  const pluginPath = path.join(context.extensionPath, 'node_modules', 'thane-ts-plugin', 'index.js');
  const pluginExists = fs.existsSync(pluginPath);
  log(`TS plugin at ${pluginPath}: ${pluginExists ? 'FOUND' : 'MISSING'}`);
  if (!pluginExists) {
    log('WARNING: thane-ts-plugin not found! Completion filtering inside ${} will not work.');
    vscode.window.showWarningMessage(
      'Tagged Templates: thane-ts-plugin not found in node_modules. Completion filtering inside ${} will not work.',
    );
  }

  // Generate grammars on first activation
  const tags = getTagConfig();
  log(`Tag config: ${JSON.stringify(tags)}`);
  const changed = regenerateGrammars(context);
  log(`Grammars regenerated: ${changed ? 'YES (files changed)' : 'NO (unchanged)'}`);
  if (changed) {
    promptReload('Tagged Templates: Grammar files have been updated. Reload the window to apply syntax highlighting.');
  }

  // Activate the Thane linter (shared rules from the compiler)
  const linterEnabled = vscode.workspace.getConfiguration('tagged-templates').get<boolean>('linter.enabled', true);

  if (linterEnabled) {
    activateLinter(context);
  }

  // Register HTML autocomplete inside html`` tagged templates
  const htmlCompletionProvider = vscode.languages.registerCompletionItemProvider(
    [
      { language: 'typescript', scheme: 'file' },
      { language: 'typescriptreact', scheme: 'file' },
      { language: 'javascript', scheme: 'file' },
      { language: 'javascriptreact', scheme: 'file' },
    ],
    new HtmlTemplateCompletionProvider(),
    '<',
    ' ',
    '@',
  );
  context.subscriptions.push(htmlCompletionProvider);

  // Register CSS autocomplete inside css`` tagged templates
  const cssCompletionProvider = vscode.languages.registerCompletionItemProvider(
    [
      { language: 'typescript', scheme: 'file' },
      { language: 'typescriptreact', scheme: 'file' },
      { language: 'javascript', scheme: 'file' },
      { language: 'javascriptreact', scheme: 'file' },
    ],
    new CssTemplateCompletionProvider(),
    ':',
    ' ',
    ';',
  );
  context.subscriptions.push(cssCompletionProvider);

  // Watch for configuration changes
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('tagged-templates.tags')) {
      const changed = regenerateGrammars(context);
      if (changed) {
        promptReload(
          'Tagged Templates: Tag configuration changed. Reload the window to apply the new syntax highlighting.',
        );
      }
    }
  });

  context.subscriptions.push(configWatcher);
}

export function deactivate(): void {
  deactivateLinter();
}
