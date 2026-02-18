/**
 * Thane Linter — VS Code Diagnostic Provider
 *
 * Shares the exact same lint rules used by the Thane compiler, running them
 * in real-time as you type. Rules are imported from the compiler source and
 * bundled by esbuild at build time, so:
 *
 *   - Single source of truth — add a rule in the compiler, it appears here.
 *   - Zero runtime dependency on the compiler's module system (ESM→CJS
 *     conversion is handled transparently by the bundler).
 *   - Only files containing `defineComponent` are parsed, keeping overhead
 *     near-zero for non-component files.
 */

import * as vscode from 'vscode';
import ts from 'typescript';

// These imports resolve to the compiler source at build time.
// esbuild follows the paths, compiles the TypeScript, and bundles everything
// into a single CJS file — no ESM/CJS friction at runtime.
import { allRules } from '../../../src/compiler/plugins/thane-linter/rules/index.js';
import type { LintRuleDefinition } from '../../../src/compiler/plugins/thane-linter/rules/types.js';
import type { Diagnostic as ThaneDiagnostic } from '../../../src/compiler/types.js';

// ============================================================================
// Module-level singleton — guards against double activation
// ============================================================================

let diagnosticCollection: vscode.DiagnosticCollection | undefined;

// ============================================================================
// Severity mapping
// ============================================================================

function mapSeverity(severity: string): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

// ============================================================================
// Quick filters
// ============================================================================

/**
 * Skip files that shouldn't be linted:
 *   - Not TypeScript / TSX
 *   - Inside node_modules
 *   - Declaration files (.d.ts)
 */
function shouldSkip(document: vscode.TextDocument): boolean {
  if (document.languageId !== 'typescript' && document.languageId !== 'typescriptreact') {
    return true;
  }
  // Only lint real files on disk — skip virtual documents from chat
  // editing, diff views, git previews, etc.
  if (document.uri.scheme !== 'file') {
    return true;
  }
  const path = document.uri.fsPath;
  if (path.includes('node_modules') || path.endsWith('.d.ts')) {
    return true;
  }
  return false;
}

/**
 * Only lint files that contain `defineComponent`.
 * This matches the same heuristic the compiler's esbuild plugin uses,
 * keeping overhead near-zero for non-component files.
 */
function containsDefineComponent(text: string): boolean {
  return text.includes('defineComponent');
}

// ============================================================================
// Diagnostic conversion
// ============================================================================

/**
 * Converts Thane compiler diagnostics into VS Code diagnostics.
 *
 * The compiler uses 1-based line/column numbers; VS Code uses 0-based.
 * When `location.length` is available the range spans exactly that many
 * characters; otherwise the entire line from the reported column onward
 * is highlighted.
 */
function toVscodeDiagnostics(diagnostics: ThaneDiagnostic[], document: vscode.TextDocument): vscode.Diagnostic[] {
  return diagnostics.map((d) => {
    let range: vscode.Range;

    if (d.location) {
      const line = Math.max(0, Math.min(d.location.line - 1, document.lineCount - 1));
      const col = Math.max(0, d.location.column - 1);
      const length = d.location.length ?? 0;

      if (length > 0) {
        range = new vscode.Range(line, col, line, col + length);
      } else {
        // Highlight from the reported column to end of line
        const lineText = document.lineAt(line).text;
        range = new vscode.Range(line, col, line, lineText.length);
      }
    } else {
      range = new vscode.Range(0, 0, 0, 0);
    }

    const vscodeDiag = new vscode.Diagnostic(range, d.message, mapSeverity(d.severity));
    vscodeDiag.source = 'thane';
    if (d.code) {
      vscodeDiag.code = d.code;
    }
    return vscodeDiag;
  });
}

// ============================================================================
// Document linting
// ============================================================================

/**
 * Parses a single document and runs every compiler lint rule against it.
 * Results are published to the singleton diagnostic collection.
 */
function lintDocument(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
  rules: readonly LintRuleDefinition[],
): void {
  if (shouldSkip(document)) {
    return;
  }

  const text = document.getText();

  // Quick bail-out — skip files that don't contain defineComponent
  // and clear any stale diagnostics that might linger from a
  // previous version of the file content.
  if (!containsDefineComponent(text)) {
    collection.delete(document.uri);
    return;
  }

  try {
    // Parse into a TypeScript AST (same approach the compiler uses)
    const sourceFile = ts.createSourceFile(
      document.fileName,
      text,
      ts.ScriptTarget.Latest,
      true, // setParentNodes
    );

    // Run every rule
    const results: ThaneDiagnostic[] = [];
    for (const rule of rules) {
      results.push(...rule.check(sourceFile, document.fileName));
    }

    // Publish — set() replaces all previous diagnostics for this URI
    const vscodeDiags = toVscodeDiagnostics(results, document);
    collection.set(document.uri, vscodeDiags);
  } catch {
    // If parsing fails, clear stale diagnostics rather than showing noise
    collection.delete(document.uri);
  }
}

// ============================================================================
// Activation
// ============================================================================

/**
 * Activates the Thane linter integration.
 *
 * Uses a module-level singleton DiagnosticCollection to guarantee
 * diagnostics are never duplicated even if activate is called more
 * than once. Sets up file watchers for open / save / change (debounced)
 * and clears diagnostics when files are closed.
 */
export function activateLinter(context: vscode.ExtensionContext): void {
  // Dispose any previous collection (safety net for double-activation)
  if (diagnosticCollection) {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
  }

  diagnosticCollection = vscode.languages.createDiagnosticCollection('thane');
  context.subscriptions.push(diagnosticCollection);

  const collection = diagnosticCollection;
  const rules = allRules;

  // Per-document debounce timers so editing one file doesn't
  // cancel/delay the lint of another. Keyed by URI string.
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleLint(doc: vscode.TextDocument, delayMs: number): void {
    const key = doc.uri.toString();

    // Cancel any pending timer for this specific document
    const existing = debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      debounceTimers.delete(key);
    }

    if (delayMs <= 0) {
      lintDocument(doc, collection, rules);
    } else {
      debounceTimers.set(
        key,
        setTimeout(() => {
          debounceTimers.delete(key);
          // Re-fetch the live document — the reference from the
          // change event may be a snapshot and not reflect the
          // latest edits.
          const liveDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
          if (liveDoc) {
            lintDocument(liveDoc, collection, rules);
          }
        }, delayMs),
      );
    }
  }

  // Track which URIs we lint during the initial sweep so we don't
  // re-lint them if onDidOpenTextDocument fires immediately after.
  const initialDocs = new Set<string>();

  // Lint all currently open documents
  for (const doc of vscode.workspace.textDocuments) {
    const key = doc.uri.toString();
    initialDocs.add(key);
    scheduleLint(doc, 0);
  }

  // Clear the initial set after a tick — any onDidOpenTextDocument
  // events that arrive within the same tick are duplicates of the
  // initial sweep; later ones are genuine new opens.
  setTimeout(() => initialDocs.clear(), 0);

  // Lint when a document is opened (skip if we just linted it above)
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (initialDocs.has(doc.uri.toString())) return;
      scheduleLint(doc, 0);
    }),
  );

  // Lint on save (immediate — no debounce)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      scheduleLint(doc, 0);
    }),
  );

  // Lint on change (300 ms debounce per-document)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length === 0) return;
      scheduleLint(e.document, 300);
    }),
  );

  // Clear diagnostics when a document is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const timer = debounceTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(key);
      }
      collection.delete(doc.uri);
    }),
  );
}

/**
 * Cleans up the linter. Called from the extension's `deactivate()`.
 */
export function deactivateLinter(): void {
  if (diagnosticCollection) {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
    diagnosticCollection = undefined;
  }
}
