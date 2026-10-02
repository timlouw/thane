/** Reactive binding compiler — source transformation and template processing. */

import ts from 'typescript';
import type { ImportInfo, TemplateInfo } from '../../types.js';
import {
  findSignalInitializers,
  findComponentDeclarations,
  type ComponentDeclaration,
  findExportedFragments,
  type FragmentDeclaration,
  isHtmlTemplate,
  applyEdits,
  type SourceEdit,
  sourceCache,
  replaceReferences,
  expressionReferencesIdentifier,
  BIND_FN,
  FN,
} from '../../utils/index.js';
import { getSetupFunction, unwrapParens } from '../../utils/component-ast.js';
import { checkBindingNames } from './binding-names.js';
import type {
  BindingInfo,
  ChildMountInfo,
  ConditionalBlock,
  WhenElseBlock,
  RepeatBlock,
  EventBinding,
  EmitOptions,
  TemplateNames,
} from './types.js';
import { minifyHTML } from '../minification/template-minifier.js';
import { compileCssTemplate, declaresOwnCssTag, isCssTaggedTemplate } from '../minification/css-transform.js';
import type { SelectorMap } from '../minification/selector-minifier.js';
import { processHtmlTemplateWithConditionals } from './template-processing.js';
import { anchorMark } from './template-utils.js';
import { placeChildHosts } from './child-hosts.js';
import { walkDirectives } from './directive-tree.js';
import { refInRow } from './repeat-analysis.js';
import { setTemplateScope } from '../../utils/html-parser/index.js';
import { templateScopeOf } from './template-scope.js';
import { desugar, narrowing, substituteInTemplate, type BranchText } from './control-flow.js';

// ============================================================================
// Lifecycle hook stripping
// ============================================================================

/** Property names eligible for dead-code removal when their body is empty */
const STRIPPABLE_LIFECYCLE = new Set(['onMount', 'onDestroy']);

/** Properties that should be stripped when a compiled template is injected */
const STRIPPABLE_TEMPLATE = new Set(['template']);

/** A hook that does nothing: an arrow function, a function expression or a method whose block body is empty. */
const isEmptyHook = (node: ts.Node): boolean =>
  (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) &&
  !!node.body &&
  ts.isBlock(node.body) &&
  node.body.statements.length === 0;

/** The name of a return object's property, written as an identifier or a string; null for any other */
const propertyName = (prop: ts.ObjectLiteralElementLike): string | null =>
  prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : null;

/**
 * The setup function's return objects, in source order: every `return {…}` in its body,
 * at any depth, but not inside a nested function-like (arrow, function expression or
 * declaration, method, accessor, constructor). A concise body's object literal is its single
 * return. With several, the last one is the component's (THANE412 reports the others).
 */
export const findReturnObjects = (setup: ts.ArrowFunction | ts.FunctionExpression): ts.ObjectLiteralExpression[] => {
  if (!ts.isBlock(setup.body)) {
    const body = unwrapParens(setup.body);
    return ts.isObjectLiteralExpression(body) ? [body] : [];
  }
  const objects: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      objects.push(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(setup.body, visit);
  return objects;
};

/** Calls a setup makes that create nothing a component owns: thane's signals, components and template markers */
const OWNERLESS_CALLS: ReadonlySet<string> = new Set([
  'signal',
  'batch',
  'untrack',
  'defineComponent',
  'ref',
  FN.HTML,
  FN.CSS,
  FN.WHEN,
  FN.REPEAT,
]);

/** Calls that create what the running setup or effect owns */
const OWNED_CALLS: ReadonlySet<string> = new Set(['computed', 'effect', 'onCleanup']);

/**
 * Whether a component's setup may create what the component disposes when it is destroyed (a computed, an
 * effect, an onCleanup function): it calls computed(), effect() or onCleanup(), or, while it runs, makes any call
 * or `new` other than thane's signals and markers (a helper may create them). A call inside a function the setup
 * declares, such as a handler, runs later, outside the setup, and owns nothing. (A component with `onMount` has
 * the full factory anyway.)
 */
const createsOwned = (setup: ts.FunctionLikeDeclaration): boolean => {
  let found = false;
  const visit = (node: ts.Node, running: boolean): void => {
    if (found) return;
    // A template's expressions are compiled into the binding code, which runs after the setup
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      (node.tag.text === FN.HTML || node.tag.text === FN.CSS)
    ) {
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : undefined;
      if ((callee && OWNED_CALLS.has(callee)) || (running && !(callee && OWNERLESS_CALLS.has(callee)))) {
        found = true;
        return;
      }
    }
    const runsNow = running && !ts.isFunctionLike(node);
    ts.forEachChild(node, (child) => visit(child, runsNow));
  };
  if (setup.body) ts.forEachChild(setup.body, (child) => visit(child, true));
  return found;
};

/** Detect the styles/lifecycle feature flags of the defineComponent return object. */
const detectFeatures = (
  returnObj: ts.ObjectLiteralExpression | undefined,
): { hasStyles: boolean; hasLifecycle: boolean } => {
  let hasStyles = false;
  let hasLifecycle = false;

  for (const prop of returnObj?.properties ?? []) {
    const name = propertyName(prop);
    if (!name) continue;
    // Inline css``, an imported stylesheet or a variable
    if (name === 'styles') hasStyles = true;
    // A hook in any form (`onMount: () => …`, `onMount() {…}`, `onMount: start`, `{ onMount }`), unless it does nothing
    const hook = ts.isPropertyAssignment(prop) ? prop.initializer : prop;
    if (STRIPPABLE_LIFECYCLE.has(name) && !isEmptyHook(hook)) hasLifecycle = true;
  }

  return { hasStyles, hasLifecycle };
};

/**
 * The removals that strip empty lifecycle hooks, and the `template` property once the template
 * is compiled, from the component's return object. Styles and non-empty hooks are kept: the
 * runtime needs them.
 */
const deadPropertyRemovals = (
  source: string,
  sf: ts.SourceFile,
  returnObj: ts.ObjectLiteralExpression,
  hasCompiledTemplate: boolean,
): SourceEdit[] => {
  const removals: SourceEdit[] = [];

  for (const prop of returnObj.properties) {
    // A shorthand property is a variable, which may be read elsewhere: it stays
    if (!ts.isPropertyAssignment(prop) && !ts.isMethodDeclaration(prop)) continue;
    const name = propertyName(prop);
    if (!name) continue;

    // ── Strippable properties ──
    const hook = ts.isPropertyAssignment(prop) ? prop.initializer : prop;
    const shouldStripLifecycle = STRIPPABLE_LIFECYCLE.has(name) && isEmptyHook(hook);
    const shouldStripTemplate = hasCompiledTemplate && STRIPPABLE_TEMPLATE.has(name) && ts.isPropertyAssignment(prop);

    if (!shouldStripLifecycle && !shouldStripTemplate) continue;

    // Calculate the full removal range including leading/trailing comma + whitespace
    let start = prop.getStart(sf);
    let end = prop.getEnd();

    // Extend to eat the trailing comma if present
    const textAfter = source.substring(end);
    const trailingCommaMatch = textAfter.match(/^\s*,/);
    if (trailingCommaMatch) {
      end += trailingCommaMatch[0].length;
    }

    // Extend to eat the preceding whitespace/newline so we don't leave blank lines
    const textBefore = source.substring(0, start);
    const precedingWhitespaceMatch = textBefore.match(/[\t ]*$/);
    if (precedingWhitespaceMatch) {
      start -= precedingWhitespaceMatch[0].length;
      // Also eat a preceding newline if present
      if (start > 0 && source[start - 1] === '\n') {
        start--;
        if (start > 0 && source[start - 1] === '\r') start--;
      }
    }

    removals.push({ start, end, replacement: '' });
  }

  return removals;
};
import { generateInitBindingsFunction, generateStaticTemplate, generateUpdatedImport } from './codegen.js';

/** The order a compiled component imports runtime helpers in; a helper not listed here goes last. */
const HELPER_IMPORT_ORDER: readonly string[] = [
  BIND_FN.REGISTER_COMPONENT,
  BIND_FN.REGISTER_COMPONENT_LEAN,
  BIND_FN.IF,
  BIND_FN.IF_EXPR,
  BIND_FN.KEYED_RECONCILER,
  BIND_FN.SIGNAL,
  BIND_FN.ENABLE_STYLES,
  BIND_FN.DESTROY_CHILD,
  BIND_FN.ROW_CHILD,
];
const importRank = (helper: string): number => {
  const rank = HELPER_IMPORT_ORDER.indexOf(helper);
  return rank === -1 ? HELPER_IMPORT_ORDER.length : rank;
};

/**
 * The import declaration that imports `defineComponent`, or else `html` (a module of fragments only): the
 * compiler's helpers are imported next to it.
 */
export const findServicesImport = (sourceFile: ts.SourceFile): ImportInfo | null =>
  importOf(sourceFile, 'defineComponent') ?? importOf(sourceFile, FN.HTML);

const importOf = (sourceFile: ts.SourceFile, name: string): ImportInfo | null => {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    const namedImports = namedBindings.elements.map((element) => element.name.text);
    if (!namedImports.includes(name)) continue;

    const fullText = statement.moduleSpecifier.getFullText(sourceFile);
    return {
      namedImports,
      moduleSpecifier: statement.moduleSpecifier.text,
      start: statement.getStart(sourceFile),
      end: statement.getEnd(),
      quoteChar: fullText.includes("'") ? "'" : '"',
    };
  }
  return null;
};

// ============================================================================
// defineComponent Support
// ============================================================================

/** Where a directive call takes a template: when()'s branches, and repeat()'s `empty` option */
export const templateArguments = (call: ts.CallExpression): ts.Expression[] => {
  if (!ts.isIdentifier(call.expression)) return [];
  if (call.expression.text === FN.WHEN) return call.arguments.slice(1, 3);
  const options = call.expression.text === FN.REPEAT ? call.arguments[2] : undefined;
  if (!options || !ts.isObjectLiteralExpression(options)) return [];
  // `empty: spinner`, or the shorthand `{ empty }` of a fragment named empty
  return options.properties.flatMap((p) =>
    ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'empty'
      ? [p.initializer]
      : ts.isShorthandPropertyAssignment(p) && p.name.text === 'empty'
        ? [p.name]
        : [],
  );
};

/** A child component or imported fragment of a template, and its index in the file, which names its variables */
interface OwnMount {
  cm: ChildMountInfo;
  globalIndex: number;
  /** The row signals of the lists around the directive that mounts it whose items its props read */
  follows?: string[];
}

/**
 * The row signals (`item$`, `index$`) of the lists in `rows` (outermost first) whose item or index `props`
 * reads, each added to its list's row signals. A name of an inner list (`own`, the list whose row holds the
 * child, included) shadows the same name of an outer one.
 */
const followedRows = (props: string, rows: readonly RepeatBlock[], own?: RepeatBlock): string[] => {
  const shadowed = new Set(own ? [own.itemVar, own.indexVar] : []);
  const follows: string[] = [];
  for (let k = rows.length - 1; k >= 0; k--) {
    const row = rows[k]!;
    for (const name of [row.itemVar, row.indexVar]) {
      if (!name || shadowed.has(name) || !expressionReferencesIdentifier(props, name)) continue;
      const signal = `${name}$`;
      row.rowSignalVars ??= [];
      if (!row.rowSignalVars.includes(signal)) row.rowSignalVars.push(signal);
      follows.push(signal);
    }
    shadowed.add(row.itemVar).add(row.indexVar);
  }
  return follows;
};

/**
 * Where a component's templates find their fragments, the uses of each fragment that were inlined, and the
 * children and imported fragments the templates hold, each given its placeholder as the text is read
 */
interface InlineScope {
  sourceFile: ts.SourceFile;
  /** The component's setup function; the module is looked in after it */
  scopeRoot: ts.Node;
  /** Each fragment inlined, by its template, with the names that used it */
  inlined: Map<ts.TaggedTemplateExpression, Set<ts.Identifier>>;
  file: FileCompilation;
  /** The children and imported fragments found, in the order their placeholders were written */
  mounts: OwnMount[];
}

/**
 * The placeholder of a child component call (`Card({ … })`, to a component the file can call) or of an imported
 * fragment named (`Spinner`), recorded in the scope's mounts; null for anything else. An imported fragment
 * without `${}` is written out in its place instead.
 */
const placeholderOf = (node: ts.Expression, scope: InlineScope): string | null => {
  const { file, sourceFile } = scope;
  const add = (cm: Omit<ChildMountInfo, 'anchorId'>): string => {
    const anchorId = `b${file.nextId++}`;
    scope.mounts.push({ cm: { ...cm, anchorId }, globalIndex: file.mountCount++ });
    return anchorMark(anchorId, '.');
  };
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const component = file.names.components.get(node.expression.text);
    if (!component) return null;
    const props = node.arguments[0];
    return add({
      componentName: node.expression.text,
      selector: component.selector,
      propsExpression: props ? props.getText(sourceFile) : '{}',
    });
  }
  if (ts.isIdentifier(node)) {
    const fragment = file.names.fragments.get(node.text);
    if (!fragment) return null;
    return fragment.staticText ?? add({ componentName: node.text, selector: '', propsExpression: '', fragment: true });
  }
  return null;
};

/**
 * The text of an html template, with the fragments it uses inlined, at any depth: a `${name}` that names an
 * html`` const of the component or the module, an html template written as a whole `${}`, and, inside any
 * other `${}`, a fragment named where a directive takes a template (`when(open(), details, summary)`)
 * and the html templates written in it. A child component call and an imported fragment get their placeholder
 * (placeholderOf), as a whole `${}` and where a directive takes a template. JavaScript's control flow in
 * content, a ternary of templates, `cond && html\`…\`` and `items.map((item) => html\`…\`)`, becomes the
 * directive it means, and so does when()'s narrowing form (see control-flow.ts). The text is taken as written
 * (raw), like every directive template the parser cuts from it: the escape sequences stay in place until the
 * template is emitted. `path` holds the fragments being inlined, so a fragment that uses itself is left as it is
 * written.
 */
const extractAndInlineFragment = (
  tplNode: ts.TaggedTemplateExpression,
  scope: InlineScope,
  path: ReadonlySet<string> = new Set(),
): string => {
  const { sourceFile } = scope;
  const templateLiteral = tplNode.template;

  if (ts.isNoSubstitutionTemplateLiteral(templateLiteral)) {
    return templateLiteral.rawText!;
  }

  if (!ts.isTemplateExpression(templateLiteral)) return '';

  /** The text of the fragment `name` names, or null when it names none */
  const fragment = (name: ts.Identifier): string | null => {
    if (path.has(name.text)) return null;
    const resolved = resolveTemplateIdentifier(sourceFile, scope.scopeRoot, name);
    if (!resolved) return null;
    const uses = scope.inlined.get(resolved) ?? new Set();
    scope.inlined.set(resolved, uses.add(name));
    return extractAndInlineFragment(resolved, scope, new Set([...path, name.text]));
  };
  const template = (node: ts.TaggedTemplateExpression): string => extractAndInlineFragment(node, scope, path);
  const branches: BranchText = {
    isFragment: (name) =>
      (!path.has(name.text) && resolveTemplateIdentifier(sourceFile, scope.scopeRoot, name) !== null) ||
      scope.file.names.fragments.has(name.text),
    isComponent: (call) => ts.isIdentifier(call.expression) && scope.file.names.components.has(call.expression.text),
    template,
    name: (name) => fragment(name) ?? placeholderOf(name, scope)!,
    call: (call) => placeholderOf(call, scope)!,
  };

  let content = templateLiteral.head.rawText!;
  // The markup so far, each `${}` standing as one character: whether a span is in an element's tag
  let markup = content;
  for (const span of templateLiteral.templateSpans) {
    const expr = span.expression;
    const inTag = /<[A-Za-z][^<>]*$/.test(markup);
    markup += '_' + span.literal.rawText!;
    const flow = inTag ? null : desugar(expr, sourceFile, branches);
    if (flow !== null) {
      content += '${' + flow + '}' + span.literal.rawText!;
      continue;
    }
    const inlined = ts.isIdentifier(expr)
      ? (fragment(expr) ?? placeholderOf(expr, scope))
      : ts.isTaggedTemplateExpression(expr) && isHtmlTemplate(expr)
        ? template(expr)
        : placeholderOf(expr, scope);
    content += inlined ?? '${' + inlineInExpression(expr, sourceFile, fragment, template, scope) + '}';
    content += span.literal.rawText!;
  }
  return content;
};

/**
 * The text of a `${}` expression, with the fragments named where a directive takes a template, and the html
 * templates written in it, inlined (see extractAndInlineFragment). A child component call or an imported fragment
 * where a directive takes a template becomes a template of its placeholder. A template left as it is keeps its text.
 */
const inlineInExpression = (
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  fragment: (name: ts.Identifier) => string | null,
  template: (node: ts.TaggedTemplateExpression) => string,
  scope: InlineScope,
): string => {
  const start = expr.getStart(sourceFile);
  const edits: SourceEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && isHtmlTemplate(node)) {
      const text = template(node);
      const literal = node.template;
      if (text !== literal.getText(sourceFile).slice(1, -1)) {
        edits.push({
          start: literal.getStart(sourceFile) - start,
          end: literal.getEnd() - start,
          replacement: `\`${text}\``,
        });
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      // when(value, (v) => html`…`, …): the branch reads the value again wherever it reads v
      const fn = node.arguments[1];
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === FN.WHEN &&
        fn &&
        (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
      ) {
        const { param, value, body } = narrowing(node, fn, sourceFile);
        const before = scope.mounts.length;
        const text = substituteInTemplate(template(body), param, value);
        // The children in the branch read it in their props too
        for (const mount of scope.mounts.slice(before)) {
          mount.cm.propsExpression = replaceReferences(mount.cm.propsExpression, param, value);
        }
        edits.push({
          start: fn.getStart(sourceFile) - start,
          end: fn.getEnd() - start,
          replacement: `html\`${text}\``,
        });
        for (const arg of node.arguments) if (arg !== fn) visit(arg);
        return;
      }
      for (const arg of templateArguments(node)) {
        const text = (ts.isIdentifier(arg) ? fragment(arg) : null) ?? placeholderOf(arg, scope);
        if (arg && text !== null) {
          // A shorthand property keeps its name: `{ empty }` → `{ empty: html\`…\` }`
          const name = ts.isShorthandPropertyAssignment(arg.parent) ? `${arg.getText(sourceFile)}: ` : '';
          edits.push({
            start: arg.getStart(sourceFile) - start,
            end: arg.getEnd() - start,
            replacement: `${name}html\`${text}\``,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expr);
  return applyEdits(expr.getText(sourceFile), edits);
};

/** Every identifier of the file with the name `name` declares, other than the declaration and property names */
const referencesOf = (sourceFile: ts.SourceFile, name: ts.Identifier): ts.Identifier[] => {
  const found: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name.text && node !== name) {
      const parent = node.parent;
      const isPropertyName =
        ((ts.isPropertyAccessExpression(parent) ||
          ts.isPropertyAssignment(parent) ||
          ts.isPropertyDeclaration(parent)) &&
          parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node);
      if (!isPropertyName) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const resolveTemplateIdentifier = (
  sourceFile: ts.SourceFile,
  scopeRoot: ts.Node,
  identifier: ts.Identifier,
): ts.TaggedTemplateExpression | null => {
  let resolved: ts.TaggedTemplateExpression | null = null;

  const visit = (node: ts.Node) => {
    if (resolved) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === identifier.text) {
      if (node.initializer && ts.isTaggedTemplateExpression(node.initializer) && isHtmlTemplate(node.initializer)) {
        resolved = node.initializer;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(scopeRoot);
  if (resolved) return resolved;

  let moduleResolved: ts.TaggedTemplateExpression | null = null;
  const visitModule = (node: ts.Node) => {
    if (moduleResolved) return;
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== identifier.text) continue;
        if (decl.initializer && ts.isTaggedTemplateExpression(decl.initializer) && isHtmlTemplate(decl.initializer)) {
          moduleResolved = decl.initializer;
          return;
        }
      }
    }
    ts.forEachChild(node, visitModule);
  };
  visitModule(sourceFile);
  return moduleResolved;
};

/**
 * Find html`` templates in the setup's return objects only.
 * Fragment templates (const piece = html`...`) are intentionally skipped.
 */
const findHtmlTemplates = (
  sourceFile: ts.SourceFile,
  setupArg: ts.ArrowFunction | ts.FunctionExpression,
  returnObjects: ts.ObjectLiteralExpression[],
): TemplateInfo[] => {
  const templates: TemplateInfo[] = [];
  const seen = new Set<number>();

  const collectFromReturnObject = (obj: ts.ObjectLiteralExpression) => {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name) || prop.name.text !== 'template') continue;

      let tplNode: ts.TaggedTemplateExpression | null = null;
      if (ts.isTaggedTemplateExpression(prop.initializer) && isHtmlTemplate(prop.initializer)) {
        tplNode = prop.initializer;
      } else if (ts.isIdentifier(prop.initializer)) {
        tplNode = resolveTemplateIdentifier(sourceFile, setupArg, prop.initializer);
      }

      if (!tplNode) continue;
      const start = tplNode.getStart(sourceFile);
      if (seen.has(start)) continue;
      seen.add(start);
      templates.push({
        node: tplNode,
        templateStart: start,
        templateEnd: tplNode.getEnd(),
      });
    }
  };

  returnObjects.forEach(collectFromReturnObject);
  return templates;
};

/** What a production build asks of the compiler; a development build passes nothing. */
export interface CompileOptions {
  /** Minify each compiled template and stylesheet where it is emitted */
  minify?: boolean | undefined;
  /** Selector renames planned for this build (see minification/selector-minifier.ts) */
  selectorMap?: SelectorMap | undefined;
  /** Called when a compiled stylesheet defines `@keyframes` */
  onKeyframes?: (() => void) | undefined;
}

/**
 * Transform a defineComponent source file: compile its stylesheets, and each of its components'
 * templates and binding code. The file is parsed once, and every change is an edit positioned on
 * that parse, applied in one pass: a component's static templates before its statement, `__b` into
 * its return object, the registration name (and a derived selector) at its call, its template
 * (`__tpl`, `__tpl1`…) as the call's last argument.
 */
export const transformDefineComponentSource = (
  source: string,
  filePath: string,
  names?: TemplateNames,
  options: CompileOptions = {},
  parsed?: ts.SourceFile,
): string | null => {
  try {
    return transformComponent(source, filePath, names, options, parsed);
  } finally {
    // A component's scope is its own alone
    setTemplateScope(undefined);
  }
};

/** A component file as it is compiled: its one parse, its edits, and what its components share. */
interface FileCompilation {
  source: string;
  sourceFile: ts.SourceFile;
  /** Every change to the file, positioned on its one parse */
  edits: SourceEdit[];
  emit: EmitOptions;
  options: CompileOptions;
  /** The components the file's templates can call, and the fragments it imports */
  names: TemplateNames;
  /** The children and imported fragments found so far, which number the next one's variables */
  mountCount: number;
  /** Signals declared outside every component, with their initial values */
  moduleSignals: Map<string, string | number | boolean>;
  /** The next id. Ids are names inside the file: its components share one count. */
  nextId: number;
  /** The fragments the components' templates inlined, with the names that used them */
  inlined: Map<ts.TaggedTemplateExpression, Set<ts.Identifier>>;
}

/** What compiling one component contributes to its file */
interface CompiledComponent {
  statement: ts.VariableStatement;
  /** The static templates it declares, before its statement (they have no closure dependencies) */
  declarations: string;
  /** The runtime helpers it calls, its registration function first */
  helpers: string[];
  hasStyles: boolean;
  /** Its lists call Node's cloneNode and insertBefore */
  domPrototype: boolean;
}

/**
 * Transform a component source file: compile each component's templates, generate its binding code and
 * turn its call into the registration call, compile each exported fragment into its value, and compile the
 * file's stylesheets. The file is parsed once, and every change is an edit positioned on that parse,
 * applied in one pass.
 */
const transformComponent = (
  source: string,
  filePath: string,
  names: TemplateNames | undefined,
  options: CompileOptions,
  parsed: ts.SourceFile | undefined,
): string | null => {
  const sourceFile = parsed?.text === source ? parsed : sourceCache.parse(filePath, source);
  const components = findComponentDeclarations(sourceFile);
  const fragments = findExportedFragments(sourceFile);
  if (components.length === 0 && fragments.length === 0) return null;

  const file: FileCompilation = {
    source,
    sourceFile,
    edits: [],
    // A production build minifies templates and renames selectors
    emit: {
      html: options.minify ? minifyHTML : (template) => template,
      selector: (name) => options.selectorMap?.get(name) ?? name,
    },
    options,
    // Without the build's names (a test), the file's own components
    names: names ?? { components: new Map(components.map((c) => [c.name, c])), fragments: new Map() },
    mountCount: 0,
    moduleSignals: findSignalInitializers(sourceFile, new Set(components.map((component) => component.call))),
    // Ids count from 0 and do not depend on where the file is
    nextId: 0,
    inlined: new Map(),
  };
  const { edits } = file;

  // Strip css tags. The text is known to be a stylesheet here, so this is where it is
  // minified and where class selectors that address a renamed component host are renamed.
  const ownCssTag = declaresOwnCssTag(sourceFile);
  const visitCss = (node: ts.Node) => {
    if (!ownCssTag && isCssTaggedTemplate(node)) {
      edits.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        replacement: compileCssTemplate(node, sourceFile, options),
      });
      return; // a css template nested in a substitution is compiled along with this one
    }
    ts.forEachChild(node, visitCss);
  };
  visitCss(sourceFile);

  // Each component on its own (the first keeps the name `__tpl` for its template), then each exported fragment
  const compiled = [
    ...components.map((component, index) => compileComponent(file, component, index === 0 ? '__tpl' : `__tpl${index}`)),
    ...fragments.map((fragment, index) => compileFragment(file, fragment, `__frag${index}`)),
  ];

  // A file with a list imports Node's cloneNode and insertBefore from thane/runtime/dom, which every such
  // file of the app shares. One that imports thane by a path of its own (a test) declares the pair, once,
  // before its first component or fragment at the top level.
  const servicesImport = findServicesImport(sourceFile);
  const spec = servicesImport?.moduleSpecifier ?? '';
  const domPrototype = compiled.some((component) => component.domPrototype);
  const importsDomPrototype = domPrototype && (spec === 'thane' || spec.startsWith('thane/'));
  const hasStyles = compiled.some((component) => component.hasStyles);
  const hasTemplates = compiled.some((component) => component.declarations);
  if (domPrototype && !importsDomPrototype) {
    const inOrder = [...compiled].sort((a, b) => a.statement.pos - b.statement.pos);
    const first = inOrder.find((component) => component.statement.parent === sourceFile) ?? inOrder[0]!;
    first.declarations += '\n  const { cloneNode: _cloneNode, insertBefore: _insertBefore } = Node.prototype;';
  }

  // A fragment whose every use was inlined is left empty, so that its markup is not shipped twice
  for (const [fragment, uses] of file.inlined) {
    const declaration = fragment.parent;
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) continue;
    const at = fragment.template.getStart(sourceFile);
    if (edits.some((edit) => edit.start <= at && at < edit.end)) continue;
    if (referencesOf(sourceFile, declaration.name).every((reference) => uses.has(reference))) {
      edits.push({ start: at, end: fragment.getEnd(), replacement: '``' });
    }
  }

  for (const { statement, declarations } of compiled) {
    const code = declarations.trim();
    if (!code) continue;
    const at = statement.getStart(sourceFile);
    edits.push({ start: at, end: at, replacement: code + '\n\n' });
  }

  // Update imports: defineComponent goes, and the helpers the compiled code calls come from the
  // compiler's entry
  if (servicesImport) {
    const filteredImport: typeof servicesImport = {
      ...servicesImport,
      namedImports: servicesImport.namedImports.filter((n) => n !== 'defineComponent'),
    };
    // The registration functions, the styles switch, and exactly the helpers the binding code calls
    const used = new Set<string>(compiled.flatMap((component) => component.helpers));
    if (hasStyles) used.add(BIND_FN.ENABLE_STYLES);
    // The components' and the lists' templates are built by the runtime's __T
    if (hasTemplates) used.add(BIND_FN.TEMPLATE);
    const requiredFunctions = [...used].sort((a, b) => importRank(a) - importRank(b));

    const newImport = generateUpdatedImport(filteredImport, requiredFunctions, importsDomPrototype);
    edits.push({
      start: servicesImport.start,
      end: servicesImport.end,
      replacement: newImport,
    });
  }

  if (hasStyles) {
    edits.push({ start: source.length, end: source.length, replacement: '\n__enableComponentStyles();\n' });
  }

  // Every other html template of the file is empty at run time: nothing reads a template as a value, and its
  // expressions (a child call among them) must not run
  const emptyTemplates = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && isHtmlTemplate(node)) {
      const start = node.tag.getStart(sourceFile);
      const end = node.getEnd();
      if (!edits.some((edit) => edit.start < end && start < edit.end)) edits.push({ start, end, replacement: '``' });
      return;
    }
    ts.forEachChild(node, emptyTemplates);
  };
  emptyTemplates(sourceFile);

  return applyEdits(source, edits);
};

/** A component's or an exported fragment's templates, compiled */
interface CompiledTemplates {
  /** The template as emitted, the last one when there are several ('' when there is none) */
  template: string;
  /** The static template declarations: `templateName`'s and its lists' */
  staticTemplateCode: string;
  /** The binding function's body */
  bindingsBody: string;
  /** The runtime helpers the binding code calls */
  helpers: Set<string>;
  /** The binding code reads the template's elements (`_ns`) */
  elementList: boolean;
  /** Its lists call Node's cloneNode and insertBefore */
  domPrototype: boolean;
  /** There is anything to bind: without it, no binding function is needed */
  hasAnyBindings: boolean;
}

/**
 * Compile templates: inline their fragments, process them, place their children's hosts and generate the
 * binding code. `scopeRoot` is where fragments are looked for before the module. The template, when there
 * is one, is declared as `templateName`. For an exported fragment (`fragment`), the binding code places the
 * copy it binds (see generateInitBindingsFunction).
 */
const compileTemplates = (
  file: FileCompilation,
  templates: readonly ts.TaggedTemplateExpression[],
  scopeRoot: ts.Node,
  signalInitializers: Map<string, string | number | boolean>,
  templateName: string,
  fragment = false,
): CompiledTemplates => {
  const { sourceFile, emit } = file;
  let allBindings: BindingInfo[] = [];
  let allConditionals: ConditionalBlock[] = [];
  let allWhenElseBlocks: WhenElseBlock[] = [];
  let allRepeatBlocks: RepeatBlock[] = [];
  let allEventBindings: EventBinding[] = [];
  let lastProcessedTemplateContent = '';
  // The children and imported fragments, each given its placeholder as the text is read: a fragment used twice
  // brings its children twice, each a child of its own
  const scope: InlineScope = { sourceFile, scopeRoot, inlined: file.inlined, file, mounts: [] };

  for (const node of templates) {
    let templateContent = extractAndInlineFragment(node, scope);

    const result = processHtmlTemplateWithConditionals(templateContent, signalInitializers, file.nextId);
    templateContent = result.processedContent;
    allBindings = [...allBindings, ...result.bindings];
    allConditionals = [...allConditionals, ...result.conditionals];
    allWhenElseBlocks = [...allWhenElseBlocks, ...result.whenElseBlocks];
    allRepeatBlocks = [...allRepeatBlocks, ...result.repeatBlocks];
    allEventBindings = [...allEventBindings, ...result.eventBindings];
    file.nextId = result.nextId;

    lastProcessedTemplateContent = templateContent;
  }

  // The children: each keeps its index in the file, which names its variables
  const ownMounts = scope.mounts;

  // ── Partition child mounts by directive containment ──
  const directiveChildMounts = new Map<string, OwnMount[]>();
  const topLevelChildMounts: OwnMount[] = [];

  // A child is mounted by the innermost directive whose own template holds its placeholder: a
  // branch's initializer, or the row factory of a list, at any depth. The templates that
  // hold it are nested in one another (a pre-rendered branch is in its parent's too), and the walk
  // visits a block before the blocks inside it, so the last one found is the innermost. A child in
  // no directive is a top-level mount.
  //
  // A child's props are read when it mounts. Those that read the item or index of a list around the
  // directive that mounts it (an outer row, for a child in a row's branch or in an inner row) follow that
  // row's signal: the child gets the props for the row's new item (its own row's are given by the row's
  // update).
  const roots = { conditionals: allConditionals, whenElse: allWhenElseBlocks, repeats: allRepeatBlocks };
  for (const mount of ownMounts) {
    const marker = anchorMark(mount.cm.anchorId, '.');
    let owner: string | undefined;
    let ownRow: RepeatBlock | undefined;
    let around: readonly RepeatBlock[] = [];
    const found = (id: string, rows: readonly RepeatBlock[], row?: RepeatBlock): void => {
      owner = id;
      around = rows;
      ownRow = row;
    };
    walkDirectives(roots, {
      cond: (c, rows) => void (c.templateContent.includes(marker) && found(c.id, rows)),
      whenElse: (we, rows) =>
        void (we.thenTemplate.includes(marker)
          ? found(we.thenId, rows)
          : we.elseTemplate.includes(marker) && found(we.elseId, rows)),
      repeat: (rep, rows) => void (rep.itemTemplate.includes(marker) && found(rep.id, rows, rep)),
    });
    const follows = followedRows(mount.cm.propsExpression, around, ownRow);
    if (follows.length > 0) mount.follows = follows;
    if (!owner) topLevelChildMounts.push(mount);
    else if (directiveChildMounts.has(owner)) directiveChildMounts.get(owner)!.push(mount);
    else directiveChildMounts.set(owner, [mount]);
  }

  // A ref in a branch of a list row would name one row's element (THANE016), as a ref in the row itself does
  const refsIn = (events: readonly EventBinding[] | undefined, rows: readonly RepeatBlock[]): void => {
    const ref = rows.length > 0 ? events?.find((e) => e.ref) : undefined;
    if (ref) throw new Error(refInRow(ref.handlerExpression));
  };
  walkDirectives(roots, {
    cond: (c, rows) => refsIn(c.nestedEventBindings, rows),
    whenElse: (we, rows) => refsIn([...(we.thenEventBindings ?? []), ...(we.elseEventBindings ?? [])], rows),
  });

  // A row that is a component call, in a list inside another's row
  walkDirectives(roots, {
    repeat: (rep, rows) => {
      if (!rep.componentRow || rows.length === 0) return;
      const follows = followedRows(rep.componentRow.propsExpression, rows, rep);
      if (follows.length > 0) rep.componentRow.follows = follows;
    },
  });

  // Each child's host goes into the template in place of its placeholder, where it fits
  const template = { template: lastProcessedTemplateContent };
  const childHosts = placeChildHosts(
    ownMounts.map(({ cm }) => cm),
    template,
    { conditionals: allConditionals, whenElse: allWhenElseBlocks, repeats: allRepeatBlocks },
    emit,
  );
  lastProcessedTemplateContent = template.template;
  const {
    code: bindingsBody,
    staticTemplates: repeatStaticTemplates,
    helpers,
    elementList,
    domPrototype,
  } = generateInitBindingsFunction(
    allBindings,
    allConditionals,
    allWhenElseBlocks,
    allRepeatBlocks,
    allEventBindings,
    emit,
    directiveChildMounts.size > 0 ? directiveChildMounts : undefined,
    topLevelChildMounts,
    lastProcessedTemplateContent,
    childHosts,
    fragment,
  );

  let staticTemplateCode = '';
  if (lastProcessedTemplateContent) {
    staticTemplateCode = generateStaticTemplate(lastProcessedTemplateContent, emit, templateName);
  }

  if (repeatStaticTemplates.length > 0) {
    staticTemplateCode += '\n' + repeatStaticTemplates.join('\n');
  }

  const hasAnyBindings =
    allBindings.length > 0 ||
    allConditionals.length > 0 ||
    allWhenElseBlocks.length > 0 ||
    allRepeatBlocks.length > 0 ||
    allEventBindings.length > 0 ||
    ownMounts.length > 0;

  return {
    template: lastProcessedTemplateContent,
    staticTemplateCode,
    bindingsBody,
    helpers,
    elementList,
    domPrototype,
    hasAnyBindings,
  };
};

/**
 * Compile one component: its templates, its binding code in its return object, the registration
 * name (and a derived selector) at its call, and its template, `templateName`, as the call's last
 * argument. The edits go into the file's list; the static templates are returned, for the file to
 * place before the component's statement.
 */
const compileComponent = (
  file: FileCompilation,
  component: ComponentDeclaration,
  templateName: string,
): CompiledComponent => {
  const { source, sourceFile, edits, options } = file;
  const { call: dcCall, statement, selector, explicitSelector: hasExplicitSelector } = component;

  // The name the selector is emitted under: its own, or the short name planned for this build.
  const emittedSelector = options.selectorMap?.get(selector) ?? selector;

  const setupArg = getSetupFunction(dcCall);
  // The initial values of the signals the templates can read: the module's, and the component's own
  const signalInitializers = setupArg
    ? new Map([...file.moduleSignals, ...findSignalInitializers(setupArg)])
    : file.moduleSignals;
  // The signal detector resolves a template's calls in the component's scope
  setTemplateScope(setupArg ? templateScopeOf(sourceFile, setupArg) : undefined);
  // Every return object's template is compiled; the last object is the component's: it
  // decides the features, loses its dead properties and receives the binding function.
  const returnObjects = setupArg ? findReturnObjects(setupArg) : [];
  const returnObj = returnObjects[returnObjects.length - 1];
  const htmlTemplates = setupArg ? findHtmlTemplates(sourceFile, setupArg, returnObjects) : [];

  // htmlTemplates is empty without a setup function
  const compiled = compileTemplates(
    file,
    htmlTemplates.map((templateInfo) => templateInfo.node),
    setupArg!,
    signalInitializers,
    templateName,
  );
  for (const templateInfo of htmlTemplates) {
    edits.push({ start: templateInfo.templateStart, end: templateInfo.templateEnd, replacement: '``' });
  }

  // An explicit selector is a string literal in the source: write the emitted name over it
  if (hasExplicitSelector && emittedSelector !== selector) {
    const selectorArg = dcCall.arguments[0]!;
    edits.push({
      start: selectorArg.getStart(sourceFile),
      end: selectorArg.getEnd(),
      replacement: `'${emittedSelector}'`,
    });
  }

  // Styles and non-empty lifecycle hooks, read once from the component's return object.
  // They decide the styles import and call, and the registration function: the lean variant when
  // the component has no styles and no lifecycle hooks, so esbuild can tree-shake the styles
  // subsystem entirely for style-free apps.
  // The full variant also when the setup may create what the component owns (createsOwned): it disposes them
  const { hasStyles, hasLifecycle } = detectFeatures(returnObj);
  const owns = !!setupArg && createsOwned(setupArg);
  const registerFnName =
    hasStyles || hasLifecycle || owns ? BIND_FN.REGISTER_COMPONENT : BIND_FN.REGISTER_COMPONENT_LEAN;

  // A template that reads one of the binding code's own names would read the compiler's value (THANE012)
  if (setupArg) checkBindingNames(setupArg, compiled.bindingsBody);

  // The binding function goes into the component's return object
  const injectBindings = compiled.hasAnyBindings && returnObj !== undefined;

  // `defineComponent<…>(` becomes the registration call; a selector derived from the name goes in
  // as its first argument
  edits.push({
    start: dcCall.expression.getStart(sourceFile),
    end: dcCall.arguments.pos,
    replacement: `${registerFnName}(` + (hasExplicitSelector ? '' : `'${emittedSelector}', `),
  });

  if (returnObj) {
    // Dead properties leave the return object. A removed `template: html\`…\`` takes the
    // template's own edit with it.
    for (const removal of deadPropertyRemovals(source, sourceFile, returnObj, !!compiled.template)) {
      for (let i = edits.length - 1; i >= 0; i--) {
        if (edits[i]!.start >= removal.start && edits[i]!.end <= removal.end) edits.splice(i, 1);
      }
      edits.push(removal);
    }
    // The binding function becomes the object's first property. It is listed after the
    // removals: applyEdits applies edits that start at one position in list order, each in front
    // of the text already there, so it lands before a removal that starts at the same `{`.
    if (injectBindings) {
      const at = returnObj.getStart(sourceFile) + 1;
      // The registration factory passes the template's elements when the code reaches them by position
      const params = compiled.elementList ? '_ctx, _ns' : '_ctx';
      edits.push({
        start: at,
        end: at,
        replacement: `\n  __b: (${params}) => {\n  ${compiled.bindingsBody.trim()}\n  },`,
      });
    }
  }

  // The compiled template is the registration call's last argument
  if (compiled.template) {
    const at = dcCall.getEnd() - 1;
    edits.push({ start: at, end: at, replacement: `, ${templateName}` });
  }

  return {
    statement,
    declarations: compiled.staticTemplateCode,
    helpers: [registerFnName, ...(injectBindings ? compiled.helpers : [])],
    hasStyles,
    domPrototype: compiled.domPrototype,
  };
};

/**
 * Compile an exported fragment into the value another module's template mounts (see runtime/fragment.ts):
 * `{ t, b }`, its static template, `templateName`, and the function that binds a copy of it, closed over
 * the module. Its static templates are marked pure, so a fragment no module uses is dropped.
 */
const compileFragment = (
  file: FileCompilation,
  fragment: FragmentDeclaration,
  templateName: string,
): CompiledComponent => {
  const { sourceFile, edits } = file;
  // The signal detector resolves the template's calls in the module's scope
  setTemplateScope(templateScopeOf(sourceFile));
  const compiled = compileTemplates(file, [fragment.template], sourceFile, file.moduleSignals, templateName, true);
  const params = compiled.elementList ? '_ctx, _ns' : '_ctx';
  edits.push({
    start: fragment.template.getStart(sourceFile),
    end: fragment.template.getEnd(),
    replacement: compiled.hasAnyBindings
      ? `{ t: ${templateName}, b: (${params}) => {\n  ${compiled.bindingsBody.trim()}\n  } }`
      : `{ t: ${templateName} }`,
  });
  return {
    statement: fragment.statement,
    declarations: compiled.staticTemplateCode
      .split(` = ${BIND_FN.TEMPLATE}(`)
      .join(` = /* @__PURE__ */ ${BIND_FN.TEMPLATE}(`),
    helpers: compiled.hasAnyBindings ? [...compiled.helpers] : [],
    hasStyles: false,
    domPrototype: compiled.domPrototype,
  };
};
