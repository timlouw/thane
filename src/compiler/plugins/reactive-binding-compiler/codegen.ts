/**
 * Code generation for reactive binding compiler
 * 
 * Generates JavaScript code for bindings, subscriptions, static templates,
 * imports, and the initializeBindings function.
 */

import type {
  ConditionalBlock,
  WhenElseBlock,
  RepeatBlock,
  BindingInfo,
  EventBinding,
  ItemBinding,
  ItemEventBinding,
  RepeatOptimizationSkipReason,
} from './types.js';
import { generateStaticRepeatTemplate, getOptimizationSkipMessage } from './repeat-analysis.js';
import { toCamelCase, BIND_FN, logger, PLUGIN_NAME } from '../../utils/index.js';
import { injectIdIntoFirstElement } from '../../utils/html-parser.js';
import type { ImportInfo } from '../../types.js';

const NAME = PLUGIN_NAME.REACTIVE;

/**
 * Generate binding update code for a single binding
 */
export const generateBindingUpdateCode = (binding: BindingInfo): string => {
  const elRef = binding.id;

  if (binding.type === 'style') {
    const prop = toCamelCase(binding.property!);
    return `${elRef}.style.${prop} = v`;
  } else if (binding.type === 'attr') {
    return `${elRef}.setAttribute('${binding.property}', v)`;
  } else {
    return `${elRef}.textContent = v`;
  }
};

/**
 * Generate initial value assignment code for a binding
 */
export const generateInitialValueCode = (binding: BindingInfo): string => {
  const elRef = binding.id;
  const signalCall = `this.${binding.signalName}()`;

  if (binding.type === 'style') {
    const prop = toCamelCase(binding.property!);
    return `${elRef}.style.${prop} = ${signalCall}`;
  } else if (binding.type === 'attr') {
    return `${elRef}.setAttribute('${binding.property}', ${signalCall})`;
  } else {
    return `${elRef}.textContent = ${signalCall}`;
  }
};

/**
 * Group bindings by their signal name for consolidated subscriptions
 */
export const groupBindingsBySignal = (bindings: BindingInfo[]): Map<string, BindingInfo[]> => {
  const groups = new Map<string, BindingInfo[]>();
  for (const binding of bindings) {
    const existing = groups.get(binding.signalName) || [];
    existing.push(binding);
    groups.set(binding.signalName, existing);
  }
  return groups;
};

/**
 * Generate a consolidated subscription for multiple bindings of the same signal
 */
export const generateConsolidatedSubscription = (signalName: string, bindings: BindingInfo[]): string => {
  if (bindings.length === 1) {
    const update = generateBindingUpdateCode(bindings[0]!);
    return `this.${signalName}.subscribe(v => { ${update}; }, true)`;
  }
  const updates = bindings.map((b) => `      ${generateBindingUpdateCode(b)};`).join('\n');
  return `this.${signalName}.subscribe(v => {\n${updates}\n    }, true)`;
};

/**
 * Generate the initializeBindings function and static templates
 */
export const generateInitBindingsFunction = (
  bindings: BindingInfo[],
  conditionals: ConditionalBlock[],
  whenElseBlocks: WhenElseBlock[] = [],
  repeatBlocks: RepeatBlock[] = [],
  eventBindings: EventBinding[] = [],
  filePath: string = '',
): { code: string; staticTemplates: string[] } => {
  const lines: string[] = [];
  const staticTemplates: string[] = []; // Collect static templates for repeat optimizations
  lines.push('  initializeBindings = () => {');
  lines.push('    const r = this.shadowRoot;');
  const topLevelBindings = bindings.filter((b) => !b.isInsideConditional);
  const topLevelIds = [...new Set(topLevelBindings.map((b) => b.id))];
  if (topLevelIds.length > 0) {
    for (const id of topLevelIds) {
      lines.push(`    const ${id} = r.getElementById('${id}');`);
    }
  }
  for (const binding of topLevelBindings) {
    lines.push(`    ${generateInitialValueCode(binding)};`);
  }
  const signalGroups = groupBindingsBySignal(topLevelBindings);
  for (const [signalName, signalBindings] of signalGroups) {
    lines.push(`    ${generateConsolidatedSubscription(signalName, signalBindings)};`);
  }
  for (const cond of conditionals) {
    const nestedBindings = cond.nestedBindings;
    const nestedConds = cond.nestedConditionals || [];
    const escapedTemplate = cond.templateContent.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    let nestedCode = '() => []';
    if (nestedBindings.length > 0 || nestedConds.length > 0) {
      const nestedIds = [...new Set(nestedBindings.map((b) => b.id))];
      const nestedLines: string[] = [];
      nestedLines.push('() => {');
      for (const id of nestedIds) {
        nestedLines.push(`      const ${id} = r.getElementById('${id}');`);
      }
      for (const binding of nestedBindings) {
        nestedLines.push(`      ${generateInitialValueCode(binding)};`);
      }
      const nestedSignalGroups = groupBindingsBySignal(nestedBindings);
      nestedLines.push('      return [');
      for (const [signalName, signalBindings] of nestedSignalGroups) {
        nestedLines.push(`        ${generateConsolidatedSubscription(signalName, signalBindings)},`);
      }
      for (const nestedCond of nestedConds) {
        const nestedCondEscaped = nestedCond.templateContent.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        let innerNestedCode = '() => []';
        if (nestedCond.nestedBindings.length > 0) {
          const innerBindingLines: string[] = [];
          const innerIds = [...new Set(nestedCond.nestedBindings.map((b) => b.id))];
          innerBindingLines.push('() => {');
          for (const id of innerIds) {
            innerBindingLines.push(`        const ${id} = r.getElementById('${id}');`);
          }
          for (const binding of nestedCond.nestedBindings) {
            innerBindingLines.push(`        ${generateInitialValueCode(binding)};`);
          }
          const innerGroups = groupBindingsBySignal(nestedCond.nestedBindings);
          innerBindingLines.push('        return [');
          for (const [signalName, signalBindings] of innerGroups) {
            innerBindingLines.push(`          ${generateConsolidatedSubscription(signalName, signalBindings)},`);
          }
          innerBindingLines.push('        ];');
          innerBindingLines.push('      }');
          innerNestedCode = innerBindingLines.join('\n');
        }

        const isNestedSimple = nestedCond.signalNames.length === 1 && nestedCond.jsExpression === `this.${nestedCond.signalName}()`;
        if (isNestedSimple) {
          nestedLines.push(`        ${BIND_FN.IF}(r, this.${nestedCond.signalName}, '${nestedCond.id}', \`${nestedCondEscaped}\`, ${innerNestedCode}),`);
        } else {
          const nestedSignalsArray = nestedCond.signalNames.map((s) => `this.${s}`).join(', ');
          nestedLines.push(
            `        ${BIND_FN.IF_EXPR}(r, [${nestedSignalsArray}], () => ${nestedCond.jsExpression}, '${nestedCond.id}', \`${nestedCondEscaped}\`, ${innerNestedCode}),`,
          );
        }
      }

      nestedLines.push('      ];');
      nestedLines.push('    }');
      nestedCode = nestedLines.join('\n');
    }
    const isSimpleExpr = cond.signalNames.length === 1 && cond.jsExpression === `this.${cond.signalName}()`;

    if (isSimpleExpr) {
      lines.push(`    ${BIND_FN.IF}(r, this.${cond.signalName}, '${cond.id}', \`${escapedTemplate}\`, ${nestedCode});`);
    } else {
      const signalsArray = cond.signalNames.map((s) => `this.${s}`).join(', ');
      lines.push(`    ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${cond.jsExpression}, '${cond.id}', \`${escapedTemplate}\`, ${nestedCode});`);
    }
  }
  for (const we of whenElseBlocks) {
    const thenTemplateWithId = injectIdIntoFirstElement(we.thenTemplate, we.thenId);
    const elseTemplateWithId = injectIdIntoFirstElement(we.elseTemplate, we.elseId);
    const escapedThenTemplate = thenTemplateWithId.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const escapedElseTemplate = elseTemplateWithId.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const generateNestedInitializer = (bindings: BindingInfo[], nestedConds: ConditionalBlock[], nestedWE: WhenElseBlock[]): string => {
      if (bindings.length === 0 && nestedConds.length === 0 && nestedWE.length === 0) {
        return '() => []';
      }

      const initLines: string[] = [];
      initLines.push('() => {');
      const ids = [...new Set(bindings.map((b) => b.id))];
      for (const id of ids) {
        initLines.push(`      const ${id} = r.getElementById('${id}');`);
      }
      for (const binding of bindings) {
        initLines.push(`      ${generateInitialValueCode(binding)};`);
      }

      initLines.push('      return [');
      const signalGroups = groupBindingsBySignal(bindings);
      for (const [signalName, signalBindings] of signalGroups) {
        initLines.push(`        ${generateConsolidatedSubscription(signalName, signalBindings)},`);
      }
      for (const cond of nestedConds) {
        const nestedEscapedTemplate = cond.templateContent.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const nestedBindingsCode = generateNestedInitializer(cond.nestedBindings, [], []);
        const isSimple = cond.signalNames.length === 1 && cond.jsExpression === `this.${cond.signalName}()`;
        if (isSimple) {
          initLines.push(`        ${BIND_FN.IF}(r, this.${cond.signalName}, '${cond.id}', \`${nestedEscapedTemplate}\`, ${nestedBindingsCode}),`);
        } else {
          const signalsArray = cond.signalNames.map((s) => `this.${s}`).join(', ');
          initLines.push(`        ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${cond.jsExpression}, '${cond.id}', \`${nestedEscapedTemplate}\`, ${nestedBindingsCode}),`);
        }
      }
      for (const nestedWe of nestedWE) {
        const nestedThenWithId = injectIdIntoFirstElement(nestedWe.thenTemplate, nestedWe.thenId);
        const nestedElseWithId = injectIdIntoFirstElement(nestedWe.elseTemplate, nestedWe.elseId);
        const nestedThenTemplate = nestedThenWithId.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const nestedElseTemplate = nestedElseWithId.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const thenInitCode = generateNestedInitializer(
          nestedWe.thenBindings,
          nestedWe.nestedConditionals.filter((c) => nestedWe.thenBindings.some((b) => b.conditionalId === c.id) || true),
          nestedWe.nestedWhenElse,
        );
        const elseInitCode = generateNestedInitializer(nestedWe.elseBindings, [], []);
        const signalsArray = nestedWe.signalNames.map((s) => `this.${s}`).join(', ');
        initLines.push(`        ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${nestedWe.jsExpression}, '${nestedWe.thenId}', \`${nestedThenTemplate}\`, ${thenInitCode}),`);
        initLines.push(`        ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => !(${nestedWe.jsExpression}), '${nestedWe.elseId}', \`${nestedElseTemplate}\`, ${elseInitCode}),`);
      }

      initLines.push('      ];');
      initLines.push('    }');
      return initLines.join('\n');
    };
    const thenCode = generateNestedInitializer(we.thenBindings, we.nestedConditionals, we.nestedWhenElse);
    const elseCode = generateNestedInitializer(we.elseBindings, [], []);

    const signalsArray = we.signalNames.map((s) => `this.${s}`).join(', ');
    lines.push(`    ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${we.jsExpression}, '${we.thenId}', \`${escapedThenTemplate}\`, ${thenCode});`);
    lines.push(`    ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => !(${we.jsExpression}), '${we.elseId}', \`${escapedElseTemplate}\`, ${elseCode});`);
  }
  for (const rep of repeatBlocks) {
    const itemSignalVar = `${rep.itemVar}$`;
    const indexVar = rep.indexVar || '_idx';
    const hasItemBindings = rep.itemBindings.length > 0;
    const hasSignalBindings = rep.signalBindings.length > 0;
    const hasNestedRepeats = rep.nestedRepeats.length > 0;
    const hasNestedConditionals = rep.nestedConditionals.length > 0;
    const hasItemEvents = rep.itemEvents.length > 0;
    
    // Determine optimization skip reason (if any)
    let optimizationSkipReason: RepeatOptimizationSkipReason | null = null;
    
    const hasMixedBindings = rep.itemBindings.some(b => b.expression.includes('this.'));
    
    if (!hasItemBindings) {
      optimizationSkipReason = 'no-bindings';
    } else if (hasSignalBindings) {
      optimizationSkipReason = 'signal-bindings';
    } else if (hasNestedRepeats) {
      optimizationSkipReason = 'nested-repeat';
    } else if (hasNestedConditionals) {
      optimizationSkipReason = 'nested-conditional';
    } else if (hasItemEvents) {
      optimizationSkipReason = 'item-events';
    } else if (hasMixedBindings) {
      optimizationSkipReason = 'mixed-bindings';
    }
    
    const canUseOptimized = optimizationSkipReason === null;
    
    if (canUseOptimized) {
      // Use optimized template-based approach
      const staticInfo = generateStaticRepeatTemplate(rep.itemTemplate, rep.itemBindings, rep.itemVar);
      
      if (staticInfo.canUseOptimized && staticInfo.elementBindings.length > 0) {
        // Generate static template identifier
        const templateId = `__tpl_${rep.id}`;
        
        // Generate static template IIFE
        const escapedStaticHtml = staticInfo.staticHtml
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');
        
        staticTemplates.push(`  static ${templateId} = (() => { const t = document.createElement('template'); t.innerHTML = \`${escapedStaticHtml}\`; return t; })();`);
        
        // Generate element bindings array
        const bindingsArrayStr = staticInfo.elementBindings.map(eb => 
          `{ path: [${eb.path.join(', ')}], id: '${eb.id}' }`
        ).join(', ');
        
        // Generate fill function that sets initial values
        const fillStatements: string[] = [];
        for (let i = 0; i < staticInfo.elementBindings.length; i++) {
          const eb = staticInfo.elementBindings[i]!;
          for (const binding of eb.bindings) {
            const expr = binding.expression.replace(new RegExp(`\\b${rep.itemVar}\\b`, 'g'), 'item');
            if (binding.type === 'text') {
              fillStatements.push(`els[${i}].textContent = ${expr}`);
            } else if (binding.type === 'attr' && binding.property) {
              fillStatements.push(`els[${i}].setAttribute('${binding.property}', ${expr})`);
            }
          }
        }
        const fillFn = `(els, item, ${indexVar}) => { ${fillStatements.join('; ')}; }`;
        
        // Generate init bindings function with subscriptions
        const updateStatements: string[] = [];
        for (let i = 0; i < staticInfo.elementBindings.length; i++) {
          const eb = staticInfo.elementBindings[i]!;
          for (const binding of eb.bindings) {
            const expr = binding.expression.replace(new RegExp(`\\b${rep.itemVar}\\b`, 'g'), 'v');
            if (binding.type === 'text') {
              updateStatements.push(`els[${i}].textContent = ${expr}`);
            } else if (binding.type === 'attr' && binding.property) {
              updateStatements.push(`els[${i}].setAttribute('${binding.property}', ${expr})`);
            }
          }
        }
        const initFn = `(els, ${itemSignalVar}, ${indexVar}) => [${itemSignalVar}.subscribe(v => { ${updateStatements.join('; ')} }, true)]`;
        
        // Build the optimized call
        let bindRepeatCall = `${BIND_FN.REPEAT_TPL}(r, this.${rep.signalName}, '${rep.id}', this.constructor.${templateId}, [${bindingsArrayStr}], ${fillFn}, ${initFn}`;
        
        if (rep.emptyTemplate) {
          const escapedEmptyTemplate = rep.emptyTemplate.replace(/`/g, '\\`');
          bindRepeatCall += `, \`${escapedEmptyTemplate}\``;
        } else if (rep.trackByFn) {
          bindRepeatCall += `, undefined`;
        }
        
        if (rep.trackByFn) {
          bindRepeatCall += `, ${rep.trackByFn}`;
        }
        
        bindRepeatCall += ')';
        lines.push(`    ${bindRepeatCall};`);
        continue; // Skip the fallback path
      } else if (staticInfo.skipReason) {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        if (staticInfo.skipReason === 'multi-root') {
          logger.error(NAME, `repeat() template in ${fileName} has multiple root elements. ` +
            `Wrap in a single container element for optimized rendering.`);
        } else {
          logger.warn(NAME, `repeat() in ${fileName}: ${getOptimizationSkipMessage(staticInfo.skipReason)}`);
        }
      }
    } else if (optimizationSkipReason && hasItemBindings) {
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      logger.verbose(`[${NAME}] repeat() in ${fileName} using fallback: ${getOptimizationSkipMessage(optimizationSkipReason)}`);
    }
    
    // Fallback to string-based approach
    const escapedItemTemplate = rep.itemTemplate
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
    const templateFn = `(${itemSignalVar}, ${indexVar}) => \`${escapedItemTemplate}\``;
    let initItemBindingsFn: string;

    if (!hasItemBindings && !hasSignalBindings && !hasNestedRepeats && !hasNestedConditionals) {
      initItemBindingsFn = `(els, ${itemSignalVar}, ${indexVar}) => []`;
    } else {
      const subscriptionLines: string[] = [];
      const nestedRepeatLines: string[] = [];
      const nestedConditionalLines: string[] = [];
      const findElCode = `const $ = (id) => ${BIND_FN.FIND_EL}(els, id);`;
      const findTextNodeCode = `const $t = (id) => ${BIND_FN.FIND_TEXT_NODE}(els, id);`;
      if (hasItemBindings) {
        const pureItemBindings: ItemBinding[] = [];
        const mixedBindings: { binding: ItemBinding; componentSignals: Set<string> }[] = [];
        
        const hasCommentMarkerBindings = rep.itemBindings.some(b => b.type === 'text' && b.textBindingMode === 'commentMarker');

        for (const binding of rep.itemBindings) {
          const componentSignalRegex = /this\.(_\w+)\(\)/g;
          const componentSignals = new Set<string>();
          let signalMatch: RegExpExecArray | null;
          while ((signalMatch = componentSignalRegex.exec(binding.expression)) !== null) {
            componentSignals.add(signalMatch[1]!);
          }
          componentSignalRegex.lastIndex = 0;

          if (componentSignals.size === 0) {
            pureItemBindings.push(binding);
          } else {
            mixedBindings.push({ binding, componentSignals });
          }
        }
        if (pureItemBindings.length > 0) {
          const bindingsByElement = new Map<string, ItemBinding[]>();
          for (const binding of pureItemBindings) {
            if (!bindingsByElement.has(binding.elementId)) {
              bindingsByElement.set(binding.elementId, []);
            }
            bindingsByElement.get(binding.elementId)!.push(binding);
          }
          
          const elementIds = Array.from(bindingsByElement.keys());
          const elementCacheDecls: string[] = [];
          const updateStatements: string[] = [];
          
          let elIdx = 0;
          for (const [elementId, bindings] of bindingsByElement) {
            const cachedVar = `_e${elIdx}`;
            const useTextNode = bindings.some(b => b.type === 'text' && b.textBindingMode === 'commentMarker');
            
            if (useTextNode) {
              elementCacheDecls.push(`${cachedVar} = $t('${elementId}')`);
            } else {
              elementCacheDecls.push(`${cachedVar} = $('${elementId}')`);
            }
            
            for (const binding of bindings) {
              const signalExpr = binding.expression.replace(new RegExp(`\\b${rep.itemVar}\\b`, 'g'), `v`);
              if (binding.type === 'text') {
                updateStatements.push(`${cachedVar}.textContent = ${signalExpr}`);
              } else if (binding.type === 'attr' && binding.property) {
                updateStatements.push(`${cachedVar}.setAttribute('${binding.property}', ${signalExpr})`);
              } else if (binding.type === 'style' && binding.property) {
                updateStatements.push(`${cachedVar}.style.${binding.property} = ${signalExpr}`);
              }
            }
            elIdx++;
          }

          if (updateStatements.length > 0) {
            subscriptionLines.push(`((${elementCacheDecls.join(', ')}) => ${itemSignalVar}.subscribe(v => { ${updateStatements.join('; ')} }, true))()`);
          }
        }
        for (const { binding, componentSignals } of mixedBindings) {
          const signalExpr = binding.expression.replace(new RegExp(`\\b${rep.itemVar}\\b`, 'g'), `${itemSignalVar}()`);
          let updateStmt: string;
          if (binding.type === 'text') {
            if (binding.textBindingMode === 'commentMarker') {
              updateStmt = `e = $t('${binding.elementId}'); if (e) e.textContent = ${signalExpr};`;
            } else {
              updateStmt = `e = $('${binding.elementId}'); if (e) e.textContent = ${signalExpr};`;
            }
          } else if (binding.type === 'attr' && binding.property) {
            updateStmt = `e = $('${binding.elementId}'); if (e) e.setAttribute('${binding.property}', ${signalExpr});`;
          } else if (binding.type === 'style' && binding.property) {
            updateStmt = `e = $('${binding.elementId}'); if (e) e.style.${binding.property} = ${signalExpr};`;
          } else {
            continue;
          }
          subscriptionLines.push(`${itemSignalVar}.subscribe(() => { let e; ${updateStmt} }, true)`);
          for (const componentSignal of componentSignals) {
            subscriptionLines.push(`this.${componentSignal}.subscribe(() => { let e; ${updateStmt} }, true)`);
          }
        }
      }
      if (hasSignalBindings) {
        const signalGroups = groupBindingsBySignal(rep.signalBindings);

        for (const [signalName, bindings] of signalGroups) {
          const updateStatements: string[] = [];

          for (const binding of bindings) {
            if (binding.type === 'text') {
              updateStatements.push(`e = $('${binding.id}'); if (e) e.textContent = v;`);
            } else if (binding.type === 'attr' && binding.property) {
              updateStatements.push(`e = $('${binding.id}'); if (e) e.setAttribute('${binding.property}', v);`);
            } else if (binding.type === 'style' && binding.property) {
              const prop = toCamelCase(binding.property);
              updateStatements.push(`e = $('${binding.id}'); if (e) e.style.${prop} = v;`);
            }
          }

          if (updateStatements.length > 0) {
            subscriptionLines.push(`this.${signalName}.subscribe(v => { let e; ${updateStatements.join(' ')} }, true)`);
          }
        }
      }
      if (hasNestedRepeats) {
        for (const nestedRep of rep.nestedRepeats) {
          const nestedEscapedTemplate = nestedRep.itemTemplate.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

          const nestedItemSignalVar = `${nestedRep.itemVar}$`;
          const nestedIndexVar = nestedRep.indexVar || '_idx2';
          const nestedTemplateFn = `(${nestedItemSignalVar}, ${nestedIndexVar}) => \`${nestedEscapedTemplate}\``;
          let nestedInitBindingsFn: string;
          const hasNestedItemBindings = nestedRep.itemBindings.length > 0;
          const hasNestedConditionalsInNested = nestedRep.nestedConditionals.length > 0;

          if (hasNestedItemBindings || hasNestedConditionalsInNested) {
            const nestedFindElCode = `const $n = (id) => ${BIND_FN.FIND_EL}(nel, id);`;
            const nestedUpdates: string[] = [];
            if (hasNestedItemBindings) {
              const pureNestedBindings: typeof nestedRep.itemBindings = [];
              const mixedNestedBindings: { binding: (typeof nestedRep.itemBindings)[0]; componentSignals: Set<string> }[] = [];

              for (const binding of nestedRep.itemBindings) {
                const componentSignalRegex = /this\.(_\w+)\(\)/g;
                const componentSignals = new Set<string>();
                let signalMatch: RegExpExecArray | null;
                while ((signalMatch = componentSignalRegex.exec(binding.expression)) !== null) {
                  componentSignals.add(signalMatch[1]!);
                }
                componentSignalRegex.lastIndex = 0;

                if (componentSignals.size === 0) {
                  pureNestedBindings.push(binding);
                } else {
                  mixedNestedBindings.push({ binding, componentSignals });
                }
              }
              if (pureNestedBindings.length > 0) {
                const updateStatements: string[] = [];
                for (const binding of pureNestedBindings) {
                  const signalExpr = binding.expression.replace(new RegExp(`\\b${nestedRep.itemVar}\\b`, 'g'), `v`);
                  if (binding.type === 'text') {
                    updateStatements.push(`e = $n('${binding.elementId}'); if (e) e.textContent = ${signalExpr};`);
                  } else if (binding.type === 'attr' && binding.property) {
                    updateStatements.push(`e = $n('${binding.elementId}'); if (e) e.setAttribute('${binding.property}', ${signalExpr});`);
                  }
                }
                if (updateStatements.length > 0) {
                  nestedUpdates.push(`${nestedItemSignalVar}.subscribe(v => { let e; ${updateStatements.join(' ')} }, true)`);
                }
              }
              for (const { binding, componentSignals } of mixedNestedBindings) {
                const signalExpr = binding.expression.replace(new RegExp(`\\b${nestedRep.itemVar}\\b`, 'g'), `${nestedItemSignalVar}()`);
                let updateStmt: string;
                if (binding.type === 'text') {
                  updateStmt = `e = $n('${binding.elementId}'); if (e) e.textContent = ${signalExpr};`;
                } else if (binding.type === 'attr' && binding.property) {
                  updateStmt = `e = $n('${binding.elementId}'); if (e) e.setAttribute('${binding.property}', ${signalExpr});`;
                } else {
                  continue;
                }

                nestedUpdates.push(`${nestedItemSignalVar}.subscribe(() => { let e; ${updateStmt} }, true)`);
                for (const componentSignal of componentSignals) {
                  nestedUpdates.push(`this.${componentSignal}.subscribe(() => { let e; ${updateStmt} }, true)`);
                }
              }
            }
            for (const nestedCond of nestedRep.nestedConditionals) {
              let condEscapedTemplate = nestedCond.templateContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
              const escapedSignalVar = nestedItemSignalVar.replace(/\$/g, '\\$');
              const itemSignalPattern = new RegExp(`\\$\\{${escapedSignalVar}\\(\\)\\}`, 'g');
              const placeholder = '___ITEM_SIGNAL_PLACEHOLDER___';
              condEscapedTemplate = condEscapedTemplate.replace(itemSignalPattern, placeholder);
              condEscapedTemplate = condEscapedTemplate.replace(/\$/g, '\\$');
              condEscapedTemplate = condEscapedTemplate.replace(new RegExp(placeholder, 'g'), `\${${nestedItemSignalVar}()}`);
              const condBindingUpdates: string[] = [];
              for (const binding of nestedCond.nestedBindings) {
                if (binding.type === 'text') {
                  condBindingUpdates.push(`this.${binding.signalName}.subscribe(v => { const el = $n('${binding.id}'); if (el) el.textContent = v; }, true)`);
                } else if (binding.type === 'attr' && binding.property) {
                  condBindingUpdates.push(
                    `this.${binding.signalName}.subscribe(v => { const el = $n('${binding.id}'); if (el) el.setAttribute('${binding.property}', v); }, true)`,
                  );
                } else if (binding.type === 'style' && binding.property) {
                  const prop = toCamelCase(binding.property);
                  condBindingUpdates.push(`this.${binding.signalName}.subscribe(v => { const el = $n('${binding.id}'); if (el) el.style.${prop} = v; }, true)`);
                }
              }
              for (const binding of nestedCond.nestedItemBindings) {
                const signalExpr = binding.expression.replace(new RegExp(`\\b${nestedRep.itemVar}\\b`, 'g'), `${nestedItemSignalVar}()`);

                if (binding.type === 'text') {
                  condBindingUpdates.push(`${nestedItemSignalVar}.subscribe(() => { const el = $n('${binding.elementId}'); if (el) el.textContent = ${signalExpr}; }, true)`);
                } else if (binding.type === 'attr' && binding.property) {
                  condBindingUpdates.push(
                    `${nestedItemSignalVar}.subscribe(() => { const el = $n('${binding.elementId}'); if (el) el.setAttribute('${binding.property}', ${signalExpr}); }, true)`,
                  );
                }
              }

              let condNestedCode = '() => []';
              if (condBindingUpdates.length > 0) {
                condNestedCode = `() => [${condBindingUpdates.join(', ')}]`;
              }
              const isSimple = nestedCond.signalNames.length === 1 && nestedCond.jsExpression === `this.${nestedCond.signalName}()`;

              if (isSimple) {
                nestedUpdates.push(`${BIND_FN.IF}({ getElementById: $n }, this.${nestedCond.signalName}, '${nestedCond.id}', \`${condEscapedTemplate}\`, ${condNestedCode})`);
              } else {
                const signalsArray = nestedCond.signalNames.map((s) => `this.${s}`).join(', ');
                nestedUpdates.push(
                  `${BIND_FN.IF_EXPR}({ getElementById: $n }, [${signalsArray}], () => ${nestedCond.jsExpression}, '${nestedCond.id}', \`${condEscapedTemplate}\`, ${condNestedCode})`,
                );
              }
            }
            nestedInitBindingsFn = `(nel, ${nestedItemSignalVar}, ${nestedIndexVar}) => { ${nestedFindElCode} return [${nestedUpdates.join(', ')}]; }`;
          } else {
            nestedInitBindingsFn = `(nel, ${nestedItemSignalVar}, ${nestedIndexVar}) => []`;
          }
          let nestedArrayExpr: string;
          const refsParentItem = new RegExp(`\\b${rep.itemVar}\\b`).test(nestedRep.itemsExpression);

          if (refsParentItem) {
            nestedArrayExpr = nestedRep.itemsExpression.replace(new RegExp(`\\b${rep.itemVar}\\b`, 'g'), `${itemSignalVar}()`);
          } else {
            nestedArrayExpr = nestedRep.itemsExpression;
          }

          nestedRepeatLines.push(`${BIND_FN.NESTED_REPEAT}(els, ${itemSignalVar}, () => ${nestedArrayExpr}, '${nestedRep.id}', ${nestedTemplateFn}, ${nestedInitBindingsFn})`);
        }
      }
      if (hasNestedConditionals) {
        for (const nestedCond of rep.nestedConditionals) {
          const condEscapedTemplate = nestedCond.templateContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
          let condNestedCode = '() => []';
          if (nestedCond.nestedBindings.length > 0) {
            const condBindingUpdates: string[] = [];
            for (const binding of nestedCond.nestedBindings) {
              if (binding.type === 'text') {
                condBindingUpdates.push(`this.${binding.signalName}.subscribe(v => { const el = $('${binding.id}'); if (el) el.textContent = v; }, true)`);
              } else if (binding.type === 'attr' && binding.property) {
                condBindingUpdates.push(`this.${binding.signalName}.subscribe(v => { const el = $('${binding.id}'); if (el) el.setAttribute('${binding.property}', v); }, true)`);
              } else if (binding.type === 'style' && binding.property) {
                const prop = toCamelCase(binding.property);
                condBindingUpdates.push(`this.${binding.signalName}.subscribe(v => { const el = $('${binding.id}'); if (el) el.style.${prop} = v; }, true)`);
              }
            }
            if (condBindingUpdates.length > 0) {
              condNestedCode = `() => [${condBindingUpdates.join(', ')}]`;
            }
          }
          const isSimple = nestedCond.signalNames.length === 1 && nestedCond.jsExpression === `this.${nestedCond.signalName}()`;

          if (isSimple) {
            nestedConditionalLines.push(`${BIND_FN.IF}({ getElementById: $ }, this.${nestedCond.signalName}, '${nestedCond.id}', \`${condEscapedTemplate}\`, ${condNestedCode})`);
          } else {
            const signalsArray = nestedCond.signalNames.map((s) => `this.${s}`).join(', ');
            nestedConditionalLines.push(
              `${BIND_FN.IF_EXPR}({ getElementById: $ }, [${signalsArray}], () => ${nestedCond.jsExpression}, '${nestedCond.id}', \`${condEscapedTemplate}\`, ${condNestedCode})`,
            );
          }
        }
      }
      const allCleanupLines = [...subscriptionLines, ...nestedRepeatLines, ...nestedConditionalLines];

      const needsTextNodeHelper = rep.itemBindings.some(b => b.type === 'text' && b.textBindingMode === 'commentMarker');
      const helperCode = needsTextNodeHelper 
        ? `${findElCode} ${findTextNodeCode}` 
        : findElCode;

      if (allCleanupLines.length > 0) {
        initItemBindingsFn = `(els, ${itemSignalVar}, ${indexVar}) => { ${helperCode} return [\n      ${allCleanupLines.join(',\n      ')}\n    ]; }`;
      } else {
        initItemBindingsFn = `(els, ${itemSignalVar}, ${indexVar}) => []`;
      }
    }
    let itemEventHandlersArg = '';
    if (rep.itemEvents.length > 0) {
      const eventsByType = new Map<string, ItemEventBinding[]>();
      for (const evt of rep.itemEvents) {
        if (!eventsByType.has(evt.eventName)) {
          eventsByType.set(evt.eventName, []);
        }
        eventsByType.get(evt.eventName)!.push(evt);
      }
      const eventTypeLines: string[] = [];
      for (const [eventType, handlers] of eventsByType) {
        const handlerLines = handlers.map((h) => {
          let handlerExpr = h.handlerExpression;
          handlerExpr = handlerExpr.replace(new RegExp(`\\b${rep.itemVar}\\b`, 'g'), `${itemSignalVar}()`);
          if (rep.indexVar) {
            handlerExpr = handlerExpr.replace(new RegExp(`\\b${rep.indexVar}\\b`, 'g'), indexVar);
          }
          const arrowMatch = handlerExpr.match(/^\s*\(?([^)]*)\)?\s*=>\s*(.+)$/);
          if (arrowMatch && arrowMatch[2]) {
            const body = arrowMatch[2].trim();
            if (!body.startsWith('{')) {
              handlerExpr = body;
            } else {
              handlerExpr = body.slice(1, -1).trim();
            }
          } else if (/^this\._?\w+$/.test(handlerExpr)) {
            handlerExpr = `${handlerExpr}(e)`;
          }

          return `'${h.eventId}': (${itemSignalVar}, ${indexVar}, e) => { ${handlerExpr}; }`;
        });
        eventTypeLines.push(`${eventType}: { ${handlerLines.join(', ')} }`);
      }

      itemEventHandlersArg = `, { ${eventTypeLines.join(', ')} }`;
    }
    let bindRepeatCall = `${BIND_FN.REPEAT}(r, this.${rep.signalName}, '${rep.id}', ${templateFn}, ${initItemBindingsFn}`;
    if (rep.emptyTemplate) {
      const escapedEmptyTemplate = rep.emptyTemplate.replace(/`/g, '\\`');
      bindRepeatCall += `, \`${escapedEmptyTemplate}\``;
    } else if (itemEventHandlersArg || rep.trackByFn) {
      bindRepeatCall += `, undefined`;
    }
    if (itemEventHandlersArg) {
      bindRepeatCall += itemEventHandlersArg;
    } else if (rep.trackByFn) {
      bindRepeatCall += `, undefined`;
    }
    if (rep.trackByFn) {
      bindRepeatCall += `, ${rep.trackByFn}`;
    }

    bindRepeatCall += ')';

    lines.push(`    ${bindRepeatCall};`);
  }
  if (eventBindings.length > 0) {
    const eventsByType = new Map<string, EventBinding[]>();
    for (const evt of eventBindings) {
      if (!eventsByType.has(evt.eventName)) {
        eventsByType.set(evt.eventName, []);
      }
      eventsByType.get(evt.eventName)!.push(evt);
    }
    const eventMapLines: string[] = [];
    for (const [eventType, handlers] of eventsByType) {
      const handlerEntries = handlers.map((h) => {
        let handlerCode = h.handlerExpression;
        if (/^this\.\w+$/.test(handlerCode)) {
          handlerCode = `(e) => ${handlerCode}.call(this, e)`;
        } else if (/^this\._?\w+$/.test(handlerCode)) {
          handlerCode = `(e) => ${handlerCode}.call(this, e)`;
        }
        return `'${h.id}': ${handlerCode}`;
      });
      eventMapLines.push(`      ${eventType}: { ${handlerEntries.join(', ')} }`);
    }

    lines.push(`    ${BIND_FN.EVENTS}(r, {`);
    lines.push(eventMapLines.join(',\n'));
    lines.push('    });');
  }

  lines.push('  };');

  return { code: '\n\n' + lines.join('\n'), staticTemplates };
};

/**
 * Generate a static template property for pre-compiled HTML
 */
export const generateStaticTemplate = (content: string): string => {
  const escapedContent = content.replace(/`/g, '\\`');
  return `
  static template = (() => {
    const t = document.createElement('template');
    t.innerHTML = \`${escapedContent}\`;
    return t;
  })();`;
};

/**
 * Generate an updated import statement with additional bind functions
 */
export const generateUpdatedImport = (importInfo: ImportInfo, requiredBindFunctions: string[]): string => {
  const allImports = [...importInfo.namedImports, ...requiredBindFunctions];
  return `import { ${allImports.join(', ')} } from ${importInfo.quoteChar}${importInfo.moduleSpecifier}${importInfo.quoteChar}`;
};
