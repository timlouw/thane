/**
 * The names a component's templates see, for the signal detector: which are functions of the component,
 * and which signals each one reads.
 *
 * A zero-argument call in a template, `${count()}`, is a signal read, unless the name is a function the
 * component declares: `${total()}`, where `const total = () => price() * 2`, reads `price`, so the binding
 * follows `price`. A helper called with arguments, `${format(amount())}`, is followed on its arguments'
 * signals and on the ones its own body reads. Only a name the file declares as a function changes
 * anything: an imported or unknown name keeps being read as a signal, as a store's exported signal is.
 */

import ts from 'typescript';
import type { TemplateScope } from '../../utils/html-parser/index.js';

const SIGNAL_FACTORIES = new Set(['signal', 'computed']);

type Declared = { kind: 'signal' } | { kind: 'ref' } | { kind: 'function'; node: ts.FunctionLikeDeclaration };

const isFunctionNode = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/** The declarations of a list of statements that are signals or functions; a later one hides an earlier */
const declareFrom = (statements: readonly ts.Statement[], into: Map<string, Declared | null>): void => {
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      into.set(statement.name.text, { kind: 'function', node: statement });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        let init = declaration.initializer;
        while (init && (ts.isParenthesizedExpression(init) || ts.isAsExpression(init))) init = init.expression;
        const name = declaration.name.text;
        if (init && isFunctionNode(init)) into.set(name, { kind: 'function', node: init });
        else if (
          init &&
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          SIGNAL_FACTORIES.has(init.expression.text)
        ) {
          into.set(name, { kind: 'signal' });
        } else if (
          init &&
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          init.expression.text === 'ref'
        ) {
          into.set(name, { kind: 'ref' });
        } else into.set(name, null); // something else: not a function of the component
      }
    }
  }
};

/** Every name declared inside a function, its parameters included: they hide the component's */
const localNames = (fn: ts.FunctionLikeDeclaration): Set<string> => {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) addBinding(element.name);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node)) addBinding(node.name);
    else if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  for (const parameter of fn.parameters) addBinding(parameter.name);
  if (fn.body) visit(fn.body);
  return names;
};

/**
 * The template scope of a component: the file's top-level declarations, then the setup function's. An
 * exported fragment's is the file's alone.
 */
export const templateScopeOf = (sourceFile: ts.SourceFile, setup?: ts.FunctionLikeDeclaration): TemplateScope => {
  const declared = new Map<string, Declared | null>();
  declareFrom(sourceFile.statements, declared);
  if (setup?.body && ts.isBlock(setup.body)) declareFrom(setup.body.statements, declared);

  const reads = new Map<string, string[]>();
  const readsOf = (name: string, visiting: Set<string>): string[] => {
    const cached = reads.get(name);
    if (cached) return cached;
    const entry = declared.get(name);
    if (!entry || entry.kind !== 'function' || visiting.has(name)) return [];
    visiting.add(name);
    const fn = entry.node;
    const locals = localNames(fn);
    const found = new Set<string>();
    // Inside a helper, only what is known to be a signal counts: an unknown name there may be a plain function
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && !locals.has(callee.text)) {
          const inner = declared.get(callee.text);
          if (inner?.kind === 'signal' && node.arguments.length === 0) found.add(callee.text);
          else if (inner?.kind === 'function') for (const signal of readsOf(callee.text, visiting)) found.add(signal);
        } else if (
          node.arguments.length === 0 &&
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'props' &&
          !locals.has('props')
        ) {
          found.add(`props.${callee.name.text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    if (fn.body) visit(fn.body);
    visiting.delete(name);
    const list = [...found];
    reads.set(name, list);
    return list;
  };

  return {
    isFunction: (name) => declared.get(name)?.kind === 'function',
    isRef: (name) => declared.get(name)?.kind === 'ref',
    readsOf: (name) => readsOf(name, new Set()),
  };
};
