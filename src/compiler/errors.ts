/**
 * Error handling utilities for the Thane compiler
 */

import type { Diagnostic, DiagnosticSeverity, SourceLocation } from './types.js';

/**
 * Error codes for different compiler issues
 */
export enum ErrorCode {
  // Parse errors
  UNCLOSED_TAG = 'THANE001',
  INVALID_NESTING = 'THANE002',
  MALFORMED_ATTRIBUTE = 'THANE003',
  UNCLOSED_EXPRESSION = 'THANE004',
  INVALID_DIRECTIVE = 'THANE005',
  
  // Type errors
  TYPE_ERROR = 'THANE100',
  MISSING_SIGNAL = 'THANE101',
  INVALID_COMPONENT = 'THANE102',
  
  // Build errors
  FILE_NOT_FOUND = 'THANE200',
  BUILD_FAILED = 'THANE201',
  PLUGIN_ERROR = 'THANE202',
  
  // Runtime errors
  INVALID_SELECTOR = 'THANE300',
  DUPLICATE_COMPONENT = 'THANE301',
  
  // Lint rules
  NO_DEFAULT_EXPORT_COMPONENT = 'THANE400',
  COMPONENT_PROPERTY_ORDER = 'THANE401',
  LIFECYCLE_ARROW_FUNCTION = 'THANE402',
  REQUIRE_CONST_TAGGED_TEMPLATES = 'THANE403',
  NO_NESTED_HTML_TAGS = 'THANE404',
  NO_CONDITIONAL_TEMPLATE_INIT = 'THANE405',
  NO_ELEMENT_ID = 'THANE406',
  SINGLE_COMPONENT_PER_FILE = 'THANE407',
  COMPONENT_CONST_DECLARATION = 'THANE408',
  NO_ALIASED_COMPONENT_EXPORT = 'THANE409',
  NO_CROSS_FILE_HTML_TEMPLATE = 'THANE410',
  DUPLICATE_MOUNT_TARGET = 'THANE411',
}

/**
 * Create a diagnostic message
 */
export function createDiagnostic(
  severity: DiagnosticSeverity,
  message: string,
  location?: SourceLocation,
  code?: string
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
export function createError(
  message: string,
  location?: SourceLocation,
  code?: string
): Diagnostic {
  return createDiagnostic('error', message, location, code);
}

/**
 * Create a warning diagnostic
 */
export function createWarning(
  message: string,
  location?: SourceLocation,
  code?: string
): Diagnostic {
  return createDiagnostic('warning', message, location, code);
}

/**
 * Create an info diagnostic
 */
export function createInfo(
  message: string,
  location?: SourceLocation,
  code?: string
): Diagnostic {
  return createDiagnostic('info', message, location, code);
}

/**
 * Format a diagnostic for display
 */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const { severity, message, location, code } = diagnostic;
  
  let result = '';
  
  // Add severity prefix with color
  const prefix = severity === 'error' ? 'error' : 
                 severity === 'warning' ? 'warning' : 'info';
  result += `[${prefix}]`;
  
  // Add error code if present
  if (code) {
    result += ` ${code}:`;
  }
  
  // Add location if present (file:line:col format for VS Code clickability)
  if (location) {
    result += ` ${location.file}:${location.line}:${location.column}`;
  }
  
  // Add message
  result += `\n  ${message}`;
  
  return result;
}

/**
 * Format multiple diagnostics for display
 */
export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join('\n\n');
}

/**
 * Check if diagnostics contain any errors
 */
export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some(d => d.severity === 'error');
}

/**
 * Get only error diagnostics
 */
export function getErrors(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(d => d.severity === 'error');
}

/**
 * Get only warning diagnostics
 */
export function getWarnings(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(d => d.severity === 'warning');
}
