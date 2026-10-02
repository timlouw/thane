/**
 * JavaScript's own control flow in a template, turned into the directives it means before the parser reads
 * the template's text:
 *
 *   ${open() ? html`<p>Open</p>` : html`<p>Closed</p>`}   →  ${when(open(), html`<p>Open</p>`, html`<p>Closed</p>`)}
 *   ${open() && html`<p>Open</p>`}                        →  ${when(open(), html`<p>Open</p>`)}
 *   ${a() ? x : b() ? y : z}                              →  ${when(a(), x, html`${when(b(), y, z)}`)}
 *   ${items().map((item) => html`<li>${item}</li>`)}      →  ${repeat(items(), (item) => html`<li>${item}</li>`)}
 *
 * A branch is a template: an html template, a fragment, a child component call, another such expression, or
 * nothing (`null`, `undefined`, `false`, `''`). A ternary whose branches are neither (text) is left as it is: it
 * is a text binding. One with a template on one side and text on the other is a build error (THANE404): a
 * template there would never be compiled.
 *
 * And `when()`'s narrowing form, whose then-branch is a function of the condition's value:
 *
 *   ${when(user(), (u) => html`<p>${u.name}</p>`)}        →  ${when(user(), html`<p>${user().name}</p>`)}
 *
 * The branch reads the value again wherever it reads the parameter, so each of its bindings follows the
 * condition's signals.
 */
import ts from 'typescript';
import { ErrorCode } from '../../errors.js';
import { findTemplateExpressions } from '../../utils/html-parser/index.js';
import { isHtmlTemplate, replaceReferences } from '../../utils/index.js';
import { FN } from '../../utils/constants.js';

/** What the desugaring needs from the template inliner */
export interface BranchText {
  /** Whether a name stands for a template where one goes (a fragment) */
  isFragment(node: ts.Identifier): boolean;
  /** Whether a call is a child component call */
  isComponent(node: ts.CallExpression): boolean;
  /** The inlined text of an html template */
  template(node: ts.TaggedTemplateExpression): string;
  /** The markup a fragment name stands for (its text, or its placeholder) */
  name(node: ts.Identifier): string;
  /** The placeholder of a child component call */
  call(node: ts.CallExpression): string;
}

const unwrap = (node: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};

/** `null`, `undefined`, `false` or an empty string: a branch that shows nothing */
const isNothing = (node: ts.Expression): boolean =>
  node.kind === ts.SyntaxKind.NullKeyword ||
  node.kind === ts.SyntaxKind.FalseKeyword ||
  (ts.isIdentifier(node) && node.text === 'undefined') ||
  ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === '');

const isHtml = (node: ts.Expression): node is ts.TaggedTemplateExpression =>
  ts.isTaggedTemplateExpression(node) && isHtmlTemplate(node);

/** A `.map()` whose callback's concise body is a template or a child call: a list */
const mapCall = (node: ts.Expression): { items: ts.Expression; row: ts.ArrowFunction } | null => {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return null;
  const callee = node.expression;
  const row = node.arguments[0]!;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'map' || !ts.isArrowFunction(row)) return null;
  if (ts.isBlock(row.body)) return null;
  const body = unwrap(row.body);
  return isHtml(body) || ts.isCallExpression(body) ? { items: callee.expression, row } : null;
};

const isAnd = (node: ts.Expression): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;

/**
 * The directive call a `${}` expression means (without `${` and `}`), or null when it is not template control
 * flow. Its branches are inlined through `text`, once each.
 */
export const desugar = (expr: ts.Expression, sourceFile: ts.SourceFile, text: BranchText): string | null => {
  const source = (n: ts.Node): string => n.getText(sourceFile);

  /** What a branch is, without inlining anything */
  const kindOf = (raw: ts.Expression): 'nothing' | 'template' | 'text' => {
    const n = unwrap(raw);
    if (isNothing(n)) return 'nothing';
    if (isHtml(n)) return 'template';
    if (ts.isIdentifier(n)) return text.isFragment(n) ? 'template' : 'text';
    if (ts.isConditionalExpression(n) || isAnd(n) || mapCall(n)) return isControlFlow(n) ? 'template' : 'text';
    if (ts.isCallExpression(n)) return text.isComponent(n) ? 'template' : 'text';
    return 'text';
  };

  /** Whether an expression is template control flow; a ternary of a template and text is THANE404 */
  const isControlFlow = (raw: ts.Expression): boolean => {
    const n = unwrap(raw);
    if (ts.isConditionalExpression(n)) {
      const kinds = [kindOf(n.whenTrue), kindOf(n.whenFalse)];
      if (!kinds.includes('template')) return false;
      if (kinds.includes('text')) {
        const other = kinds[0] === 'text' ? n.whenTrue : n.whenFalse;
        throw new Error(
          `${ErrorCode.NO_NESTED_HTML_TAGS}: one branch of ${source(n)} is a template and the other is not: ${source(other)}. ` +
            'Each branch of a ternary of templates is a template, a fragment, a component call, or null.',
        );
      }
      return true;
    }
    if (isAnd(n)) return kindOf(n.right) === 'template';
    return mapCall(n) !== null;
  };

  /** A template branch as a directive's template argument, or '' for nothing */
  const branch = (raw: ts.Expression): string => {
    const n = unwrap(raw);
    if (isNothing(n)) return '';
    if (isHtml(n)) return `html\`${text.template(n)}\``;
    if (ts.isIdentifier(n)) return `html\`${text.name(n)}\``;
    if (ts.isCallExpression(n) && !mapCall(n)) return `html\`${text.call(n)}\``;
    return `html\`\${${build(n)}}\``;
  };

  const build = (n: ts.Expression): string => {
    if (ts.isConditionalExpression(n)) {
      const condition = source(n.condition);
      const then = branch(n.whenTrue);
      const otherwise = branch(n.whenFalse);
      if (then === '') return `${FN.WHEN}(!(${condition}), ${otherwise})`;
      return otherwise === '' ? `${FN.WHEN}(${condition}, ${then})` : `${FN.WHEN}(${condition}, ${then}, ${otherwise})`;
    }
    if (isAnd(n)) return `${FN.WHEN}(${source(n.left)}, ${branch(n.right)})`;
    const list = mapCall(n)!;
    const params = list.row.parameters.map(source).join(', ');
    const body = unwrap(list.row.body as ts.Expression);
    // A row that is a child component call stays one: repeat() mounts the component for each item
    const row = isHtml(body) ? `html\`${text.template(body)}\`` : source(body);
    return `${FN.REPEAT}(${source(list.items)}, (${params}) => ${row})`;
  };

  const node = unwrap(expr);
  return isControlFlow(node) ? build(node) : null;
};

/** Whether `expr` can be repeated wherever it is read without parentheses: a name, a call, a member or an element of one */
const isSimple = (expr: ts.Expression): boolean => {
  const n = unwrap(expr);
  if (ts.isIdentifier(n)) return true;
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) return isSimple(n.expression);
  if (ts.isCallExpression(n)) return isSimple(n.expression);
  return false;
};

/**
 * The narrowing form's then-branch, `(value) => html\`…\``: the parameter's name, the text that reads the value
 * again (the condition, in parentheses unless it is a name, a call or a member of one), and the body template.
 * Throws THANE014 for a function that does not take one named parameter, or whose body is not an html template.
 */
export const narrowing = (
  call: ts.CallExpression,
  fn: ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile,
): { param: string; value: string; body: ts.TaggedTemplateExpression } => {
  const written = call.getText(sourceFile);
  const fail = (what: string): never => {
    throw new Error(
      `${ErrorCode.WHEN_ARGUMENTS}: when()'s then-branch is a function of the condition's value ${what}: ${written}. ` +
        'Write it (value) => html`…`, which receives the value without null and undefined.',
    );
  };
  const [param, ...rest] = fn.parameters;
  if (!param || rest.length > 0 || !ts.isIdentifier(param.name)) return fail('that takes one parameter, a name');
  const body = ts.isArrowFunction(fn) && !ts.isBlock(fn.body) ? unwrap(fn.body) : undefined;
  if (!body || !isHtml(body)) return fail('whose body is an html template');
  const condition = call.arguments[0]!;
  const value = isSimple(condition) ? condition.getText(sourceFile) : `(${condition.getText(sourceFile)})`;
  return { param: (param.name as ts.Identifier).text, value, body };
};

/** A template's text with each read of `name` in its expressions replaced by `value` (nested templates included) */
export const substituteInTemplate = (template: string, name: string, value: string): string => {
  let out = '';
  let last = 0;
  for (const span of findTemplateExpressions(template)) {
    out += template.slice(last, span.start) + '${' + replaceReferences(span.expression, name, value) + '}';
    last = span.end;
  }
  return out + template.slice(last);
};
