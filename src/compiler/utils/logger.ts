/**
 * Logging utilities for the Thane compiler
 */

import type { LogLevel, Diagnostic } from '../types.js';
import { formatDiagnostic } from '../errors.js';
import { ansi } from './colors.js';

/**
 * Logger class for structured output
 */
export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'normal') {
    this.level = level;
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Log an error (always shown unless silent)
   * Supports: error(message), error(tag, message), error(tag, message, error)
   */
  error(messageOrTag: string, messageOrError?: string | Error | unknown, maybeError?: Error | unknown): void {
    let tag = '[thane]';
    let message: string;
    let error: Error | unknown | undefined;

    if (messageOrError === undefined) {
      message = messageOrTag;
    } else if (typeof messageOrError === 'string') {
      tag = `[${messageOrTag}]`;
      message = messageOrError;
      error = maybeError;
    } else {
      message = messageOrTag;
      error = messageOrError;
    }

    console.error(`${ansi.red}${tag} ${message}${ansi.reset}`);
    if (error) {
      console.error(error);
    }
  }

  /**
   * Log a warning (shown in normal and verbose)
   * Supports: warn(message), warn(tag, message)
   */
  warn(messageOrTag: string, message?: string): void {
    if (this.level === 'silent') return;

    if (message === undefined) {
      console.warn(`${ansi.yellow}[thane] ${messageOrTag}${ansi.reset}`);
    } else {
      console.warn(`${ansi.yellow}[${messageOrTag}] ${message}${ansi.reset}`);
    }
  }

  /**
   * Log an info message (shown in normal and verbose)
   * Supports: info(message), info(tag, message), info(tag, message, extra)
   */
  info(messageOrTag: string, message?: string, extra?: string): void {
    if (this.level === 'silent') return;

    if (message === undefined) {
      console.log(`${ansi.cyan}[thane]${ansi.reset} ${messageOrTag}`);
    } else if (extra === undefined) {
      console.log(`${ansi.cyan}[${messageOrTag}]${ansi.reset} ${message}`);
    } else {
      console.log(`${ansi.cyan}[${messageOrTag}]${ansi.reset} ${message} ${extra}`);
    }
  }

  /**
   * Log a success message (shown in normal and verbose)
   */
  success(message: string): void {
    if (this.level === 'silent') return;
    console.log(`${ansi.green}[thane]${ansi.reset} ${message}`);
  }

  /**
   * Log a verbose/debug message (only shown in verbose)
   */
  verbose(message: string): void {
    if (this.level !== 'verbose') return;
    console.log(`${ansi.dim}[thane] ${message}${ansi.reset}`);
  }

  /**
   * Log a diagnostic
   */
  diagnostic(diagnostic: Diagnostic): void {
    const formatted = formatDiagnostic(diagnostic);

    if (diagnostic.severity === 'error') {
      console.error(formatted);
    } else if (diagnostic.severity === 'warning') {
      if (this.level !== 'silent') {
        console.warn(formatted);
      }
    } else {
      if (this.level === 'verbose') {
        console.log(formatted);
      }
    }
  }

  /**
   * Log multiple diagnostics
   */
  diagnostics(diagnostics: Diagnostic[]): void {
    diagnostics.forEach((d) => this.diagnostic(d));
  }

  /**
   * Start a timed operation
   */
  time(label: string): void {
    if (this.level === 'verbose') {
      console.time(`${ansi.dim}[thane] ${label}${ansi.reset}`);
    }
  }

  /**
   * End a timed operation
   */
  timeEnd(label: string): void {
    if (this.level === 'verbose') {
      console.timeEnd(`${ansi.dim}[thane] ${label}${ansi.reset}`);
    }
  }

  /**
   * Create a sub-section (verbose only)
   */
  section(title: string): void {
    if (this.level === 'verbose') {
      console.log(`\n${ansi.magenta}${title}${ansi.reset}`);
    }
  }

  /**
   * Log a blank line (normal and verbose)
   */
  newline(): void {
    if (this.level !== 'silent') {
      console.log();
    }
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger();
