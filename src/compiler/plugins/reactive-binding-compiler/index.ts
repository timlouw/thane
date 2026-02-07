/**
 * Source transformation for reactive binding compiler
 * 
 * Handles TypeScript source file analysis, locating HTML/CSS templates,
 * finding imports, and orchestrating the full component transformation.
 */

import fs from 'fs';
import type { Plugin } from 'esbuild';
import ts from 'typescript';
import type { SignalExpression, ImportInfo, TemplateInfo } from '../../types.js';
import {
  findComponentClass,
  findSignalInitializers,
  getSignalGetterName,
  extractTemplateContent,
  isHtmlTemplate,
  isCssTemplate,
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

/**
 * Find all html-tagged template literals in the source file
 */
export const findHtmlTemplates = (sourceFile: ts.SourceFile): TemplateInfo[] => {
  const templates: TemplateInfo[] = [];

  const visit = (node: ts.Node, insideHtmlTemplate: boolean) => {
    if (ts.isTaggedTemplateExpression(node) && isHtmlTemplate(node)) {
      if (insideHtmlTemplate) {
        return; // Don't process or recurse into nested html templates
      }

      const template = node.template;
      const expressions: SignalExpression[] = [];

      if (ts.isTemplateExpression(template)) {
        for (const span of template.templateSpans) {
          if (ts.isCallExpression(span.expression)) {
            const signalName = getSignalGetterName(span.expression);
            if (signalName) {
              expressions.push({
                signalName,
                fullExpression: span.expression.getText(sourceFile),
                start: span.expression.getStart(sourceFile),
                end: span.expression.getEnd(),
              });
            }
          }
        }
      }

      templates.push({
        node,
        expressions,
        templateStart: node.getStart(sourceFile),
        templateEnd: node.getEnd(),
      });
      ts.forEachChild(node, (child) => visit(child, true));
      return; // Don't use the default forEachChild below
    }

    ts.forEachChild(node, (child) => visit(child, insideHtmlTemplate));
  };

  visit(sourceFile, false);
  return templates;
};

/**
 * Transform a component source file by processing HTML templates,
 * generating binding code, and updating imports.
 */
export const transformComponentSource = (source: string, filePath: string): string | null => {
  const sourceFile = sourceCache.parse(filePath, source);
  const componentClass = findComponentClass(sourceFile);
  if (!componentClass) {
    return null;
  }

  const signalInitializers = findSignalInitializers(sourceFile);
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
  const { code: initBindingsFunction, staticTemplates: repeatStaticTemplates } = generateInitBindingsFunction(allBindings, allConditionals, allWhenElseBlocks, allRepeatBlocks, allEventBindings, filePath);

  let staticTemplateCode = '';
  if (lastProcessedTemplateContent) {
    staticTemplateCode = generateStaticTemplate(lastProcessedTemplateContent);
  }
  
  // Add any static templates for optimized repeat bindings
  if (repeatStaticTemplates.length > 0) {
    staticTemplateCode += '\n' + repeatStaticTemplates.join('\n');
  }
  
  let classBodyStart: number | null = null;
  const classStart = componentClass.getStart(sourceFile);
  const classText = componentClass.getText(sourceFile);
  const braceIndex = classText.indexOf('{');
  if (braceIndex !== -1) {
    classBodyStart = classStart + braceIndex + 1;
  }
  const hasAnyBindings = allBindings.length > 0 || allConditionals.length > 0 || allWhenElseBlocks.length > 0 || allRepeatBlocks.length > 0 || allEventBindings.length > 0;
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
      // Check if any repeat uses optimized template-based approach
      const usesOptimized = repeatStaticTemplates.length > 0;
      if (usesOptimized) requiredFunctions.push(BIND_FN.REPEAT_TPL);
      // Still may need regular repeat for non-optimized cases
      const hasNonOptimized = allRepeatBlocks.some(rep => {
        const hasItemBindings = rep.itemBindings.length > 0;
        const hasSignalBindings = rep.signalBindings.length > 0;
        const hasNestedRepeats = rep.nestedRepeats.length > 0;
        const hasNestedConditionals = rep.nestedConditionals.length > 0;
        const hasItemEvents = rep.itemEvents.length > 0;
        const canUseOptimized = hasItemBindings && 
          !hasSignalBindings && 
          !hasNestedRepeats && 
          !hasNestedConditionals && 
          !hasItemEvents &&
          rep.itemBindings.every(b => !b.expression.includes('this.'));
        return !canUseOptimized;
      });
      if (hasNonOptimized) requiredFunctions.push(BIND_FN.REPEAT);
    }
    const hasNestedRepeats = allRepeatBlocks.some((rep) => rep.nestedRepeats.length > 0);
    if (hasNestedRepeats) requiredFunctions.push(BIND_FN.NESTED_REPEAT);
    // Only need __findEl for non-optimized repeat blocks or nested repeats
    const hasNonOptimizedWithBindings = allRepeatBlocks.some((rep) => {
      const hasItemBindings = rep.itemBindings.length > 0;
      const hasSignalBindings = rep.signalBindings.length > 0;
      const hasNestedRepeatSubs = rep.nestedRepeats.length > 0;
      const hasNestedConditionals = rep.nestedConditionals.length > 0;
      const hasItemEvents = rep.itemEvents.length > 0;
      const canUseOptimized = hasItemBindings && 
        !hasSignalBindings && 
        !hasNestedRepeatSubs && 
        !hasNestedConditionals && 
        !hasItemEvents &&
        rep.itemBindings.every(b => !b.expression.includes('this.'));
      // Need findEl if we have bindings but can't use optimized, or have nested repeats with bindings
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

  let result = applyEdits(source, edits);

  if (classBodyStart !== null) {
    const injectedCode = staticTemplateCode + initBindingsFunction;
    result = result.replace(/class\s+extends\s+Component\s*\{/, (match) => {
      return match + injectedCode;
    });
  }

  return result;
};

export { transformComponentSource as transformReactiveBindings };

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
        const transformed = transformComponentSource(source, args.path);

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
