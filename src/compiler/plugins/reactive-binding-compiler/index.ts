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
export const transformDefineComponentSource = (source: string, filePath: string): string | null => {
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
  let idCounter = 0;
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
  
  // Generate bindings code with CLOSURE_ACCESS — natively emits bare signal refs,
  // ctx.root, and closure-compatible code. No post-hoc stripping needed.
  const ap = CLOSURE_ACCESS;
  const { code: initBindingsFunction, staticTemplates: repeatStaticTemplates } = generateInitBindingsFunction(
    allBindings, allConditionals, allWhenElseBlocks, allRepeatBlocks, allEventBindings, filePath, ap,
  );
  
  let staticTemplateCode = '';
  if (lastProcessedTemplateContent) {
    staticTemplateCode = generateStaticTemplate(lastProcessedTemplateContent, ap);
  }
  
  if (repeatStaticTemplates.length > 0) {
    staticTemplateCode += '\n' + repeatStaticTemplates.join('\n');
  }
  
  // Update imports for binding functions
  const hasAnyBindings = allBindings.length > 0 || allConditionals.length > 0 || 
    allWhenElseBlocks.length > 0 || allRepeatBlocks.length > 0 || allEventBindings.length > 0;
    
  if (hasAnyBindings && servicesImport) {
    const requiredFunctions: string[] = [];
    if (allBindings.some((b) => b.type === 'style')) requiredFunctions.push(BIND_FN.STYLE);
    if (allBindings.some((b) => b.type === 'attr')) requiredFunctions.push(BIND_FN.ATTR);
    if (allBindings.some((b) => b.type === 'text')) requiredFunctions.push(BIND_FN.TEXT);
    
    const hasSimpleConditionals = allConditionals.some((c) => c.signalNames.length === 1 && c.jsExpression === `${c.signalName}()`);
    const hasComplexConditionals = allConditionals.some((c) => c.signalNames.length > 1 || c.jsExpression !== `${c.signalName}()`);
    if (hasSimpleConditionals) requiredFunctions.push(BIND_FN.IF);
    if (hasComplexConditionals || allWhenElseBlocks.length > 0) requiredFunctions.push(BIND_FN.IF_EXPR);
    
    if (allRepeatBlocks.length > 0) {
      const usesOptimized = repeatStaticTemplates.length > 0;
      if (usesOptimized) requiredFunctions.push(BIND_FN.REPEAT_TPL);
      const hasNonOptimized = allRepeatBlocks.some(rep => {
        const hasItemBindings = rep.itemBindings.length > 0;
        const hasSignalBindings = rep.signalBindings.length > 0;
        const hasNestedRepeats = rep.nestedRepeats.length > 0;
        const hasNestedConditionals = rep.nestedConditionals.length > 0;
        const hasItemEvents = rep.itemEvents.length > 0;
        const canUseOptimized = hasItemBindings && 
          !hasSignalBindings && !hasNestedRepeats && !hasNestedConditionals && !hasItemEvents;
        return !canUseOptimized;
      });
      if (hasNonOptimized) requiredFunctions.push(BIND_FN.REPEAT);
    }
    
    const hasNestedRepeats = allRepeatBlocks.some((rep) => rep.nestedRepeats.length > 0);
    if (hasNestedRepeats) requiredFunctions.push(BIND_FN.NESTED_REPEAT);
    
    const hasNonOptimizedWithBindings = allRepeatBlocks.some((rep) => {
      const hasItemBindings = rep.itemBindings.length > 0;
      const hasSignalBindings = rep.signalBindings.length > 0;
      const hasNestedRepeatSubs = rep.nestedRepeats.length > 0;
      const hasNestedConditionals = rep.nestedConditionals.length > 0;
      const hasItemEvents = rep.itemEvents.length > 0;
      const canUseOptimized = hasItemBindings && 
        !hasSignalBindings && !hasNestedRepeatSubs && !hasNestedConditionals && !hasItemEvents;
      return (!canUseOptimized && hasItemBindings) || rep.nestedRepeats.some((nr) => nr.itemBindings.length > 0);
    });
    if (hasNonOptimizedWithBindings) requiredFunctions.push(BIND_FN.FIND_EL);
    if (allEventBindings.length > 0) requiredFunctions.push(BIND_FN.EVENTS);
    
    if (requiredFunctions.length > 0) {
      const newImport = generateUpdatedImport(servicesImport, requiredFunctions);
      edits.push({
        start: servicesImport.start,
        end: servicesImport.end,
        replacement: newImport,
      });
    }
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
      /defineComponent\s*\(/,
      `defineComponent('${selector}', `,
    );
  }
  
  // ── Step 1: Insert static template declarations before the export ──
  const exportMatch = result.match(/export\s+const\s+(\w+)\s*=\s*defineComponent\s*\(/);
  
  if (exportMatch && exportMatch.index !== undefined) {
    let declarations = '';
    if (staticTemplateCode.trim()) {
      declarations += staticTemplateCode.trim() + '\n';
    }
    
    if (declarations) {
      result = result.substring(0, exportMatch.index) + declarations + '\n' + result.substring(exportMatch.index);
    }
    
    // ── Step 2: Inject __bindings into the return object inside the setup fn ──
    if (hasAnyBindings && processedBindings.trim()) {
      // Build the __bindings arrow function
      const bindingsFnBody = `  __bindings: (ctx) => {\n  ${processedBindings.trim()}\n  },`;
      
      // Find the return object literal inside the setup function.
      // After template processing, the return has `template: \`\``.
      // We insert __bindings right after the opening brace of the return object.
      // Look for `return {` pattern inside the defineComponent call.
      const returnMatch = result.match(/return\s*\{/);
      if (returnMatch && returnMatch.index !== undefined) {
        const insertPos = returnMatch.index + returnMatch[0].length;
        result = result.substring(0, insertPos) + '\n' + bindingsFnBody + result.substring(insertPos);
      }
    }
    
    // ── Step 3: Pass __tpl + repeat templates as extra args to defineComponent() ──
    let extraArgs = '';
    if (lastProcessedTemplateContent) {
      extraArgs += ', __tpl';
    } else {
      extraArgs += ', undefined';
    }
    // No __compiledBindings arg needed — bindings are in the return object
    extraArgs += ', undefined';
    
    // Add repeat static templates as name/value pairs
    for (const name of repeatTemplateNames) {
      extraArgs += `, '${name}', ${name}`;
    }
    
    // Find the matching closing paren of defineComponent(
    const dcCallMatch = result.match(/defineComponent\s*\(/);
    if (dcCallMatch && dcCallMatch.index !== undefined) {
      let parenDepth = 0;
      let i = dcCallMatch.index + dcCallMatch[0].length - 1; // at the opening (
      for (; i < result.length; i++) {
        if (result[i] === '(') parenDepth++;
        else if (result[i] === ')') {
          parenDepth--;
          if (parenDepth === 0) {
            result = result.substring(0, i) + extraArgs + result.substring(i);
            break;
          }
        }
        // Skip over string literals and template literals
        if (result[i] === '`') {
          i++;
          while (i < result.length && result[i] !== '`') {
            if (result[i] === '\\') i++;
            i++;
          }
        } else if (result[i] === "'" || result[i] === '"') {
          const q = result[i];
          i++;
          while (i < result.length && result[i] !== q) {
            if (result[i] === '\\') i++;
            i++;
          }
        }
      }
    }
  }
  
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
