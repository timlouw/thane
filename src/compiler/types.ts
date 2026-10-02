/**
 * Thane Compiler Type Definitions
 * These types are used internally by the compiler.
 */

import type ts from 'typescript';

/**
 * Log level for compiler output
 */
export type LogLevel = 'silent' | 'normal' | 'verbose';

/**
 * Diagnostic severity
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Source location for error reporting
 */
export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  length?: number;
}

/**
 * Compiler diagnostic message
 */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  location?: SourceLocation | undefined;
  code?: string | undefined;
}

/**
 * Component definition
 */
export interface ComponentDefinition {
  /** The name the component is declared under */
  name: string;
  selector: string;
  filePath: string;
  /** Exported, so other files can import it; one that is not is called in its own file only */
  exported: boolean;
}

/** A fragment a module exports (`export const Name = html\`…\``), which other files' templates use */
export interface FragmentDefinition {
  name: string;
  filePath: string;
  exported: true;
  /** Its markup, as written, when it has no `${}`: a template that uses it inlines it */
  staticText: string | null;
}

/**
 * Template info from AST analysis
 */
export interface TemplateInfo {
  node: ts.TaggedTemplateExpression;
  templateStart: number;
  templateEnd: number;
}

/** A start/end character range for source positions and overlap checking. */
export interface Range {
  start: number;
  end: number;
}

/**
 * Import info for dependency tracking
 */
export interface ImportInfo {
  namedImports: string[];
  moduleSpecifier: string;
  start: number;
  end: number;
  quoteChar: string;
}

/**
 * Shared build context passed across plugins to avoid duplicate work.
 * The filesystem scan results are populated once and read by ComponentPrecompiler.
 */
export interface BuildContext {
  /** All .ts files discovered by the shared scan */
  tsFiles: string[];
  /** The project folder: its tsconfig.json decides how imports resolve */
  projectRoot: string;
  /** Every component definition the scan found; several may share a name in different files */
  components: ComponentDefinition[];
  /** Component definitions found during the scan, keyed by selector */
  componentsBySelector: Map<string, ComponentDefinition>;
  /** Production build: templates and stylesheets are minified where the compiler emits them */
  minify?: boolean;
  /** Selector renames, planned by MinificationPlugin before each build and applied by the compiler */
  selectorMap?: import('./plugins/minification/selector-minifier.js').SelectorMap;
  /** The severity thane.config.json's `lint` gives each code; the compiler's warnings follow it too */
  lint?: import('./errors.js').LintSeverities | undefined;
  /** `thane dev`: what hot updates need (see plugins/component-precompiler/hot-modules.ts) */
  hot?: import('./plugins/component-precompiler/hot-modules.js').HotState;
}
