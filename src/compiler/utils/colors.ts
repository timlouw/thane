/**
 * ANSI color utilities with automatic TTY / NO_COLOR detection.
 *
 * Colours are disabled when:
 * - stdout is not a TTY (piped / CI logs)
 * - the `NO_COLOR` env var is set (https://no-color.org)
 * - the `FORCE_COLOR` env var is explicitly "0"
 *
 * Colours are force-enabled when:
 * - `FORCE_COLOR` is set to a truthy value ("1", "true", etc.)
 */

const _forceColor = process.env['FORCE_COLOR'];
const _noColor = process.env['NO_COLOR'];

/** Whether ANSI escape codes should be emitted */
export const supportsColor: boolean =
  _forceColor !== undefined
    ? _forceColor !== '0' && _forceColor !== 'false'
    : _noColor === undefined && (process.stdout?.isTTY ?? false);

const _wrap = (code: string, fmt: string): string => (supportsColor ? code : (fmt === 'console' ? '%s' : ''));

export const consoleColors = {
  green:  _wrap('\x1b[32m%s\x1b[0m', 'console'),
  yellow: _wrap('\x1b[33m%s\x1b[0m', 'console'),
  blue:   _wrap('\x1b[94m%s\x1b[0m', 'console'),
  cyan:   _wrap('\x1b[36m%s\x1b[0m', 'console'),
  red:    _wrap('\x1b[31m%s\x1b[0m', 'console'),
  orange: _wrap('\x1b[38;5;208m%s\x1b[0m', 'console'),
  reset:  _wrap('\x1b[0m', 'console'),
} as const;

export const ansi = {
  green:   _wrap('\x1b[32m', 'raw'),
  yellow:  _wrap('\x1b[33m', 'raw'),
  blue:    _wrap('\x1b[94m', 'raw'),
  cyan:    _wrap('\x1b[36m', 'raw'),
  red:     _wrap('\x1b[31m', 'raw'),
  magenta: _wrap('\x1b[35m', 'raw'),
  orange:  _wrap('\x1b[38;5;208m', 'raw'),
  gray:    _wrap('\x1b[90m', 'raw'),
  dim:     _wrap('\x1b[2m', 'raw'),
  reset:   _wrap('\x1b[0m', 'raw'),
} as const;

export type ConsoleColor = keyof typeof consoleColors;
