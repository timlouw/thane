/** Helpers for working with the TypeScript AST. */

import ts from 'typescript';
import type { ComponentDefinition, Range } from '../types.js';
import { FN } from './constants.js';

// ============================================================================
// Source File Creation
// ============================================================================

export const createSourceFile = (filePath: string, source: string): ts.SourceFile => {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
};

// ============================================================================
// Function Call Detection
// ============================================================================

export const isFunctionCall = (node: ts.CallExpression, functionName: string): boolean => {
  return ts.isIdentifier(node.expression) && node.expression.text === functionName;
};

export const isSignalCall = (node: ts.CallExpression): boolean => {
  return isFunctionCall(node, FN.SIGNAL);
};

export const isDefineComponentCall = (node: ts.CallExpression): boolean => {
  return isFunctionCall(node, FN.DEFINE_COMPONENT);
};

/**
 * Convert PascalCase to kebab-case for auto-derived selectors.
 * Example: 'MyCounter' → 'my-counter', 'TodoItem' → 'todo-item'
 */
export const pascalToKebab = (name: string): string => {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
};

// ============================================================================
// Signal Detection
// ============================================================================

/** Get signal name from a bare getter call like `count()`. Returns null if not a bare call. */
export const getBareSignalGetterName = (node: ts.CallExpression): string | null => {
  if (ts.isIdentifier(node.expression) && node.arguments.length === 0) {
    return node.expression.text;
  }
  return null;
};

/**
 * Extract static value from an expression if possible
 * Used for signal initializers and compile-time evaluation
 */
export const extractStaticValue = (arg: ts.Expression): string | number | boolean | null => {
  if (ts.isStringLiteral(arg)) return arg.text;
  if (ts.isNumericLiteral(arg)) return Number(arg.text);
  if (arg.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (arg.kind === ts.SyntaxKind.FalseKeyword) return false;

  // Simple string concatenation: "a" + "b"
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = extractStaticValue(arg.left);
    const right = extractStaticValue(arg.right);
    if (typeof left === 'string' && typeof right === 'string') {
      return left + right;
    }
  }
  return null;
};

/**
 * Find all signal property declarations and their initial values.
 * Supports both class property pattern (this._count = signal(0))
 * and variable pattern (const count = signal(0)).
 */
export const findSignalInitializers = (sourceFile: ts.SourceFile): Map<string, string | number | boolean> => {
  const initializers = new Map<string, string | number | boolean>();

  const visit = (node: ts.Node) => {
    // Class property pattern: private _count = signal(0)
    if (
      ts.isPropertyDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isSignalCall(node.initializer)
    ) {
      const args = node.initializer.arguments;
      const firstArg = args[0];
      if (args.length > 0 && firstArg) {
        const value = extractStaticValue(firstArg);
        if (value !== null) {
          initializers.set(node.name.text, value);
        }
      }
    }

    // Variable pattern: const count = signal(0)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isSignalCall(node.initializer)
    ) {
      const args = node.initializer.arguments;
      const firstArg = args[0];
      if (args.length > 0 && firstArg) {
        const value = extractStaticValue(firstArg);
        if (value !== null) {
          initializers.set(node.name.text, value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return initializers;
};

// ============================================================================
// Class Detection
// ============================================================================

export const findClassExtending = (
  sourceFile: ts.SourceFile,
  baseClassName: string,
): ts.ClassExpression | ts.ClassDeclaration | null => {
  let foundClass: ts.ClassExpression | ts.ClassDeclaration | null = null;

  const visit = (node: ts.Node) => {
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression) && type.expression.text === baseClassName) {
              foundClass = node;
            }
          }
        }
      }
    }
    if (!foundClass) {
      ts.forEachChild(node, visit);
    }
  };

  visit(sourceFile);
  return foundClass;
};

export const findEnclosingClass = (node: ts.Node): ts.ClassExpression | ts.ClassDeclaration | null => {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isClassExpression(current) || ts.isClassDeclaration(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
};

// ============================================================================
// Template Detection
// ============================================================================

export const isHtmlTemplate = (node: ts.TaggedTemplateExpression): boolean => {
  return ts.isIdentifier(node.tag) && node.tag.text === FN.HTML;
};

export const isCssTemplate = (node: ts.TaggedTemplateExpression): boolean => {
  return ts.isIdentifier(node.tag) && node.tag.text === FN.CSS;
};

export const hasHtmlTemplates = (source: string): boolean => {
  return source.includes('html`');
};

/**
 * Extract template content from a template literal
 * Supports both TaggedTemplateExpression and TemplateLiteral
 */
export const extractTemplateContent = (
  template: ts.TaggedTemplateExpression | ts.TemplateLiteral,
  sourceFile?: ts.SourceFile,
): string => {
  // Handle TaggedTemplateExpression - get the template property
  const templateLiteral = ts.isTaggedTemplateExpression(template) ? template.template : template;

  if (ts.isNoSubstitutionTemplateLiteral(templateLiteral)) {
    return templateLiteral.text;
  }

  // For template expressions with substitutions, we need to reconstruct
  if (ts.isTemplateExpression(templateLiteral)) {
    let content = templateLiteral.head.text;
    for (const span of templateLiteral.templateSpans) {
      // Use sourceFile.getText if available for more accurate representation
      const exprText = sourceFile ? span.expression.getText(sourceFile) : span.expression.getText();
      content += '${' + exprText + '}';
      content += span.literal.text;
    }
    return content;
  }

  return '';
};

// ============================================================================
// Component Registration
// ============================================================================

/**
 * Extract all component definitions from a source file.
 * Supports defineComponent() pattern.
 */
export const extractComponentDefinitions = (sourceFile: ts.SourceFile, filePath: string): ComponentDefinition[] => {
  const definitions: ComponentDefinition[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (hasExport) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer && ts.isCallExpression(decl.initializer)) {
            const exportName = decl.name.text;
            const call = decl.initializer;

            // defineComponent pattern
            if (isDefineComponentCall(call)) {
              let selector: string | null = null;

              // Check if first arg is a string literal (explicit selector)
              const firstArg = call.arguments[0];
              if (firstArg && ts.isStringLiteral(firstArg)) {
                selector = firstArg.text;
              } else {
                // Auto-derive from export name
                selector = pascalToKebab(exportName);
              }

              if (selector) {
                definitions.push({
                  name: exportName,
                  selector,
                  filePath,
                });
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return definitions;
};

/**
 * Extract the page selector from a source file.
 * Supports defineComponent() (named exports).
 */
export const extractPageSelector = (sourceFile: ts.SourceFile): string | null => {
  let selector: string | null = null;

  const visit = (node: ts.Node) => {
    // export const X = defineComponent(...)
    if (ts.isVariableStatement(node)) {
      const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (hasExport) {
        for (const decl of node.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            decl.initializer &&
            ts.isCallExpression(decl.initializer) &&
            isDefineComponentCall(decl.initializer)
          ) {
            const exportName = decl.name.text;
            const firstArg = decl.initializer.arguments[0];
            if (firstArg && ts.isStringLiteral(firstArg)) {
              selector = firstArg.text;
            } else {
              selector = pascalToKebab(exportName);
            }
          }
        }
      }
    }

    if (!selector) {
      ts.forEachChild(node, visit);
    }
  };

  visit(sourceFile);
  return selector;
};

// ============================================================================
// Utility Functions
// ============================================================================

export const toCamelCase = (str: string): string => {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
};

export const toKebabCase = (str: string): string => {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
};

// ============================================================================
// AST-based Expression Utilities
// ============================================================================

/**
 * Rename all occurrences of an identifier in a JS expression using the TS AST.
 * Unlike regex, this only renames actual identifier tokens — not inside strings,
 * template literals, or property-access chains.
 */
export const renameIdentifierInExpression = (expression: string, oldName: string, newName: string): string => {
  // Wrap in parens so the expression is parseable as a statement
  const wrapped = `(${expression})`;
  const sf = ts.createSourceFile('__expr.ts', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  // Collect all identifier positions that match (in reverse order for safe splicing)
  const positions: Range[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === oldName) {
      // Exclude property-access names (x.item should not rename 'item')
      const parent = node.parent;
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) {
        // This is the .prop part of x.prop — skip
      } else {
        // Adjust for the wrapping paren offset (subtract 1)
        positions.push({ start: node.getStart(sf) - 1, end: node.getEnd() - 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Apply replacements in reverse order
  positions.sort((a, b) => b.start - a.start);
  let result = expression;
  for (const pos of positions) {
    result = result.substring(0, pos.start) + newName + result.substring(pos.end);
  }
  return result;
};

/** Check whether an expression references a given identifier (AST-based, not regex). */
export const expressionReferencesIdentifier = (expression: string, identifierName: string): boolean => {
  const wrapped = `(${expression})`;
  const sf = ts.createSourceFile('__expr.ts', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === identifierName) {
      const parent = node.parent;
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) {
        // This is the .prop part — not a reference to the identifier
      } else {
        found = true;
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
};

/**
 * Detect signal call expressions in a JS expression.
 * Class mode: `this._signal()`, closure mode: `_signal()`.
 */
export const findComponentSignalCalls = (expression: string, classStyle: boolean): Set<string> => {
  const wrapped = `(${expression})`;
  const sf = ts.createSourceFile('__expr.ts', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const signals = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length === 0) {
      if (classStyle) {
        // Class mode: this._signalName()
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
          ts.isIdentifier(node.expression.name) &&
          node.expression.name.text.startsWith('_')
        ) {
          signals.add(node.expression.name.text);
        }
      } else {
        // Closure mode: _signalName() — bare identifier call, not a method call
        if (ts.isIdentifier(node.expression) && node.expression.text.startsWith('_')) {
          // Ensure it's not a method call like obj._signal()
          const parent = node.parent;
          const isBareCall = !(parent && ts.isPropertyAccessExpression(parent));
          if (isBareCall) {
            signals.add(node.expression.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return signals;
};

/**
 * Parse an arrow function expression and return its parameter list and body.
 * Uses TS AST to correctly handle destructuring, defaults, and nested parens.
 * Returns null if the expression is not an arrow function.
 */
export const parseArrowFunction = (
  expression: string,
): {
  params: string;
  body: string;
  isBlockBody: boolean;
} | null => {
  const wrapped = `(${expression})`;
  const sf = ts.createSourceFile('__expr.ts', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let result: { params: string; body: string; isBlockBody: boolean } | null = null;

  const visit = (node: ts.Node) => {
    if (result) return;
    if (ts.isArrowFunction(node)) {
      const params = node.parameters.map((p) => p.getText(sf)).join(', ');
      const body = node.body.getText(sf);
      const isBlockBody = ts.isBlock(node.body);
      result = { params, body, isBlockBody };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return result;
};

/**
 * Check if an expression is a simple `this.methodName` or `this._methodName` reference
 * (not a call — just the reference itself).
 */
export const isThisMethodReference = (expression: string): boolean => {
  const trimmed = expression.trim();
  const wrapped = `(${trimmed})`;
  const sf = ts.createSourceFile('__expr.ts', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(node.name)
    ) {
      // Ensure this is the top-level expression (not nested inside another expr)
      // The structure is: ExpressionStatement > ParenthesizedExpression > PropertyAccessExpression
      if (
        node.parent &&
        ts.isParenthesizedExpression(node.parent) &&
        node.parent.parent &&
        ts.isExpressionStatement(node.parent.parent)
      ) {
        found = true;
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
};

// ============================================================================
// Component HTML Generation (Compile-time)
// ============================================================================

export interface ComponentHTMLConfig {
  selector: string;
  props: Record<string, any>;
  /** Pre-allocated anchor ID from the CTFE counter ("b0", "b1", …) */
  anchorId: string;
}

/**
 * Emit a `<template>` anchor for a child component mount point.
 * CTFE allocates IDs `b0`, `b1`, … and the binding compiler starts its
 * `idCounter` at the offset = number of child mounts.
 */
export const generateComponentHTML = (config: ComponentHTMLConfig): string => {
  return `<template id="${config.anchorId}"></template>`;
};
