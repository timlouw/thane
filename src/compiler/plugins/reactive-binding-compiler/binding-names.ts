/**
 * The compiled binding function (`__b`) closes over the setup's scope, and the variables it declares for
 * itself come first. A template expression that reads a setup variable, an import or a global of the same
 * name would read the compiler's variable instead, so such a name is a build error (THANE012) rather than
 * a wrong value at runtime.
 *
 * Every name the compiler declares around user code starts with `_`: `_subs`, `_r`, a bound element's
 * `_b3`, a row's `_el`, the event parameter `_e`. Names the template declares itself (a row's `(it) =>`,
 * a handler's `(e) =>`) are the developer's, and are not counted.
 */
import ts from 'typescript';
import { ErrorCode } from '../../errors.js';

const COMPILER_NAME = /^_/;

const addBindingNames = (name: ts.BindingName, into: Set<string>): void => {
  if (ts.isIdentifier(name)) into.add(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) addBindingNames(element.name, into);
};

/** The compiler's names the binding function's code declares, at any depth. */
const compilerNames = (bindingsBody: string): Set<string> => {
  const names = new Set<string>();
  const file = ts.createSourceFile('__b.js', `(() => {\n${bindingsBody}\n})`, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) addBindingNames(node.name, names);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return new Set([...names].filter((name) => COMPILER_NAME.test(name)));
};

/**
 * The names a template's expressions read from outside the template (`read`), and the names functions
 * inside it declare (`bound`): identifiers that are not property names. Nested templates are part of
 * their parent's expressions.
 */
const templateNames = (template: ts.TaggedTemplateExpression, read: Set<string>, bound: Set<string>): void => {
  const visit = (node: ts.Node, inScope: ReadonlySet<string>): void => {
    if (ts.isFunctionLike(node)) {
      const inner = new Set(inScope);
      for (const parameter of node.parameters) addBindingNames(parameter.name, inner);
      for (const name of inner) bound.add(name);
      ts.forEachChild(node, (child) => {
        if (!ts.isParameter(child)) visit(child, inner);
      });
      return;
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isPropertyName && !inScope.has(node.text)) read.add(node.text);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, inScope));
  };
  if (ts.isTemplateExpression(template.template)) {
    for (const span of template.template.templateSpans) visit(span.expression, new Set());
  }
};

/** Throws THANE012 when a template in `setup` reads one of the compiler's names in the binding code. */
export const checkBindingNames = (setup: ts.Node, bindingsBody: string): void => {
  const read = new Set<string>();
  const bound = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'html') {
      templateNames(node, read, bound);
      return; // nested templates are read as part of this one
    }
    ts.forEachChild(node, visit);
  };
  visit(setup);
  const candidates = [...read].filter((name) => COMPILER_NAME.test(name) && !bound.has(name));
  if (candidates.length === 0) return;
  const declared = compilerNames(bindingsBody);
  const clashes = candidates.filter((name) => declared.has(name));
  if (clashes.length > 0) {
    const list = clashes.map((name) => `"${name}"`).join(', ');
    throw new Error(
      `${ErrorCode.BINDING_NAME_COLLISION}: this component's template reads ${list}, a name the compiled bindings use for a variable of their own, so it would read the compiler's value. Rename it: names that start with "_" are the compiler's.`,
    );
  }
};
