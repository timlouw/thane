/**
 * HTML Parser — Re-export from split modules for backward compatibility.
 * 
 * The parser has been split into:
 * - html-parser/types.ts       — Type definitions, constants, entity handling
 * - html-parser/parser-core.ts — State machine parser
 * - html-parser/binding-detection.ts — Binding and directive detection
 * - html-parser/html-utils.ts  — DOM query and edit utilities
 */

export * from './html-parser/index.js';
