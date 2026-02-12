/**
 * Source transformation for reactive binding compiler
 * 
 * Handles TypeScript source file analysis, locating HTML/CSS templates,
 * finding imports, and orchestrating the full component transformation.
 */

import fs from 'fs';
import type { Plugin } from 'esbuild';
import ts from 'typescript';
import type { ImportInfo, TemplateInfo } from '../../types.js';
import {
  findSignalInitializers,
  extractTemplateContent,
  isHtmlTemplate,
  isCssTemplate,
  isDefineComponentCall,
  pascalToKebab,
  applyEdits,
  sourceCache,
  logger,
  hasHtmlTemplates,
  extendsComponentQuick,
  createLoaderResult,
  PLUGIN_NAME,
  BIND_FN,
} from '../../utils/index.js';
import type { BindingInfo, ConditionalBlock, WhenElseBlock, RepeatBlock, EventBinding } from './types.js';
import { CLOSURE_ACCESS } from './types.js';
import { processHtmlTemplateWithConditionals } from './template-processing.js';
import type { ChildMountInfo } from '../component-precompiler/component-precompiler.js';

// ============================================================================
// Lifecycle hook stripping
// ============================================================================

/** Property names eligible for dead-code removal when their body is empty */
const STRIPPABLE_LIFECYCLE = new Set(['onMount', 'onDestroy']);

/** Properties that should be stripped when a compiled template is injected */
const STRIPPABLE_TEMPLATE = new Set(['template']);

/**
 * Check if an arrow function or function expression has an empty body.
 * Matches: `() => {}` and `() => { }` (with optional whitespace).
 */
const isEmptyArrowFunction = (node: ts.Node): boolean => {
  if (ts.isArrowFunction(node)) {
    const body = node.body;
    return ts.isBlock(body) && body.statements.length === 0;
  }
  return false;
};

/**
 * Strip empty lifecycle hooks (onMount, onDestroy) and the `template` property
 * from the return object of defineComponent.
 *
 * When a compiled template is injected, the `template` property is redundant —
 * the runtime clones the pre-compiled template element instead. The `template`
 * key (usually set to an empty string `""` or backtick ``` `` ```) is pure dead
 * weight and is stripped here.
 *
 * @param source - The full component source (post-injection)
 * @param hasCompiledTemplate - Whether a compiled template was injected
 */
const stripDeadPropertiesAndDetectFeatures = (source: string, hasCompiledTemplate: boolean): { source: string; hasStyles: boolean; hasLifecycle: boolean } => {
  const sf = ts.createSourceFile('__strip.ts', source, ts.ScriptTarget.Latest, true);

  // Find the defineComponent return object
  let returnObj: ts.ObjectLiteralExpression | null = null;
  const find = (node: ts.Node) => {
    if (returnObj) return;
    if (ts.isCallExpression(node) && isDefineComponentCall(node)) {
      const setupArg = node.arguments.length >= 2 ? node.arguments[1] : node.arguments[0];
      if (setupArg && (ts.isArrowFunction(setupArg) || ts.isFunctionExpression(setupArg))) {
        const findReturn = (n: ts.Node) => {
          if (returnObj) return;
          if (ts.isArrowFunction(n) && n !== setupArg) return;
          if (ts.isFunctionExpression(n) && n !== setupArg) return;
          if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
            returnObj = n.expression;
          }
          ts.forEachChild(n, findReturn);
        };
        findReturn(setupArg);
      }
    }
    ts.forEachChild(node, find);
  };
  find(sf);

  if (!returnObj) return { source, hasStyles: false, hasLifecycle: false };

  // Collect ranges to remove (in reverse order for safe splicing)
  const removals: Array<{ start: number; end: number }> = [];
  const properties = (returnObj as ts.ObjectLiteralExpression).properties;
  let hasStyles = false;
  let hasLifecycle = false;

  for (const prop of properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : null;
    if (!name) continue;

    // ── Feature detection (styles) ──
    if (name === 'styles') {
      hasStyles = true;
      continue;  // keep in return — runtime handles it via _onStyles callback
    }

    // ── Feature detection (lifecycle) — non-empty hooks that survive stripping ──
    if (STRIPPABLE_LIFECYCLE.has(name) && !isEmptyArrowFunction(prop.initializer)) {
      hasLifecycle = true;
      continue;  // keep — runtime needs these
    }

    // ── Strippable properties ──
    const shouldStripLifecycle = STRIPPABLE_LIFECYCLE.has(name) && isEmptyArrowFunction(prop.initializer);
    const shouldStripTemplate = hasCompiledTemplate && STRIPPABLE_TEMPLATE.has(name);

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

    removals.push({ start, end });
  }

  if (removals.length === 0) return { source, hasStyles, hasLifecycle };

  // Apply removals in reverse order
  let modified = source;
  for (const { start, end } of removals.reverse()) {
    modified = modified.substring(0, start) + modified.substring(end);
  }

  return { source: modified, hasStyles, hasLifecycle };
};
import { generateInitBindingsFunction, generateStaticTemplate, generateUpdatedImport } from './codegen.js';
import { ErrorCode, createError } from '../../errors.js';

const NAME = PLUGIN_NAME.REACTIVE;

/**
 * Check if a module specifier refers to the Thane runtime
 */
export const isThaneRuntimeImport = (specifier: string): boolean => {
  return (
    specifier.includes('shadow-dom') ||
    specifier.includes('dom/index') ||
    specifier === 'thane' ||
    specifier.startsWith('thane/')
  );
};

/**
 * Find the Thane runtime import in a source file
 */
export const findServicesImport = (sourceFile: ts.SourceFile): ImportInfo | null => {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;

      if (isThaneRuntimeImport(specifier)) {
        const namedImports: string[] = [];

        if (statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
          for (const element of statement.importClause.namedBindings.elements) {
            namedImports.push(element.name.text);
          }
        }

        const fullText = statement.moduleSpecifier.getFullText(sourceFile);
        const quoteChar = fullText.includes("'") ? "'" : '"';
        const normalizedSpecifier = specifier === 'thane' || specifier.startsWith('thane/')
          ? specifier
          : specifier.includes('shadow-dom')
            ? specifier.replace('shadow-dom.js', 'index.js').replace('shadow-dom', 'index')
            : specifier;

        return {
          namedImports,
          moduleSpecifier: normalizedSpecifier,
          start: statement.getStart(sourceFile),
          end: statement.getEnd(),
          quoteChar,
        };
      }
    }
  }
  return null;
};

// ============================================================================
// defineComponent Support
// ============================================================================

/**
 * Find all html-tagged template literals in the source file.
 * Does not extract signal expressions — those are handled by the template
 * processing pipeline downstream.
 */
const findHtmlTemplates = (sourceFile: ts.SourceFile): TemplateInfo[] => {
  const templates: TemplateInfo[] = [];

  const visit = (node: ts.Node, insideHtmlTemplate: boolean) => {
    if (ts.isTaggedTemplateExpression(node) && isHtmlTemplate(node)) {
      if (insideHtmlTemplate) {
        return; // Don't process or recurse into nested html templates
      }

      templates.push({
        node,
        expressions: [],
        templateStart: node.getStart(sourceFile),
        templateEnd: node.getEnd(),
      });
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }

    ts.forEachChild(node, (child) => visit(child, insideHtmlTemplate));
  };

  visit(sourceFile, false);
  return templates;
};

/**
 * Transform a defineComponent source file by processing HTML templates,
 * generating binding code, and injecting static templates.
 * 
 * The pipeline natively supports defineComponent's closure-based access pattern:
 * 1. Parse templates directly — bare signal() calls are detected by the regex pipeline
 * 2. Run template processing and codegen with CLOSURE_ACCESS pattern
 * 3. Generated code uses bare signal references, ctx.root, etc.
 * 4. Inject __template and __bindings as properties on the setup function
 */
export const transformDefineComponentSource = (
  source: string,
  filePath: string,
  childMounts?: ChildMountInfo[],
  childMountCount?: number,
): string | null => {
  const sourceFile = sourceCache.parse(filePath, source);
  
  // Find the defineComponent call
  let defineComponentCall: ts.CallExpression | null = null;
  let exportName: string | null = null;
  
  const findDefineComponent = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isCallExpression(decl.initializer) && isDefineComponentCall(decl.initializer)) {
          defineComponentCall = decl.initializer;
          exportName = hasExport ? decl.name.text : null;
        }
      }
    }
    if (!defineComponentCall) ts.forEachChild(node, findDefineComponent);
  };
  findDefineComponent(sourceFile);
  
  if (!defineComponentCall) return null;
  
  // Narrow for TypeScript — the null check above guarantees this
  const dcCall: ts.CallExpression = defineComponentCall;
  
  // Determine selector
  let selector: string | null = null;
  let hasExplicitSelector = false;
  const args = dcCall.arguments;
  
  if (args.length >= 2 && ts.isStringLiteral(args[0]!)) {
    selector = (args[0] as ts.StringLiteral).text;
    hasExplicitSelector = true;
  } else if (exportName) {
    selector = pascalToKebab(exportName);
  }
  
  if (!selector) return null;
  
  const signalInitializers = findSignalInitializers(sourceFile);
  
  // Find html templates directly — no normalization needed.
  // The regex pipeline natively matches bare signal() calls.
  const servicesImport = findServicesImport(sourceFile);
  const htmlTemplates = findHtmlTemplates(sourceFile);
  
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  let allBindings: BindingInfo[] = [];
  let allConditionals: ConditionalBlock[] = [];
  let allWhenElseBlocks: WhenElseBlock[] = [];
  let allRepeatBlocks: RepeatBlock[] = [];
  let allEventBindings: EventBinding[] = [];
  let idCounter = childMountCount ?? 0;
  let lastProcessedTemplateContent = '';
  let hasConditionals = false;
  
  for (const templateInfo of htmlTemplates) {
    let templateContent = extractTemplateContent(templateInfo.node.template, sourceFile);
    
    const result = processHtmlTemplateWithConditionals(templateContent, signalInitializers, idCounter);
    templateContent = result.processedContent;
    allBindings = [...allBindings, ...result.bindings];
    allConditionals = [...allConditionals, ...result.conditionals];
    allWhenElseBlocks = [...allWhenElseBlocks, ...result.whenElseBlocks];
    allRepeatBlocks = [...allRepeatBlocks, ...result.repeatBlocks];
    allEventBindings = [...allEventBindings, ...result.eventBindings];
    idCounter = result.nextId;
    hasConditionals = hasConditionals || result.hasConditionals;
    
    lastProcessedTemplateContent = templateContent;
    
    edits.push({
      start: templateInfo.templateStart,
      end: templateInfo.templateEnd,
      replacement: '``',
    });
  }
  
  // Strip css tags
  const visitCss = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node) && isCssTemplate(node)) {
      const cssContent = extractTemplateContent(node.template, sourceFile);
      edits.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        replacement: '`' + cssContent + '`',
      });
    }
    ts.forEachChild(node, visitCss);
  };
  visitCss(sourceFile);
  
  // Early detection: check if the component has a `styles` property.
  // This is needed before edits are applied so we can add __enableComponentStyles to imports.
  let componentHasStyles = false;
  {
    const setupArg = dcCall.arguments.length >= 2 ? dcCall.arguments[1] : dcCall.arguments[0];
    if (setupArg && (ts.isArrowFunction(setupArg) || ts.isFunctionExpression(setupArg))) {
      const checkForStyles = (n: ts.Node): void => {
        if (componentHasStyles) return;
        if (ts.isArrowFunction(n) && n !== setupArg) return;
        if (ts.isFunctionExpression(n) && n !== setupArg) return;
        if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
          for (const prop of n.expression.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'styles') {
              componentHasStyles = true;
            }
          }
        }
        ts.forEachChild(n, checkForStyles);
      };
      checkForStyles(setupArg);
    }
  }

  // ── Partition child mounts by directive containment (Step 7) ──
  const directiveChildMounts = new Map<string, { cm: ChildMountInfo, globalIndex: number }[]>();
  const topLevelChildMounts: { cm: ChildMountInfo, globalIndex: number }[] = [];

  if (childMounts && childMounts.length > 0) {
    const addToDirective = (key: string, cm: ChildMountInfo, idx: number) => {
      if (!directiveChildMounts.has(key)) directiveChildMounts.set(key, []);
      directiveChildMounts.get(key)!.push({ cm, globalIndex: idx });
    };

    // Recursive helper: search nested conditionals (depth-first, innermost match wins)
    const findInConditionals = (marker: string, conds: ConditionalBlock[]): string | null => {
      for (const c of conds) {
        if (!c.templateContent.includes(marker)) continue;
        // Check deeper nesting first
        const inner = findInConditionals(marker, c.nestedConditionals || []);
        if (inner) return inner;
        return c.id;
      }
      return null;
    };

    const findInWhenElse = (marker: string, wes: WhenElseBlock[]): string | null => {
      for (const we of wes) {
        if (we.thenTemplate.includes(marker)) {
          const inner = findInConditionals(marker, we.nestedConditionals || []);
          if (inner) return inner;
          const innerWE = findInWhenElse(marker, we.nestedWhenElse || []);
          if (innerWE) return innerWE;
          return we.thenId;
        }
        if (we.elseTemplate.includes(marker)) {
          return we.elseId;
        }
      }
      return null;
    };

    for (let i = 0; i < childMounts.length; i++) {
      const cm = childMounts[i]!;
      const marker = `id="${cm.anchorId}"`;
      let placed = false;

      // Check repeat blocks (and their nested directives)
      for (const rep of allRepeatBlocks) {
        if (!rep.itemTemplate.includes(marker)) continue;
        const innerCond = findInConditionals(marker, rep.nestedConditionals);
        if (innerCond) { addToDirective(innerCond, cm, i); placed = true; break; }
        const innerWE = findInWhenElse(marker, rep.nestedWhenElse);
        if (innerWE) { addToDirective(innerWE, cm, i); placed = true; break; }
        addToDirective(rep.id, cm, i);
        placed = true;
        break;
      }
      if (placed) continue;

      // Check top-level conditionals
      const condId = findInConditionals(marker, allConditionals);
      if (condId) { addToDirective(condId, cm, i); continue; }

      // Check whenElse blocks
      const weId = findInWhenElse(marker, allWhenElseBlocks);
      if (weId) { addToDirective(weId, cm, i); continue; }

      // Top-level mount
      topLevelChildMounts.push({ cm, globalIndex: i });
    }
  }

  // Generate bindings code with CLOSURE_ACCESS — natively emits bare signal refs,
  // ctx.root, and closure-compatible code. No post-hoc stripping needed.
  const ap = CLOSURE_ACCESS;
  const { code: initBindingsFunction, staticTemplates: repeatStaticTemplates } = generateInitBindingsFunction(
    allBindings, allConditionals, allWhenElseBlocks, allRepeatBlocks, allEventBindings, filePath, ap,
    directiveChildMounts.size > 0 ? directiveChildMounts : undefined,
  );
  
  let staticTemplateCode = '';
  if (lastProcessedTemplateContent) {
    staticTemplateCode = generateStaticTemplate(lastProcessedTemplateContent, ap);
  }
  
  if (repeatStaticTemplates.length > 0) {
    staticTemplateCode += '\n' + repeatStaticTemplates.join('\n');
  }
  
  // Update imports: always replace defineComponent → __registerComponent,
  // and add binding / styles imports as needed.
  const hasAnyBindings = allBindings.length > 0 || allConditionals.length > 0 || 
    allWhenElseBlocks.length > 0 || allRepeatBlocks.length > 0 || allEventBindings.length > 0 ||
    (childMounts != null && childMounts.length > 0);
    
  if (servicesImport) {
    // Filter out defineComponent (replaced by __registerComponent in compiled output)
    const filteredImport: typeof servicesImport = {
      ...servicesImport,
      namedImports: servicesImport.namedImports.filter(n => n !== 'defineComponent'),
    };
    // Determine which registration function to import — lean or full.
    // At this point we don't yet know if the component has lifecycle hooks
    // (that's detected later in stripDeadPropertiesAndDetectFeatures).
    // We add a placeholder and fix it up after stripping.
    const requiredFunctions: string[] = ['__REGISTER_PLACEHOLDER__'];

    // ── Binding function imports ──
    if (hasAnyBindings) {
      if (allBindings.some((b) => b.type === 'style')) requiredFunctions.push(BIND_FN.STYLE);
      if (allBindings.some((b) => b.type === 'attr')) requiredFunctions.push(BIND_FN.ATTR);
      if (allBindings.some((b) => b.type === 'text')) requiredFunctions.push(BIND_FN.TEXT);
      
      // Check for conditionals at top level AND nested inside repeat items (Step 14)
      const allConditionalsIncludingNested = [
        ...allConditionals,
        ...allRepeatBlocks.flatMap(r => r.nestedConditionals),
      ];
      const allWhenElseIncludingNested = [
        ...allWhenElseBlocks,
        ...allRepeatBlocks.flatMap(r => r.nestedWhenElse),
      ];
      const hasSimpleConditionals = allConditionalsIncludingNested.some((c) => c.signalNames.length === 1 && c.jsExpression === `${c.signalName}()`);
      const hasComplexConditionals = allConditionalsIncludingNested.some((c) => c.signalNames.length > 1 || c.jsExpression !== `${c.signalName}()`);
      if (hasSimpleConditionals) requiredFunctions.push(BIND_FN.IF);
      if (hasComplexConditionals || allWhenElseIncludingNested.length > 0) requiredFunctions.push(BIND_FN.IF_EXPR);
      
      if (allRepeatBlocks.length > 0) {
        // Always import createKeyedReconciler — it's the sole reconciler now (Step 16)
        requiredFunctions.push(BIND_FN.KEYED_RECONCILER);
        
      }
      // Events now use direct addEventListener — no runtime import needed
    }

    // ── Styles enablement import ──
    if (componentHasStyles) {
      requiredFunctions.push(BIND_FN.ENABLE_STYLES);
    }
    
    const newImport = generateUpdatedImport(filteredImport, requiredFunctions);
    edits.push({
      start: servicesImport.start,
      end: servicesImport.end,
      replacement: newImport,
    });
  }
  
  // Apply all edits to the source (no normalization pass — edits are against the original)
  let result = applyEdits(source, edits);
  
  // ──────────────────────────────────────────────────────────────────────
  // Injection strategy for defineComponent:
  //
  //   Static templates (__tpl, __tpl_b0, …) go BEFORE the export — they are
  //   pure DOM templates with no closure dependencies.
  //
  //   The binding function must live INSIDE the setup closure so it can
  //   reference local signal variables (rows, run, handleTableClick, …).
  //   We inject it as a `__bindings` property on the return object, which
  //   the runtime picks up after cloning the template.
  //
  //   The main static template is passed as an extra arg to defineComponent()
  //   so the runtime can clone it before bindings run.
  // ──────────────────────────────────────────────────────────────────────

  // Transform initializeBindings from class-style wrapper to a plain function body.
  // The codegen emits `initializeBindings = () => { const r = ctx.root; ... };`
  // We extract the body and wrap it as a `__bindings: (ctx) => { ... }` arrow function.
  let processedBindings = initBindingsFunction
    .replace(/\s*initializeBindings = \(\) => \{\s*/, '')
    .replace(/\};\s*$/, '');

  // ── Child component mount code (Signal Props) ──
  // Top-level mounts are appended here. Mounts inside conditionals/whenElse/repeat
  // are injected into nested initializers by generateInitBindingsFunction (Step 7).
  if (topLevelChildMounts.length > 0) {
    const mountLines: string[] = [];
    for (const { cm, globalIndex } of topLevelChildMounts) {
      const varName = `_cm${globalIndex}`;
      mountLines.push(`const ${varName} = document.createElement('${cm.selector}');`);
      mountLines.push(`_gid('${cm.anchorId}').replaceWith(${varName});`);
      mountLines.push(`${cm.componentName}.__f(${varName}, ${cm.propsExpression});`);
    }
    processedBindings += '\n    ' + mountLines.join('\n    ');
  }
  
  // Collect repeat static template names
  const repeatTemplateNames: string[] = [];
  const repeatTplRegex = /const (__tpl_\w+) =/g;
  let tplMatch: RegExpExecArray | null;
  while ((tplMatch = repeatTplRegex.exec(staticTemplateCode)) !== null) {
    if (tplMatch[1]) repeatTemplateNames.push(tplMatch[1]);
  }
  
  // Inject selector if auto-derived (before the setup function argument)
  if (!hasExplicitSelector && selector) {
    result = result.replace(
      /defineComponent\s*((?:<[^(]*>)?)\s*\(/,
      `defineComponent$1('${selector}', `,
    );
  }
  
  // ── AST-based injection: re-parse the transformed source for reliable positions ──
  const injectionSf = ts.createSourceFile('__injection.ts', result, ts.ScriptTarget.Latest, true);
  
  // Find the export declaration and defineComponent call via AST
  let exportStart: number | null = null;
  let dcCallNode: ts.CallExpression | null = null;
  let dcCallCloseParen: number | null = null;
  let returnObjectBracePos: number | null = null;
  
  const findInjectionPoints = (node: ts.Node) => {
    // Find: [export] const X = defineComponent(...)
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && ts.isCallExpression(decl.initializer) && isDefineComponentCall(decl.initializer)) {
          exportStart = node.getStart(injectionSf);
          dcCallNode = decl.initializer;
          // The closing paren is at the end of the CallExpression minus 1
          dcCallCloseParen = dcCallNode.getEnd() - 1;
        }
      }
    }
    ts.forEachChild(node, findInjectionPoints);
  };
  findInjectionPoints(injectionSf);
  
  // Find the return statement inside the setup function
  if (dcCallNode) {
    const setupArg = (dcCallNode as ts.CallExpression).arguments.length >= 2 
      ? (dcCallNode as ts.CallExpression).arguments[1] 
      : (dcCallNode as ts.CallExpression).arguments[0];
    if (setupArg && (ts.isArrowFunction(setupArg) || ts.isFunctionExpression(setupArg))) {
      const findReturn = (node: ts.Node) => {
        // Only look at direct returns in this function, not nested functions
        if (ts.isArrowFunction(node) && node !== setupArg) return;
        if (ts.isFunctionExpression(node) && node !== setupArg) return;
        if (ts.isFunctionDeclaration(node)) return;
        if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
          returnObjectBracePos = node.expression.getStart(injectionSf) + 1; // after {
        }
        ts.forEachChild(node, findReturn);
      };
      findReturn(setupArg);
    }
  }
  
  // Track strip result for lean/full registration decision (populated in Step 3a)
  let stripResult: { source: string; hasStyles: boolean; hasLifecycle: boolean } = { source: result, hasStyles: false, hasLifecycle: false };

  if (exportStart !== null) {
    // ── Step 1: Insert static template declarations before the export ──
    let declarations = '';
    if (staticTemplateCode.trim()) {
      declarations += staticTemplateCode.trim() + '\n';
    }
    
    if (declarations) {
      result = result.substring(0, exportStart) + declarations + '\n' + result.substring(exportStart);
      // Adjust downstream positions for the inserted text
      const offset = declarations.length + 1; // +1 for newline
      if (returnObjectBracePos !== null) returnObjectBracePos = returnObjectBracePos + offset;
      if (dcCallCloseParen !== null) dcCallCloseParen = dcCallCloseParen + offset;
    }
    
    // ── Step 2: Inject __bindings into the return object ──
    if (hasAnyBindings && processedBindings.trim() && returnObjectBracePos !== null) {
      const bindingsFnBody = `\n  __b: (ctx) => {\n  ${processedBindings.trim()}\n  },`;
      result = result.substring(0, returnObjectBracePos) + bindingsFnBody + result.substring(returnObjectBracePos);
      // Adjust closing paren position
      if (dcCallCloseParen !== null) dcCallCloseParen = dcCallCloseParen + bindingsFnBody.length;
    }
    
    // ── Step 3: Pass flags + __tpl + repeat templates as extra args to defineComponent() ──
    //
    // New signature: defineComponent(selector, setup, flags, __tpl, ...repeatTemplates)
    //
    // Strip dead properties (empty lifecycle hooks, template key) from the
    // return object, then inject extra defineComponent arguments:
    //   - __tpl (pre-compiled template element)
    //   - repeat template name/value pairs
    if (dcCallCloseParen !== null) {
      // ── Step 3a: Strip dead properties ──
      // Must happen before we insert extra args (positions would shift)
      const hasCompiledTemplate = !!lastProcessedTemplateContent;
      stripResult = stripDeadPropertiesAndDetectFeatures(result, hasCompiledTemplate);
      
      // Adjust dcCallCloseParen for any characters removed by stripping
      const charDelta = stripResult.source.length - result.length;
      result = stripResult.source;
      dcCallCloseParen = dcCallCloseParen + charDelta;

      // ── Step 3b: Build extra arguments ──
      let extraArgs = '';

      if (lastProcessedTemplateContent) {
        extraArgs += ', __tpl';
      }
      
      for (const name of repeatTemplateNames) {
        extraArgs += `, '${name}', ${name}`;
      }
      
      if (extraArgs) {
        result = result.substring(0, dcCallCloseParen) + extraArgs + result.substring(dcCallCloseParen);
      }

      // ── Step 3c: Inject __enableComponentStyles() when component uses styles ──
      if (stripResult.hasStyles) {
        result += '\n__enableComponentStyles();\n';
      }
    }
  }
  
  // Step 4 is now integrated into Step 3a (stripDeadPropertiesAndDetectFeatures)
  
  // ── Final step: rename defineComponent → __registerComponent ──
  // Done AFTER all AST-based injections that rely on isDefineComponentCall()
  // matching the `defineComponent` identifier.
  const registerFnName = BIND_FN.REGISTER_COMPONENT;
  result = result.replace(/\bdefineComponent\s*(?:<[^(]*>)?\s*\(/, `${registerFnName}(`);

  // Fix up the placeholder import to the actual registration function
  result = result.replace('__REGISTER_PLACEHOLDER__', registerFnName);
  
  return result;
};

// ============================================================================
// esbuild Plugin
// ============================================================================

export const ReactiveBindingPlugin: Plugin = {
  name: NAME,
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      if (args.path.includes('scripts') || args.path.includes('node_modules')) {
        return undefined;
      }

      const source = await fs.promises.readFile(args.path, 'utf8');

      if (!extendsComponentQuick(source) || !hasHtmlTemplates(source)) {
        return undefined;
      }

      try {
        const transformed = transformDefineComponentSource(source, args.path);

        if (transformed === null) {
          return undefined;
        }

        return createLoaderResult(transformed);
      } catch (error) {
        const diagnostic = createError(
          `Error processing ${args.path}: ${error instanceof Error ? error.message : error}`,
          { file: args.path, line: 0, column: 0 },
          ErrorCode.PLUGIN_ERROR,
        );
        logger.diagnostic(diagnostic);
        return undefined;
      }
    });
  },
};
