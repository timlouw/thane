/**
 * Error handling utilities for the Thane compiler
 */

import type { Diagnostic, DiagnosticSeverity, SourceLocation } from './types.js';

/**
 * Error codes for different compiler issues
 */
export enum ErrorCode {
  // Parse errors
  PREFIXED_ATTRIBUTE = 'THANE006',
  REPEAT_ROW_ROOT = 'THANE007',
  ROW_ROOT_WHEN = 'THANE008',
  TEMPLATE_STRUCTURE = 'THANE009',
  REPEAT_EMPTY_TEMPLATE_FUNCTION = 'THANE010',
  REPEAT_EMPTY_TEMPLATE_SHAPE = 'THANE011',
  BINDING_NAME_COLLISION = 'THANE012',
  SHARED_SELECTOR = 'THANE013',

  // Build errors
  FILE_NOT_FOUND = 'THANE200',
  PLUGIN_ERROR = 'THANE202',

  // Lint rules
  NO_DEFAULT_EXPORT_COMPONENT = 'THANE400',
  // THANE401 (component-property-order) is retired and not reused: the order of a component's properties
  // never mattered to the compiler
  // THANE402 (lifecycle-arrow-function) is retired and not reused: a hook may be written in any form
  REQUIRE_CONST_TAGGED_TEMPLATES = 'THANE403',
  NO_NESTED_HTML_TAGS = 'THANE404',
  NO_CONDITIONAL_TEMPLATE_INIT = 'THANE405',
  // THANE406 (no-element-id) is retired and not reused
  // THANE407 (single-component-per-file) is retired and not reused
  COMPONENT_CONST_DECLARATION = 'THANE408',
  NO_ALIASED_COMPONENT_EXPORT = 'THANE409',
  // THANE410 (no-cross-file-html-template) is retired and not reused
  DUPLICATE_MOUNT_TARGET = 'THANE411',
  SINGLE_RETURN_OBJECT = 'THANE412',
  NO_ALIASED_THANE_IMPORT = 'THANE413',
}

/** What `lint` in thane.config.json sets a code to: left out, or reported as a warning or an error */
export type LintSeverity = 'off' | 'warning' | 'error';

/** The severities thane.config.json's `lint` sets, by code */
export type LintSeverities = Readonly<Record<string, LintSeverity>>;

/** The diagnostic with the severity `lint` gives its code, or null when `lint` turns the code off */
export const withConfiguredSeverity = (
  diagnostic: Diagnostic,
  severities: LintSeverities | undefined,
): Diagnostic | null => {
  const severity = diagnostic.code ? severities?.[diagnostic.code] : undefined;
  if (severity === 'off') return null;
  return severity ? { ...diagnostic, severity } : diagnostic;
};

/**
 * Create a diagnostic message
 */
export function createDiagnostic(
  severity: DiagnosticSeverity,
  message: string,
  location?: SourceLocation,
  code?: string,
): Diagnostic {
  return {
    severity,
    message,
    location,
    code,
  };
}

/**
 * Create an error diagnostic
 */
export function createError(message: string, location?: SourceLocation, code?: string): Diagnostic {
  return createDiagnostic('error', message, location, code);
}

/**
 * Create a warning diagnostic
 */
export function createWarning(message: string, location?: SourceLocation, code?: string): Diagnostic {
  return createDiagnostic('warning', message, location, code);
}

/**
 * Format a diagnostic for display
 */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const { severity, message, location, code } = diagnostic;

  let result = '';

  const prefix = severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info';
  result += `[${prefix}]`;

  if (code) {
    result += ` ${code}:`;
  }

  if (location) {
    result += ` ${location.file}:${location.line}:${location.column}`;
  }

  result += `\n  ${message}`;

  return result;
}

/**
 * Check if diagnostics contain any errors
 */
export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
