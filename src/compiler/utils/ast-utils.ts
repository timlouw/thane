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