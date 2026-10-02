/** Helpers shared by the lint rules. */

import ts from 'typescript';
import type { Diagnostic, DiagnosticSeverity } from '../../../types.js';
import { createDiagnostic } from '../../../errors.js';
import { isDefineComponentCall } from '../../../utils/ast-utils.js';
import { FN } from '../../../utils/constants.js';

/** 1-based line and column of a node's first token (after comments and whitespace). */
export const locate = (sourceFile: ts.SourceFile, node: ts.Node): { line: number; column: number } => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
};

/** Records a diagnostic located at `node`. */
export type Report = (node: ts.Node, message: string) => void;

/**
 * The diagnostics of one rule run, and `report`, which adds one with the rule's code and severity,
 * located in `filePath` at the node's first token.
 */
export const createReporter = (
  sourceFile: ts.SourceFile,
  filePath: string,
  code: string,
  severity: DiagnosticSeverity,
): { diagnostics: Diagnostic[]; report: Report } => {
  const diagnostics: Diagnostic[] = [];
  const report: Report = (node, message) => {
    diagnostics.push(createDiagnostic(severity, message, { file: filePath, ...locate(sourceFile, node) }, code));
  };
  return { diagnostics, report };
};

const SIGNAL_FACTORIES: ReadonlySet<string> = new Set(['signal', 'computed']);

/** Whether a declaration's name (or one of the names it destructures) is `name` */
const bindsName = (binding: ts.BindingName, name: string): boolean =>
  ts.isIdentifier(binding)
    ? binding.text === name
    : binding.elements.some((element) => !ts.isOmittedExpression(element) && bindsName(element.name, name));

const unwrapInitializer = (node: ts.Expression | undefined): ts.Expression | undefined => {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node))
  ) {
    node = node.expression;
  }
  return node;
};

/** What the statements of one scope declare under `name`: a signal, something else, or nothing */
const declaredIn = (statements: readonly ts.Statement[], name: string): 'signal' | 'other' | undefined => {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!bindsName(declaration.name, name)) continue;
        const init = unwrapInitializer(declaration.initializer);
        const isSignal =
          ts.isIdentifier(declaration.name) &&
          !!init &&
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          SIGNAL_FACTORIES.has(init.expression.text);
        return isSignal ? 'signal' : 'other';
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return 'other';
    } else if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      const named = clause.namedBindings;
      if (
        clause.name?.text === name ||
        (named && ts.isNamespaceImport(named) && named.name.text === name) ||
        (named && ts.isNamedImports(named) && named.elements.some((element) => element.name.text === name))
      ) {
        return 'other';
      }
    }
  }
  return undefined;
};

/**
 * Whether `id`, a read of a name, reads a signal the file declares: the nearest declaration of the name, through
 * the scopes around the read, is `const name = signal(…)` or `computed(…)`. A parameter, any other declaration,
 * and an import (a store's signal is one) are not: the type check reports what a lint cannot see.
 */
export const readsDeclaredSignal = (id: ts.Identifier): boolean => {
  const name = id.text;
  for (let node: ts.Node = id.parent; ; node = node.parent) {
    if (ts.isFunctionLike(node) && node.parameters.some((parameter) => bindsName(parameter.name, name))) return false;
    if (
      (ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isForStatement(node)) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.initializer) &&
      node.initializer.declarations.some((declaration) => bindsName(declaration.name, name))
    ) {
      return false;
    }
    if (ts.isCatchClause(node) && node.variableDeclaration && bindsName(node.variableDeclaration.name, name)) {
      return false;
    }
    if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node)) {
      const declared = declaredIn(node.statements, name);
      if (declared) return declared === 'signal';
    }
    if (ts.isSourceFile(node)) return false;
  }
};

/** A `${…}` of an html template: its expression, and the template text before it (the literal it follows) */
export interface TemplateSlot {
  expression: ts.Expression;
  /** The literal text just before the `${` */
  before: string;
}

/** The `${…}` slots of an html template */
export const slotsOf = (template: ts.TaggedTemplateExpression): TemplateSlot[] => {
  const literal = template.template;
  if (!ts.isTemplateExpression(literal)) return [];
  return literal.templateSpans.map((span, i) => ({
    expression: span.expression,
    before: i === 0 ? literal.head.text : literal.templateSpans[i - 1]!.literal.text,
  }));
};

/** The event a slot handles, when the text before it is an event attribute (`@click=`, `@keydown.enter="`) */
export const eventOfSlot = (slot: TemplateSlot): string | undefined =>
  /@([\w:-]+)(?:\.[\w-]+)*=["']?$/.exec(slot.before)?.[1];

/** Tags of the templates the compiler resolves at compile time. */
export const TEMPLATE_TAGS: readonly string[] = [FN.HTML, FN.CSS];

/** A `defineComponent(…)` call whose callee is the plain identifier (not `lib.defineComponent`). */
export const isDefineComponentExpr = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && isDefineComponentCall(node);

/** A tagged template whose tag is a plain identifier in `names` (html`…`, not lib.html`…`). */
export const isTaggedWith = (
  node: ts.Node,
  names: readonly string[],
): node is ts.TaggedTemplateExpression & { readonly tag: ts.Identifier } =>
  ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && names.includes(node.tag.text);

/**
 * The keyword a declaration list is reported as: 'const' when the Const flag is set (`await using`
 * included), 'let', 'using', otherwise 'var'.
 */
export const declarationKeyword = (list: ts.VariableDeclarationList): 'const' | 'let' | 'var' | 'using' =>
  list.flags & ts.NodeFlags.Const
    ? 'const'
    : list.flags & ts.NodeFlags.Let
      ? 'let'
      : list.flags & ts.NodeFlags.Using
        ? 'using'
        : 'var';
