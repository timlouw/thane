/** Helpers for working with the TypeScript AST. */

import ts from 'typescript';
import type { ComponentDefinition, FragmentDefinition } from '../types.js';
import { BIND_FN as RUNTIME_HELPER, FN } from './constants.js';

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

/** The `const name = signal(…)` declarations among `statements` (not nested ones): each name with its call */
export const constSignalDeclarations = (
  statements: readonly ts.Statement[],
): { name: string; call: ts.CallExpression }[] =>
  statements.flatMap((statement) =>
    ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const
      ? statement.declarationList.declarations.flatMap(({ name, initializer }) =>
          ts.isIdentifier(name) && initializer && ts.isCallExpression(initializer) && isSignalCall(initializer)
            ? [{ name: name.text, call: initializer }]
            : [],
        )
      : [],
  );

/**
 * `thane dev`: the edits that wrap a signal's call as `__hotSignal(signal(…), 'name')`, or with the module key
 * too for one at a module's top level (runtime/hot.ts)
 */
export const hotSignalEdits = (
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  name: string,
  module?: string,
): { start: number; end: number; replacement: string }[] => {
  const names = [name, ...(module === undefined ? [] : [module])].map((text) => JSON.stringify(text));
  const start = call.getStart(sourceFile);
  return [
    { start, end: start, replacement: `${RUNTIME_HELPER.HOT_SIGNAL}(` },
    { start: call.getEnd(), end: call.getEnd(), replacement: `, ${names.join(', ')})` },
  ];
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
 * The signals declared under `root` (`const count = signal(0)`), except inside the nodes in `skip`,
 * with their initial values where they are literals. A template's static text holds them.
 */
export const findSignalInitializers = (
  root: ts.Node,
  skip?: ReadonlySet<ts.Node>,
): Map<string, string | number | boolean> => {
  const initializers = new Map<string, string | number | boolean>();

  const visit = (node: ts.Node) => {
    if (skip?.has(node)) return;
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

  visit(root);
  return initializers;
};

// ============================================================================
// Template Detection
// ============================================================================

export const isHtmlTemplate = (node: ts.TaggedTemplateExpression): boolean => {
  return ts.isIdentifier(node.tag) && node.tag.text === FN.HTML;
};

export const hasHtmlTemplates = (source: string): boolean => {
  return source.includes('html`');
};

// ============================================================================
// Component Registration
// ============================================================================

/** A component declaration: `const Name = defineComponent(…)`, exported or not. */
export interface ComponentDeclaration {
  /** The name the component is declared under */
  name: string;
  exported: boolean;
  call: ts.CallExpression;
  statement: ts.VariableStatement;
  /** The selector passed to `defineComponent`, or the one derived from the name */
  selector: string;
  /** The selector is passed to `defineComponent` */
  explicitSelector: boolean;
}

/**
 * Every component declaration in a file, in source order: each `const Name = defineComponent(…)` at any
 * depth, one declared inside another's setup function too. Its selector is the string passed as the first
 * argument, or else derived from the name it is declared under: `TodoItem` is `todo-item`.
 */
export const findComponentDeclarations = (sourceFile: ts.SourceFile): ComponentDeclaration[] => {
  const declarations: ComponentDeclaration[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      for (const decl of node.declarationList.declarations) {
        const call = decl.initializer;
        if (!ts.isIdentifier(decl.name) || !call || !ts.isCallExpression(call) || !isDefineComponentCall(call))
          continue;
        const firstArg = call.arguments[0];
        const explicitSelector = !!firstArg && ts.isStringLiteral(firstArg);
        declarations.push({
          name: decl.name.text,
          exported,
          call,
          statement: node,
          selector: explicitSelector ? (firstArg as ts.StringLiteral).text : pascalToKebab(decl.name.text),
          explicitSelector,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return declarations;
};

/** The components a file declares: the ones it exports, and the ones only its own templates can call. */
export const extractComponentDefinitions = (sourceFile: ts.SourceFile, filePath: string): ComponentDefinition[] =>
  findComponentDeclarations(sourceFile).map(({ name, selector, exported }) => ({ name, selector, filePath, exported }));

/** An exported fragment: `export const Name = html\`…\`` at the top level of a module. */
export interface FragmentDeclaration {
  name: string;
  template: ts.TaggedTemplateExpression;
  statement: ts.VariableStatement;
}

/** The fragments a module exports, in source order: other files' templates can use them. */
export const findExportedFragments = (sourceFile: ts.SourceFile): FragmentDeclaration[] => {
  const fragments: FragmentDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const decl of statement.declarationList.declarations) {
      const init = decl.initializer;
      if (ts.isIdentifier(decl.name) && init && ts.isTaggedTemplateExpression(init) && isHtmlTemplate(init)) {
        fragments.push({ name: decl.name.text, template: init, statement });
      }
    }
  }
  return fragments;
};

/** The fragments a file exports, for the files that import them */
export const extractFragmentDefinitions = (sourceFile: ts.SourceFile, filePath: string): FragmentDefinition[] =>
  findExportedFragments(sourceFile).map(({ name, template }) => ({
    name,
    filePath,
    exported: true,
    staticText: ts.isNoSubstitutionTemplateLiteral(template.template) ? template.template.rawText! : null,
  }));

// ============================================================================
// Utility Functions
// ============================================================================

export const toCamelCase = (str: string): string => {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
};

// ============================================================================
// AST-based Expression Utilities
// ============================================================================

/**
 * `expr` with each reference to the variable `name` replaced by `replacement`. A string, a property
 * name or a property access is not a reference. Everything else keeps its text: printed again, an
 * html`` template inside would read `html \`…\``, which the template parser takes for markup. A
 * function inside that declares its own `name` shadows it there, as in JavaScript.
 */
export const replaceReferences = (expr: string, name: string, replacement: string): string => {
  const sf = ts.createSourceFile('__expr.ts', `(${expr})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: [start: number, end: number, text: string][] = [];
  const binds = (n: ts.BindingName): boolean =>
    ts.isIdentifier(n) ? n.text === name : n.elements.some((e) => !ts.isOmittedExpression(e) && binds(e.name));
  const isPropertyName = (node: ts.Identifier): boolean => {
    const p = node.parent;
    return (
      ((ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) &&
        p.name === node) ||
      ((ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === node) ||
      (ts.isBindingElement(p) && p.propertyName === node)
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node.parameters.some((p) => binds(p.name))) return;
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === name) {
      // `{ name }` keeps its key: `{ name: replacement }`
      edits.push([node.name.end, node.name.end, `: ${replacement}`]);
      return;
    }
    if (ts.isIdentifier(node) && node.text === name && !isPropertyName(node)) {
      edits.push([node.getStart(sf), node.end, replacement]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = `(${expr})`;
  for (const [start, end, text] of edits.reverse()) out = out.slice(0, start) + text + out.slice(end);
  return out.slice(1, -1);
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

/** The expression `expression` is, parentheses removed, and its source file; null when it is not one expression. */
const parseWholeExpression = (expression: string): { node: ts.Expression; sf: ts.SourceFile } | null => {
  const sf = ts.createSourceFile('__expr.ts', `(${expression})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = sf.statements.length === 1 ? sf.statements[0] : undefined;
  if (!statement || !ts.isExpressionStatement(statement)) return null;
  let node = statement.expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return { node, sf };
};

/**
 * Parse an arrow function expression and return its parameter list and body.
 * Uses TS AST to correctly handle destructuring, defaults, and nested parens.
 * Returns null if the expression is not an arrow function, including one that only
 * contains an arrow, such as a call with an arrow argument.
 */
export const parseArrowFunction = (
  expression: string,
): {
  params: string;
  body: string;
  isBlockBody: boolean;
} | null => {
  const parsed = parseWholeExpression(expression);
  if (!parsed || !ts.isArrowFunction(parsed.node)) return null;
  const { node, sf } = parsed;
  return {
    params: node.parameters.map((p) => p.getText(sf)).join(', '),
    body: node.body.getText(sf),
    isBlockBody: ts.isBlock(node.body),
  };
};

/** True when the expression is an arrow function or a function expression. */
export const isFunctionExpressionText = (expression: string): boolean => {
  const parsed = parseWholeExpression(expression);
  return parsed !== null && (ts.isArrowFunction(parsed.node) || ts.isFunctionExpression(parsed.node));
};
