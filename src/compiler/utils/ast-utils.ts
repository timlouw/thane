/**
 * AST Utilities for Thane Compiler
 * 
 * Provides helpers for working with TypeScript AST (Abstract Syntax Tree).
 */

import ts from 'typescript';
import type { ComponentDefinition } from '../types.js';
import { FN, PROP } from './constants.js';

// Re-export for backwards compatibility
export { FN, PROP };

// ============================================================================
// Source File Creation
// ============================================================================

/**
 * Create a TypeScript source file from code
 */
export const createSourceFile = (filePath: string, source: string): ts.SourceFile => {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
};

// ============================================================================
// Function Call Detection
// ============================================================================

/**
 * Check if a call expression calls a specific function
 */
export const isFunctionCall = (node: ts.CallExpression, functionName: string): boolean => {
  return ts.isIdentifier(node.expression) && node.expression.text === functionName;
};

/**
 * Check if node is a signal() call
 */
export const isSignalCall = (node: ts.CallExpression): boolean => {
  return isFunctionCall(node, FN.SIGNAL);
};

/**
 * Check if node is a defineComponent() call
 */
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

/**
 * Get signal name from a bare getter call like count() (defineComponent pattern).
 * Only matches simple identifier calls with no arguments.
 * Returns null if not a bare function call.
 */
export const getBareSignalGetterName = (node: ts.CallExpression): string | null => {
  if (
    ts.isIdentifier(node.expression) &&
    node.arguments.length === 0
  ) {
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
    if (ts.isVariableDeclaration(node) && 
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

/**
 * Find a class that extends a specific base class
 */
export const findClassExtending = (
  sourceFile: ts.SourceFile, 
  baseClassName: string
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

/**
 * Find the enclosing class for a given node
 */
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

/**
 * Check if a tagged template is html``
 */
export const isHtmlTemplate = (node: ts.TaggedTemplateExpression): boolean => {
  return ts.isIdentifier(node.tag) && node.tag.text === FN.HTML;
};

/**
 * Check if a tagged template is css``
 */
export const isCssTemplate = (node: ts.TaggedTemplateExpression): boolean => {
  return ts.isIdentifier(node.tag) && node.tag.text === FN.CSS;
};

/**
 * Check if source code contains html`` templates
 */
export const hasHtmlTemplates = (source: string): boolean => {
  return source.includes('html`');
};

/**
 * Extract template content from a template literal
 * Supports both TaggedTemplateExpression and TemplateLiteral
 */
export const extractTemplateContent = (
  template: ts.TaggedTemplateExpression | ts.TemplateLiteral,
  sourceFile?: ts.SourceFile
): string => {
  // Handle TaggedTemplateExpression - get the template property
  const templateLiteral = ts.isTaggedTemplateExpression(template) 
    ? template.template 
    : template;
    
  if (ts.isNoSubstitutionTemplateLiteral(templateLiteral)) {
    return templateLiteral.text;
  }
  
  // For template expressions with substitutions, we need to reconstruct
  if (ts.isTemplateExpression(templateLiteral)) {
    let content = templateLiteral.head.text;
    for (const span of templateLiteral.templateSpans) {
      // Use sourceFile.getText if available for more accurate representation
      const exprText = sourceFile 
        ? span.expression.getText(sourceFile)
        : span.expression.getText();
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
          if (ts.isIdentifier(decl.name) && decl.initializer && ts.isCallExpression(decl.initializer) && isDefineComponentCall(decl.initializer)) {
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

/**
 * Convert kebab-case to camelCase
 */
export const toCamelCase = (str: string): string => {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
};

/**
 * Convert camelCase to kebab-case
 */
export const toKebabCase = (str: string): string => {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
};

// ============================================================================
// AST-based Expression Utilities
// ============================================================================

/**
 * Rename all occurrences of an identifier in a JS expression using the TS AST.
 * 
 * Unlike `\bname\b` regex, this only renames actual identifier tokens — it will
 * never match inside string literals, template literals, or property-access
 * chains that happen to contain the same text.
 *
 * @param expression - A JavaScript expression string, e.g. `item.label`
 * @param oldName - The identifier to find, e.g. `item`
 * @param newName - The replacement identifier, e.g. `v`
 * @returns The expression with all identifier occurrences renamed
 */
export const renameIdentifierInExpression = (expression: string, oldName: string, newName: string): string => {
  // Wrap in parens so the expression is parseable as a statement
  const wrapped = `(${expression})`;
  const sf = ts.createSourceFile('__expr.ts', wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  // Collect all identifier positions that match (in reverse order for safe splicing)
  const positions: Array<{ start: number; end: number }> = [];

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

/**
 * Check whether an expression references a given identifier (AST-based).
 * 
 * Unlike `\bname\b` regex, this only matches actual identifier tokens.
 */
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
 * Detect component-level signal call expressions in a JS expression.
 * 
 * In class mode, these look like `this._signal()`.
 * In closure mode, these look like `_signal()` (bare calls with no dot-prefix).
 * 
 * Returns the set of signal names found.
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
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text.startsWith('_')
        ) {
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
 * 
 * Unlike regex-based parsing, this correctly handles:
 * - Destructured parameters: `({a, b}) => a + b`
 * - Default values: `(x = 10) => x`
 * - Multi-line bodies: `(x) => { ... }`
 * - Nested parentheses: `(x) => fn(x, y)`
 * 
 * Returns null if the expression is not an arrow function.
 */
export const parseArrowFunction = (expression: string): {
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
      const params = node.parameters.map(p => p.getText(sf)).join(', ');
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
        node.parent && ts.isParenthesizedExpression(node.parent) &&
        node.parent.parent && ts.isExpressionStatement(node.parent.parent)
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

interface ComponentHTMLConfig {
  selector: string;
  props: Record<string, any>;
}

/**
 * Generate HTML for a component at compile time
 */
export const generateComponentHTML = (config: ComponentHTMLConfig): string => {
  const { selector, props } = config;

  const propsString = Object.entries(props)
    .map(([key, value]) => {
      const val = typeof value === 'string' ? value : JSON.stringify(value) || '';
      return `${key}="${val.replace(/"/g, '&quot;')}"`;
    })
    .join(' ');

  return `<${selector}${propsString ? ' ' + propsString : ''}></${selector}>`;
};