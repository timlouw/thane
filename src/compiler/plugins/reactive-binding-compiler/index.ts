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
 * Find signal variable names within a defineComponent setup function.
 * These are const/let declarations initialized with signal(...).
 */
const findSetupSignalNames = (sourceFile: ts.SourceFile): Set<string> => {
  const signalNames = new Set<string>();
  
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && 
        ts.isIdentifier(node.name) && 
        node.initializer && 
        ts.isCallExpression(node.initializer)) {
      const callExpr = node.initializer;
      if (ts.isIdentifier(callExpr.expression) && callExpr.expression.text === 'signal') {
        signalNames.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  
  visit(sourceFile);
  return signalNames;
};

/**
 * Normalize bare signal calls ONLY inside html`...` template literals.
 * Transforms signalName() → this.signalName() within template expressions
 * so the existing template processing pipeline can handle them.
 * 
 * IMPORTANT: This must NOT touch signal calls in the setup function body
 * (e.g. rows(buildData(1000))) — those are real closure calls and must
 * stay as bare names.  Only template content needs the this. prefix for
 * the downstream regex-based pipeline.
 */
const normalizeSignalCallsInTemplates = (source: string, signalNames: Set<string>): string => {
  if (signalNames.size === 0) return source;
  
  // Find html`...` template literals and normalize only within them.
  // We match the tag + backtick-delimited content.
  // Template literals can contain nested ${} expressions with their own backticks,
  // so we use a simple depth-tracking approach.
  const result: string[] = [];
  let i = 0;
  
  while (i < source.length) {
    // Look for html`
    const htmlTagIdx = source.indexOf('html`', i);
    if (htmlTagIdx === -1) {
      result.push(source.substring(i));
      break;
    }
    
    // Push everything before this template literal
    result.push(source.substring(i, htmlTagIdx));
    
    // Find the end of this template literal (handling nested ${...} with depth tracking)
    const backtickStart = htmlTagIdx + 4; // index of the opening `
    let depth = 1;
    let j = backtickStart + 1; // start after the opening `
    
    while (j < source.length && depth > 0) {
      if (source[j] === '\\') {
        j += 2; // skip escaped char
        continue;
      }
      if (source[j] === '`') {
        depth--;
        if (depth === 0) break;
      }
      if (source[j] === '$' && j + 1 < source.length && source[j + 1] === '{') {
        // Entering a template expression — need to track braces and nested backticks
        j += 2;
        let braceDepth = 1;
        while (j < source.length && braceDepth > 0) {
          if (source[j] === '\\') {
            j += 2;
            continue;
          }
          if (source[j] === '{') braceDepth++;
          else if (source[j] === '}') braceDepth--;
          else if (source[j] === '`') {
            // Nested template literal inside expression
            j++;
            while (j < source.length && source[j] !== '`') {
              if (source[j] === '\\') j++;
              j++;
            }
          }
          if (braceDepth > 0) j++;
        }
        // j is now at the closing }
        j++;
        continue;
      }
      j++;
    }
    
    // source[backtickStart..j] is the entire template literal content including backticks
    let templateContent = source.substring(htmlTagIdx, j + 1); // html`...`
    
    // Normalize signal calls within this template
    for (const name of signalNames) {
      const regex = new RegExp(`(?<!this\\.)(?<![\\w.])\\b(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\(`, 'g');
      templateContent = templateContent.replace(regex, `this.${name}(`);
    }
    
    result.push(templateContent);
    i = j + 1;
  }
  
  return result.join('');
};

/**
 * Strip this. prefix from generated binding code for defineComponent.
 * In defineComponent, signals are closure variables, not class properties.
 */
const stripThisFromBindings = (code: string): string => {
  // Replace this.signalName patterns in binding code
  // this.shadowRoot → ctx.root (handled separately)
  // this.constructor.X → X (for static template refs)
  // this.signalName → signalName
  // .call(this, e) → .call(null, e) (event handler context)
  return code
    .replace(/this\.shadowRoot/g, 'ctx.root')
    .replace(/this\.constructor\./g, '')
    .replace(/\.call\(this,/g, '.call(null,')
    .replace(/this\.(\w+)/g, '$1');
};

/**
 * Transform a defineComponent source file by processing HTML templates,
 * generating binding code, and injecting static templates.
 * 
 * Uses source normalization to reuse the existing template processing pipeline:
 * 1. Find signal names in the setup function
 * 2. Normalize ${signal()} → ${this.signal()} in templates
 * 3. Run the standard template processing pipeline
 * 4. Strip this. from generated code (signals are closures, not class properties)
 * 5. Inject __template and __bindings as properties on the setup function
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
  
  // Find signal names in the source
  const signalNames = findSetupSignalNames(sourceFile);
  const signalInitializers = findSignalInitializers(sourceFile);
  
  // Normalize signal calls in templates: ${signal()} → ${this.signal()}
  let normalizedSource = normalizeSignalCallsInTemplates(source, signalNames);
  
  // Re-parse after normalization
  const normalizedSourceFile = sourceCache.parse(filePath + '.normalized', normalizedSource);
  
  // Find html templates in the normalized source
  const servicesImport = findServicesImport(normalizedSourceFile);
  const htmlTemplates = findHtmlTemplates(normalizedSourceFile);
  
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
    let templateContent = extractTemplateContent(templateInfo.node.template, normalizedSourceFile);
    
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
      const cssContent = extractTemplateContent(node.template, normalizedSourceFile);
      edits.push({
        start: node.getStart(normalizedSourceFile),
        end: node.getEnd(),
        replacement: '`' + cssContent + '`',
      });
    }
    ts.forEachChild(node, visitCss);
  };
  visitCss(normalizedSourceFile);
  
  // Generate bindings code
  const { code: initBindingsFunction, staticTemplates: repeatStaticTemplates } = generateInitBindingsFunction(
    allBindings, allConditionals, allWhenElseBlocks, allRepeatBlocks, allEventBindings, filePath,
  );
  
  let staticTemplateCode = '';
  if (lastProcessedTemplateContent) {
    staticTemplateCode = generateStaticTemplate(lastProcessedTemplateContent);
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
    
    const hasSimpleConditionals = allConditionals.some((c) => c.signalNames.length === 1 && c.jsExpression === `this.${c.signalName}()`);
    const hasComplexConditionals = allConditionals.some((c) => c.signalNames.length > 1 || c.jsExpression !== `this.${c.signalName}()`);
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
          !hasSignalBindings && !hasNestedRepeats && !hasNestedConditionals && !hasItemEvents &&
          rep.itemBindings.every(b => !b.expression.includes('this.'));
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
        !hasSignalBindings && !hasNestedRepeatSubs && !hasNestedConditionals && !hasItemEvents &&
        rep.itemBindings.every(b => !b.expression.includes('this.'));
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
  
  // Apply all edits to the normalized source
  let result = applyEdits(normalizedSource, edits);
  
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

  // Strip `this.` from generated code — signals are closures, not class props
  let processedStaticTemplate = stripThisFromBindings(staticTemplateCode);
  let processedBindings = stripThisFromBindings(initBindingsFunction);
  
  // Transform static template from class property to standalone const
  processedStaticTemplate = processedStaticTemplate
    .replace(/^\s*static template =/, 'const __tpl =')
    .replace(/^\s*static (__tpl_\w+) =/gm, 'const $1 =');
  
  // Transform initializeBindings from class method to a function body
  // that receives the component context (for root element access).
  // We strip the wrapper — the body will be placed inside a __bindings arrow fn.
  processedBindings = processedBindings
    .replace(/\s*initializeBindings = \(\) => \{\s*/, '')
    .replace(/\s*const r = this\.shadowRoot;\s*/, '')
    .replace(/\};\s*$/, '');
  // Replace remaining `r.` (was `this.shadowRoot.`) with `ctx.root.`
  // Note: stripThisFromBindings already turned `this.shadowRoot` → `ctx.root`,
  // but the codegen creates a local `const r = this.shadowRoot` alias.
  // After stripping that line, all `r.getElementById` should use `ctx.root.`
  processedBindings = processedBindings.replace(/\br\.getElementById/g, 'ctx.root.getElementById');
  // Also replace bare `r.` used as parentNode etc — but only standalone `r.`
  processedBindings = processedBindings.replace(/\br\.querySelector/g, 'ctx.root.querySelector');
  // The `r` variable was `this.shadowRoot` — any remaining standalone `r.` or `r,` 
  // in generated code should map to `ctx.root`
  processedBindings = processedBindings.replace(/\br\.parentNode/g, 'ctx.root.parentNode');
  
  // Collect repeat static template names
  const repeatTemplateNames: string[] = [];
  const repeatTplRegex = /const (__tpl_\w+) =/g;
  let tplMatch: RegExpExecArray | null;
  while ((tplMatch = repeatTplRegex.exec(processedStaticTemplate)) !== null) {
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
    if (processedStaticTemplate.trim()) {
      declarations += processedStaticTemplate.trim() + '\n';
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
