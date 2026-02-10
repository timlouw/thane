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
  SimpleBinding,
  EventBinding,
  ItemBinding,
  ItemEventBinding,
  RepeatOptimizationSkipReason,
  AccessPattern,
} from './types.js';
import { CLASS_ACCESS, isExpressionBinding, isSimpleBinding } from './types.js';
import { generateStaticRepeatTemplate, getOptimizationSkipMessage } from './repeat-analysis.js';
import { toCamelCase, BIND_FN, logger, PLUGIN_NAME, renameIdentifierInExpression, expressionReferencesIdentifier, findComponentSignalCalls, parseArrowFunction, isThisMethodReference } from '../../utils/index.js';
import { injectIdIntoFirstElement } from '../../utils/html-parser/index.js';
import type { ImportInfo } from '../../types.js';

const NAME = PLUGIN_NAME.REACTIVE;

// ============================================================================
// Event Delegation Types & Helpers
// ============================================================================

/** A single event binding that can be dispatched via container-level delegation */
interface DelegatedEvent {
  path: number[];
  handlerExpr: string;
  modifiers: string[];
}

/** Result of partitioning item events into delegatable vs non-delegatable */
interface PartitionedEvents {
  delegatedByType: Map<string, DelegatedEvent[]>;
  nonDelegatable: ItemEventBinding[];
}

/**
 * Partition item events into delegatable (container-level listener) and
 * non-delegatable (.self modifier or missing path) groups.
 */
const partitionItemEvents = (
  itemEvents: ItemEventBinding[],
  eventElementPaths: Map<string, number[]> | undefined,
  rep: RepeatBlock,
  indexVar: string,
  ap: AccessPattern,
): PartitionedEvents => {
  const delegatedByType = new Map<string, DelegatedEvent[]>();
  const nonDelegatable: ItemEventBinding[] = [];

  if (!eventElementPaths) return { delegatedByType, nonDelegatable };

  for (const evt of itemEvents) {
    const evtPath = eventElementPaths.get(evt.elementId);
    if (!evtPath) {
      nonDelegatable.push(evt);
      continue;
    }

    let handlerExpr = evt.handlerExpression;
    handlerExpr = renameIdentifierInExpression(handlerExpr, rep.itemVar, 'item');
    if (rep.indexVar) {
      handlerExpr = renameIdentifierInExpression(handlerExpr, rep.indexVar, indexVar);
    }
    const arrowParsed = parseArrowFunction(handlerExpr);
    if (arrowParsed) {
      handlerExpr = arrowParsed.isBlockBody ? arrowParsed.body.slice(1, -1).trim() : arrowParsed.body;
    } else if (ap.classStyle && isThisMethodReference(handlerExpr)) {
      handlerExpr = `${handlerExpr}(e)`;
    }

    // .self requires currentTarget === target — cannot delegate
    if (evt.modifiers.includes('self')) {
      nonDelegatable.push(evt);
      continue;
    }

    if (!delegatedByType.has(evt.eventName)) {
      delegatedByType.set(evt.eventName, []);
    }
    delegatedByType.get(evt.eventName)!.push({
      path: evtPath,
      handlerExpr,
      modifiers: evt.modifiers,
    });
  }

  return { delegatedByType, nonDelegatable };
};

/**
 * Build delegated listener statements — one addEventListener per event type on the container.
 * Each listener walks from e.target up to the item root, reads __d, and dispatches.
 */
const buildDelegatedListenerStatements = (
  delegatedByType: Map<string, DelegatedEvent[]>,
  containerVar: string,
): string[] => {
  const statements: string[] = [];

  for (const [eventName, events] of delegatedByType) {
    const finalBody = [
      `let _row = e.target;`,
      `while (_row && _row.parentNode !== ${containerVar}) _row = _row.parentNode;`,
      `if (!_row || !_row.__d) return;`,
      `const item = _row.__d;`,
    ];

    for (const evt of events) {
      let navExpr = '_row';
      for (const childIdx of evt.path) {
        navExpr += `.children[${childIdx}]`;
      }
      const modParts: string[] = [];
      if (evt.modifiers.includes('prevent')) modParts.push('e.preventDefault()');
      if (evt.modifiers.includes('stop')) modParts.push('e.stopPropagation()');
      const keyMods = evt.modifiers.filter(m => m !== 'prevent' && m !== 'stop' && m !== 'self');
      if (keyMods.length > 0) {
        const guard = compileKeyGuard(keyMods);
        if (guard) modParts.push(`if (${guard}) return`);
      }
      const handlerBody = [...modParts, evt.handlerExpr].join('; ');

      if (evt.path.length === 0) {
        finalBody.push(`${handlerBody};`);
      } else {
        finalBody.push(`if (${navExpr}?.contains(e.target)) { ${handlerBody}; return; }`);
      }
    }

    statements.push(
      `${containerVar}.addEventListener('${eventName}', (e) => { ${finalBody.join(' ')} });`
    );
  }

  return statements;
};

/**
 * Build per-item addEventListener statements for non-delegatable events.
 * Returns { navStatements, addStatements } for insertion into createItem.
 */
const buildNonDelegatableEventStatements = (
  nonDelegatableEvents: ItemEventBinding[],
  eventElementPaths: Map<string, number[]> | undefined,
  elementBindings: { path: number[] }[],
  navVarNames: string[],
  rep: RepeatBlock,
  indexVar: string,
  ap: AccessPattern,
): { navStatements: string[]; addStatements: string[] } => {
  const navStatements: string[] = [];
  const addStatements: string[] = [];

  if (nonDelegatableEvents.length === 0 || !eventElementPaths) {
    return { navStatements, addStatements };
  }

  const pathToBindingVar = new Map<string, string>();
  for (let i = 0; i < elementBindings.length; i++) {
    const eb = elementBindings[i]!;
    pathToBindingVar.set(JSON.stringify(eb.path), navVarNames[i]!);
  }

  const eventElVarMap = new Map<string, string>();
  let eventElIdx = 0;

  for (const evt of nonDelegatableEvents) {
    if (!eventElVarMap.has(evt.elementId)) {
      const evtPath = eventElementPaths.get(evt.elementId);
      if (evtPath) {
        const existingVar = pathToBindingVar.get(JSON.stringify(evtPath));
        if (existingVar) {
          eventElVarMap.set(evt.elementId, existingVar);
        } else {
          const varName = `_ev${eventElIdx++}`;
          eventElVarMap.set(evt.elementId, varName);
          if (evtPath.length === 0) {
            navStatements.push(`const ${varName} = _el`);
          } else {
            let navExpr = '_el';
            for (const childIdx of evtPath) {
              navExpr += `.children[${childIdx}]`;
            }
            navStatements.push(`const ${varName} = ${navExpr}`);
          }
        }
      }
    }
  }

  for (const evt of nonDelegatableEvents) {
    const elVar = eventElVarMap.get(evt.elementId);
    if (!elVar) continue;
    let handlerExpr = evt.handlerExpression;
    handlerExpr = renameIdentifierInExpression(handlerExpr, rep.itemVar, 'item');
    if (rep.indexVar) {
      handlerExpr = renameIdentifierInExpression(handlerExpr, rep.indexVar, indexVar);
    }
    const arrowParsed = parseArrowFunction(handlerExpr);
    if (arrowParsed) {
      handlerExpr = arrowParsed.isBlockBody ? arrowParsed.body.slice(1, -1).trim() : arrowParsed.body;
    } else if (ap.classStyle && isThisMethodReference(handlerExpr)) {
      handlerExpr = `${handlerExpr}(e)`;
    }
    const bodyParts: string[] = [];
    if (evt.modifiers.includes('prevent')) bodyParts.push('e.preventDefault()');
    if (evt.modifiers.includes('stop')) bodyParts.push('e.stopPropagation()');
    if (evt.modifiers.includes('self')) bodyParts.push('if (e.target !== e.currentTarget) return');
    const keyMods = evt.modifiers.filter(m => m !== 'prevent' && m !== 'stop' && m !== 'self');
    if (keyMods.length > 0) {
      const guard = compileKeyGuard(keyMods);
      if (guard) bodyParts.push(`if (${guard}) return`);
    }
    bodyParts.push(handlerExpr);
    addStatements.push(`${elVar}.addEventListener('${evt.eventName}', (e) => { ${bodyParts.join('; ')}; })`);
  }

  return { navStatements, addStatements };
};

// ============================================================================
// Key Map & Code Generation
// ============================================================================

/** Map of event modifier names to their corresponding KeyboardEvent.key values */
const KEY_MAP: Record<string, string[]> = {
  enter: ['Enter'], tab: ['Tab'], delete: ['Backspace', 'Delete'],
  esc: ['Escape'], escape: ['Escape'], space: [' '],
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
};

/**
 * Compile key modifier names into a JS guard expression.
 * Returns `null` if no valid key modifiers are present.
 * @example compileKeyGuard(['enter', 'tab']) => "e.key !== 'Enter' || e.key !== 'Tab'"
 */
const compileKeyGuard = (modifiers: string[]): string | null => {
  const checks = modifiers
    .map(mod => {
      const keys = KEY_MAP[mod];
      if (!keys) return null;
      return keys.length === 1 ? `e.key !== '${keys[0]}'` : `!${JSON.stringify(keys)}.includes(e.key)`;
    })
    .filter(Boolean);
  return checks.length > 0 ? checks.join(' || ') : null;
};

/**
 * Generate binding update code for a single simple binding
 */
export const generateBindingUpdateCode = (binding: SimpleBinding): string => {
  const elRef = binding.id;

  if (binding.type === 'style') {
    const prop = toCamelCase(binding.property!);
    return `${elRef}.style.${prop} = v`;
  } else if (binding.type === 'attr') {
    return `${elRef}.setAttribute('${binding.property}', v)`;
  } else {
    return `${elRef}.firstChild.nodeValue = v`;
  }
};

/**
 * Generate initial value assignment code for a simple binding
 */
export const generateInitialValueCode = (binding: SimpleBinding, ap: AccessPattern = CLASS_ACCESS): string => {
  const elRef = binding.id;
  const signalCall = ap.signalCall(binding.signalName);

  if (binding.type === 'style') {
    const prop = toCamelCase(binding.property!);
    return `${elRef}.style.${prop} = ${signalCall}`;
  } else if (binding.type === 'attr') {
    return `${elRef}.setAttribute('${binding.property}', ${signalCall})`;
  } else {
    return `${elRef}.firstChild.nodeValue = ${signalCall}`;
  }
};

/**
 * Group simple bindings by their signal name for consolidated subscriptions
 */
export const groupBindingsBySignal = (bindings: SimpleBinding[]): Map<string, SimpleBinding[]> => {
  const groups = new Map<string, SimpleBinding[]>();
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
export const generateConsolidatedSubscription = (signalName: string, bindings: SimpleBinding[], ap: AccessPattern = CLASS_ACCESS): string => {
  if (bindings.length === 1) {
    const update = generateBindingUpdateCode(bindings[0]!);
    return `${ap.signal(signalName)}.subscribe(v => { ${update}; }, true)`;
  }
  const updates = bindings.map((b) => `      ${generateBindingUpdateCode(b)};`).join('\n');
  return `${ap.signal(signalName)}.subscribe(v => {\n${updates}\n    }, true)`;
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
  ap: AccessPattern = CLASS_ACCESS,
): { code: string; staticTemplates: string[] } => {
  const lines: string[] = [];
  const staticTemplates: string[] = []; // Collect static templates for repeat optimizations
  const buildEventListenerStatements = (events: EventBinding[], rootVar: string): string[] => {
    const statements: string[] = [];
    for (const evt of events) {
      let handlerCode = evt.handlerExpression;
      if (ap.classStyle && isThisMethodReference(handlerCode)) {
        handlerCode = `(e) => ${handlerCode}.call(${ap.callContext}, e)`;
      }

      const hasModifiers = evt.modifiers.length > 0;
      const hasPrevent = evt.modifiers.includes('prevent');
      const hasStop = evt.modifiers.includes('stop');
      const hasSelf = evt.modifiers.includes('self');
      const keyModifiers = evt.modifiers.filter(m => m !== 'prevent' && m !== 'stop' && m !== 'self');

      let handlerExpr = handlerCode;
      if (hasModifiers && (hasPrevent || hasStop || hasSelf || keyModifiers.length > 0)) {
        const bodyParts: string[] = [];
        if (hasSelf) bodyParts.push('if (e.target !== e.currentTarget) return;');
        if (keyModifiers.length > 0) {
          const guard = compileKeyGuard(keyModifiers);
          if (guard) bodyParts.push(`if (${guard}) return;`);
        }
        if (hasPrevent) bodyParts.push('e.preventDefault();');
        if (hasStop) bodyParts.push('e.stopPropagation();');
        bodyParts.push(`(${handlerCode})(e);`);
        handlerExpr = `(e) => { ${bodyParts.join(' ')} }`;
      }

      statements.push(`const _el_${evt.id} = ${rootVar}.getElementById('${evt.elementId}'); if (_el_${evt.id}) _el_${evt.id}.addEventListener('${evt.eventName}', ${handlerExpr});`);
    }
    return statements;
  };
  const collectConditionalEventBindings = (conds: ConditionalBlock[]): EventBinding[] => {
    const collected: EventBinding[] = [];
    const visit = (cond: ConditionalBlock) => {
      if (cond.nestedEventBindings?.length) {
        collected.push(...cond.nestedEventBindings);
      }
      if (cond.nestedConditionals?.length) {
        for (const nested of cond.nestedConditionals) visit(nested);
      }
    };
    for (const cond of conds) visit(cond);
    return collected;
  };
  const conditionalEventIds = new Set(collectConditionalEventBindings(conditionals).map((evt) => evt.id));
  lines.push('  initializeBindings = () => {');
  lines.push(`    ${ap.rootAlias}`);
  const topLevelBindings = bindings.filter((b) => !b.isInsideConditional);
  // Separate expression bindings (multi-signal) from simple bindings
  const simpleBindings = topLevelBindings.filter(isSimpleBinding);
  const expressionBindings = topLevelBindings.filter(isExpressionBinding);
  const dataBindIdSet = new Set(topLevelBindings.filter((b) => b.usesDataBindId).map((b) => b.id));
  const topLevelIds = [...new Set(topLevelBindings.map((b) => b.id))];
  if (topLevelIds.length > 0) {
    for (const id of topLevelIds) {
      lines.push(dataBindIdSet.has(id)
        ? `    const ${id} = r.querySelector('[data-bind-id="${id}"]');`
        : `    const ${id} = r.getElementById('${id}');`);
    }
  }
  // Simple bindings: initial value assignment + consolidated subscription
  for (const binding of simpleBindings) {
    lines.push(`    ${generateInitialValueCode(binding, ap)};`);
  }
  const signalGroups = groupBindingsBySignal(simpleBindings);
  for (const [signalName, signalBindings] of signalGroups) {
    lines.push(`    ${generateConsolidatedSubscription(signalName, signalBindings, ap)};`);
  }
  // Expression bindings: multi-subscribe pattern
  // e.g. const _upd_b2 = () => { b2.firstChild.nodeValue = count() + 1; };
  //      count.subscribe(_upd_b2, true);
  for (const binding of expressionBindings) {
    const updFn = `_upd_${binding.id}`;
    const expr = binding.expression;
    const signals = binding.signalNames;
    lines.push(`    const ${updFn} = () => { ${binding.id}.firstChild.nodeValue = ${expr}; };`);
    for (const sig of signals) {
      lines.push(`    ${ap.signal(sig)}.subscribe(${updFn}, true);`);
    }
  }
  for (const cond of conditionals) {
    const nestedBindings = cond.nestedBindings;
    const nestedConds = cond.nestedConditionals || [];
    const escapedTemplate = cond.templateContent.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    let nestedCode = '() => []';
    if (nestedBindings.length > 0 || nestedConds.length > 0) {
      const nestedIds = [...new Set(nestedBindings.map((b) => b.id))];
      const nestedDataBindIds = new Set(nestedBindings.filter((b) => b.usesDataBindId).map((b) => b.id));
      const nestedLines: string[] = [];
      nestedLines.push('() => {');
      for (const id of nestedIds) {
        nestedLines.push(nestedDataBindIds.has(id)
          ? `      const ${id} = r.querySelector('[data-bind-id="${id}"]');`
          : `      const ${id} = r.getElementById('${id}');`);
      }
      const nestedSimpleBindings = nestedBindings.filter(isSimpleBinding);
      const nestedExpressionBindings = nestedBindings.filter(isExpressionBinding);
      for (const binding of nestedSimpleBindings) {
        nestedLines.push(`      ${generateInitialValueCode(binding, ap)};`);
      }
      for (const binding of nestedExpressionBindings) {
        const updFn = `_upd_${binding.id}`;
        nestedLines.push(`      const ${updFn} = () => { ${binding.id}.firstChild.nodeValue = ${binding.expression}; };`);
      }
      const nestedSignalGroups = groupBindingsBySignal(nestedSimpleBindings);
      if (cond.nestedEventBindings.length > 0) {
        const nestedEventLines = buildEventListenerStatements(cond.nestedEventBindings, 'r');
        for (const line of nestedEventLines) {
          nestedLines.push(`      ${line}`);
        }
      }
      nestedLines.push('      return [');
      for (const [signalName, signalBindings] of nestedSignalGroups) {
        nestedLines.push(`        ${generateConsolidatedSubscription(signalName, signalBindings, ap)},`);
      }
      for (const binding of nestedExpressionBindings) {
        const updFn = `_upd_${binding.id}`;
        const signals = binding.signalNames;
        for (const sig of signals) {
          nestedLines.push(`        ${ap.signal(sig)}.subscribe(${updFn}, true),`);
        }
      }
      for (const nestedCond of nestedConds) {
        const nestedCondEscaped = nestedCond.templateContent.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        let innerNestedCode = '() => []';
        if (nestedCond.nestedBindings.length > 0) {
          const innerSimple = nestedCond.nestedBindings.filter(isSimpleBinding);
          const innerExpr = nestedCond.nestedBindings.filter(isExpressionBinding);
          const innerBindingLines: string[] = [];
          const innerIds = [...new Set(nestedCond.nestedBindings.map((b) => b.id))];
          const innerDataBindIds = new Set(nestedCond.nestedBindings.filter((b) => b.usesDataBindId).map((b) => b.id));
          innerBindingLines.push('() => {');
          for (const id of innerIds) {
            innerBindingLines.push(innerDataBindIds.has(id)
              ? `        const ${id} = r.querySelector('[data-bind-id="${id}"]');`
              : `        const ${id} = r.getElementById('${id}');`);
          }
          for (const binding of innerSimple) {
            innerBindingLines.push(`        ${generateInitialValueCode(binding, ap)};`);
          }
          for (const binding of innerExpr) {
            const updFn = `_upd_${binding.id}`;
            innerBindingLines.push(`        const ${updFn} = () => { ${binding.id}.firstChild.nodeValue = ${binding.expression}; };`);
          }
          const innerGroups = groupBindingsBySignal(innerSimple);
          innerBindingLines.push('        return [');
          for (const [signalName, signalBindings] of innerGroups) {
            innerBindingLines.push(`          ${generateConsolidatedSubscription(signalName, signalBindings, ap)},`);
          }
          for (const binding of innerExpr) {
            const updFn = `_upd_${binding.id}`;
            for (const sig of binding.signalNames) {
              innerBindingLines.push(`          ${ap.signal(sig)}.subscribe(${updFn}, true),`);
            }
          }
          innerBindingLines.push('        ];');
          innerBindingLines.push('      }');
          innerNestedCode = innerBindingLines.join('\n');
        }

        const isNestedSimple = nestedCond.signalNames.length === 1 && nestedCond.jsExpression === ap.signalCall(nestedCond.signalName);
        if (isNestedSimple) {
          nestedLines.push(`        ${BIND_FN.IF}(r, ${ap.signal(nestedCond.signalName)}, '${nestedCond.id}', \`${nestedCondEscaped}\`, ${innerNestedCode}),`);
        } else {
          const nestedSignalsArray = nestedCond.signalNames.map((s) => ap.signal(s)).join(', ');
          nestedLines.push(
            `        ${BIND_FN.IF_EXPR}(r, [${nestedSignalsArray}], () => ${nestedCond.jsExpression}, '${nestedCond.id}', \`${nestedCondEscaped}\`, ${innerNestedCode}),`,
          );
        }
      }

      nestedLines.push('      ];');
      nestedLines.push('    }');
      nestedCode = nestedLines.join('\n');
    }
    const isSimpleExpr = cond.signalNames.length === 1 && cond.jsExpression === ap.signalCall(cond.signalName);

    if (isSimpleExpr) {
      lines.push(`    ${BIND_FN.IF}(r, ${ap.signal(cond.signalName)}, '${cond.id}', \`${escapedTemplate}\`, ${nestedCode});`);
    } else {
      const signalsArray = cond.signalNames.map((s) => ap.signal(s)).join(', ');
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
      const weDataBindIds = new Set(bindings.filter((b) => b.usesDataBindId).map((b) => b.id));
      for (const id of ids) {
        initLines.push(weDataBindIds.has(id)
          ? `      const ${id} = r.querySelector('[data-bind-id="${id}"]');`
          : `      const ${id} = r.getElementById('${id}');`);
      }
      const simpleNestedBindings = bindings.filter(isSimpleBinding);
      const exprNestedBindings = bindings.filter(isExpressionBinding);
      for (const binding of simpleNestedBindings) {
        initLines.push(`      ${generateInitialValueCode(binding, ap)};`);
      }
      for (const binding of exprNestedBindings) {
        const updFn = `_upd_${binding.id}`;
        initLines.push(`      const ${updFn} = () => { ${binding.id}.firstChild.nodeValue = ${binding.expression}; };`);
      }

      initLines.push('      return [');
      const signalGroups = groupBindingsBySignal(simpleNestedBindings);
      for (const [signalName, signalBindings] of signalGroups) {
        initLines.push(`        ${generateConsolidatedSubscription(signalName, signalBindings, ap)},`);
      }
      for (const binding of exprNestedBindings) {
        const updFn = `_upd_${binding.id}`;
        const signals = binding.signalNames;
        for (const sig of signals) {
          initLines.push(`        ${ap.signal(sig)}.subscribe(${updFn}, true),`);
        }
      }
      for (const cond of nestedConds) {
        const nestedEscapedTemplate = cond.templateContent.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const nestedBindingsCode = generateNestedInitializer(cond.nestedBindings, [], []);
        const isSimple = cond.signalNames.length === 1 && cond.jsExpression === ap.signalCall(cond.signalName);
        if (isSimple) {
          initLines.push(`        ${BIND_FN.IF}(r, ${ap.signal(cond.signalName)}, '${cond.id}', \`${nestedEscapedTemplate}\`, ${nestedBindingsCode}),`);
        } else {
          const signalsArray = cond.signalNames.map((s) => ap.signal(s)).join(', ');
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
        const signalsArray = nestedWe.signalNames.map((s) => ap.signal(s)).join(', ');
        initLines.push(`        ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${nestedWe.jsExpression}, '${nestedWe.thenId}', \`${nestedThenTemplate}\`, ${thenInitCode}),`);
        initLines.push(`        ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => !(${nestedWe.jsExpression}), '${nestedWe.elseId}', \`${nestedElseTemplate}\`, ${elseInitCode}),`);
      }

      initLines.push('      ];');
      initLines.push('    }');
      return initLines.join('\n');
    };
    const thenCode = generateNestedInitializer(we.thenBindings, we.nestedConditionals, we.nestedWhenElse);
    const elseCode = generateNestedInitializer(we.elseBindings, [], []);

    const signalsArray = we.signalNames.map((s) => ap.signal(s)).join(', ');
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
    
    // Detect item bindings that reference component-level signals (mixed bindings).
    // In class mode, these have `this.` prefix. In closure mode, component signals 
    // are detected upstream via signalBindings, so this is primarily a class-mode heuristic.
    const hasMixedBindings = ap.classStyle
      ? rep.itemBindings.some(b => b.expression.includes('this.'))
      : false;
    
    if (!hasItemBindings) {
      optimizationSkipReason = 'no-bindings';
    } else if (hasSignalBindings) {
      optimizationSkipReason = 'signal-bindings';
    } else if (hasNestedRepeats) {
      optimizationSkipReason = 'nested-repeat';
    } else if (hasNestedConditionals) {
      optimizationSkipReason = 'nested-conditional';
    } else if (hasMixedBindings) {
      optimizationSkipReason = 'mixed-bindings';
    }
    
    const canUseOptimized = optimizationSkipReason === null;
    
    if (canUseOptimized) {
      // Use optimized template-based approach
      const staticInfo = generateStaticRepeatTemplate(rep.itemTemplate, rep.itemBindings, rep.itemVar, rep.itemEvents);
      
      if (staticInfo.canUseOptimized && staticInfo.elementBindings.length > 0) {
        // Generate static template identifier
        const templateId = `__tpl_${rep.id}`;
        
        // Generate static template IIFE
        const escapedStaticHtml = staticInfo.staticHtml
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');
        
        staticTemplates.push(`  ${ap.classStyle ? 'static' : 'const'} ${templateId} = (() => { const t = document.createElement('template'); t.innerHTML = \`${escapedStaticHtml}\`; return t; })();`);
        
        // Fully inlined repeat — inline navigation code, no runtime navigatePath
        // Generate inlined navigation code for each bound element
        const navVarNames: string[] = [];
        const navStatements: string[] = [];
        for (let i = 0; i < staticInfo.elementBindings.length; i++) {
          const eb = staticInfo.elementBindings[i]!;
          const varName = `_e${i}`;
          navVarNames.push(varName);
          if (eb.path.length === 0) {
            navStatements.push(`const ${varName} = _el`);
          } else {
            // Generate inlined navigation: .children[0].children[1] etc.
            let navExpr = '_el';
            for (const childIdx of eb.path) {
              navExpr += `.children[${childIdx}]`;
            }
            navStatements.push(`const ${varName} = ${navExpr}`);
          }
        }
        
        // Generate fill statements using inlined var names
        const fillStatements: string[] = [];
        const updateStatements: string[] = [];
        for (let i = 0; i < staticInfo.elementBindings.length; i++) {
          const eb = staticInfo.elementBindings[i]!;
          const varName = navVarNames[i]!;
          for (const binding of eb.bindings) {
            const expr = renameIdentifierInExpression(binding.expression, rep.itemVar, 'item');
            if (binding.type === 'text') {
              fillStatements.push(`${varName}.firstChild.nodeValue = ${expr}`);
              updateStatements.push(`${varName}.firstChild.nodeValue = ${expr}`);
            } else if (binding.type === 'attr' && binding.property) {
              fillStatements.push(`${varName}.setAttribute('${binding.property}', ${expr})`);
              updateStatements.push(`${varName}.setAttribute('${binding.property}', ${expr})`);
            }
          }
        }
        
        // Generate empty template arg
        let emptyTemplateArg = 'undefined';
        if (rep.emptyTemplate) {
          const escapedEmptyTemplate = rep.emptyTemplate.replace(/`/g, '\\`');
          emptyTemplateArg = `\`${escapedEmptyTemplate}\``;
        }
        
        // Generate key function arg
        let keyFnArg = 'undefined';
        if (rep.trackByFn) {
          keyFnArg = rep.trackByFn;
        }
        
        // Generate the inlined repeat setup
        const tplContentVar = `_tc_${rep.id}`;
        const anchorVar = `_a_${rep.id}`;
        const containerVar = `_ct_${rep.id}`;
        const reconcilerVar = `_rc_${rep.id}`;
        
        lines.push(`    const ${tplContentVar} = ${ap.staticPrefix}${templateId}.content;`);
        lines.push(`    const ${anchorVar} = r.getElementById('${rep.id}');`);
        lines.push(`    const ${containerVar} = ${anchorVar}.parentNode;`);
        // Partition item events into delegated (container listener) vs non-delegatable (per-item)
        const { delegatedByType: delegatedEventsByType, nonDelegatable: nonDelegatableEvents } =
          hasItemEvents
            ? partitionItemEvents(rep.itemEvents, staticInfo.eventElementPaths, rep, indexVar, ap)
            : { delegatedByType: new Map<string, DelegatedEvent[]>(), nonDelegatable: [] as ItemEventBinding[] };

        // Build delegated listener code (emitted AFTER reconciler creation)
        const delegatedListenerStatements = buildDelegatedListenerStatements(delegatedEventsByType, containerVar);
        
        // Handle non-delegatable events (e.g., .self modifier) with per-item listeners
        const { navStatements: eventNavStatements, addStatements: eventAddStatements } =
          buildNonDelegatableEventStatements(
            nonDelegatableEvents, staticInfo.eventElementPaths,
            staticInfo.elementBindings, navVarNames, rep, indexVar, ap,
          );
        
        // Determine if we need to store item data on the element for delegation
        const useDelegation = delegatedEventsByType.size > 0;
        
        // Use keyed reconciler when we have a keyFn and no emptyTemplate
        const useKeyedReconciler = !!rep.trackByFn && !rep.emptyTemplate;
        const reconcilerFn = useKeyedReconciler ? BIND_FN.KEYED_RECONCILER : BIND_FN.RECONCILER;
        
        lines.push(`    const ${reconcilerVar} = ${reconcilerFn}({`);
        lines.push(`      container: ${containerVar}, anchor: ${anchorVar},`);
        lines.push(`      containerParent: ${containerVar}.parentNode, containerNextSibling: ${containerVar}.nextSibling,`);
        lines.push(`      createItem: (item, ${indexVar}, _ref) => {`);
        lines.push(`        const _frag = ${tplContentVar}.cloneNode(true);`);
        lines.push(`        const _el = _frag.firstElementChild;`);
        if (useDelegation) {
          lines.push(`        _el.__d = item;`);
        }
        for (const navStmt of navStatements) {
          lines.push(`        ${navStmt};`);
        }
        for (const navStmt of eventNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        lines.push(`        ${fillStatements.join('; ')};`);
        if (eventAddStatements.length > 0) {
          lines.push(`        ${eventAddStatements.join('; ')};`);
        }
        lines.push(`        ${containerVar}.insertBefore(_frag, _ref);`);
        const updateParts = [...updateStatements];
        if (useDelegation) {
          updateParts.push('_el.__d = item');
        }
        lines.push(`        return { itemSignal: null, el: _el, cleanups: [], value: item,`);
        lines.push(`          update: (item) => { ${updateParts.join('; ')}; } };`);
        lines.push(`      },`);
        if (rep.trackByFn) {
          lines.push(`      keyFn: ${keyFnArg},`);
        }
        if (rep.emptyTemplate) {
          lines.push(`      emptyTemplate: ${emptyTemplateArg},`);
        }
        lines.push(`    });`);
        lines.push(`    ${reconcilerVar}.reconcile(${ap.signal(rep.signalName)}());`);
        lines.push(`    ${ap.signal(rep.signalName)}.subscribe((items) => { ${reconcilerVar}.reconcile(items); }, true);`);
        // Emit delegated event listeners on the container (after reconciler is ready)
        for (const stmt of delegatedListenerStatements) {
          lines.push(`    ${stmt}`);
        }
        
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

    if (!hasItemBindings && !hasSignalBindings && !hasNestedRepeats && !hasNestedConditionals && rep.itemEvents.length === 0) {
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
        
        for (const binding of rep.itemBindings) {
          // Detect component-level signal references in item binding expressions
          const componentSignals = findComponentSignalCalls(binding.expression, ap.classStyle);

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
              const signalExpr = renameIdentifierInExpression(binding.expression, rep.itemVar, 'v');
              if (binding.type === 'text') {
                updateStatements.push(`${cachedVar}.firstChild.nodeValue = ${signalExpr}`);
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
          const signalExpr = renameIdentifierInExpression(binding.expression, rep.itemVar, `${itemSignalVar}()`);
          let updateStmt: string;
          if (binding.type === 'text') {
            if (binding.textBindingMode === 'commentMarker') {
              updateStmt = `e = $t('${binding.elementId}'); if (e) e.nodeValue = ${signalExpr};`;
            } else {
              updateStmt = `e = $('${binding.elementId}'); if (e) e.firstChild.nodeValue = ${signalExpr};`;
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
            subscriptionLines.push(`${ap.signal(componentSignal)}.subscribe(() => { let e; ${updateStmt} }, true)`);
          }
        }
      }
      if (hasSignalBindings) {
        const signalGroups = groupBindingsBySignal(rep.signalBindings);

        for (const [signalName, bindings] of signalGroups) {
          const updateStatements: string[] = [];

          for (const binding of bindings) {
            if (binding.type === 'text') {
              updateStatements.push(`e = $('${binding.id}'); if (e) e.firstChild.nodeValue = v;`);
            } else if (binding.type === 'attr' && binding.property) {
              updateStatements.push(`e = $('${binding.id}'); if (e) e.setAttribute('${binding.property}', v);`);
            } else if (binding.type === 'style' && binding.property) {
              const prop = toCamelCase(binding.property);
              updateStatements.push(`e = $('${binding.id}'); if (e) e.style.${prop} = v;`);
            }
          }

          if (updateStatements.length > 0) {
            subscriptionLines.push(`${ap.signal(signalName)}.subscribe(v => { let e; ${updateStatements.join(' ')} }, true)`);
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
                const componentSignals = findComponentSignalCalls(binding.expression, ap.classStyle);

                if (componentSignals.size === 0) {
                  pureNestedBindings.push(binding);
                } else {
                  mixedNestedBindings.push({ binding, componentSignals });
                }
              }
              if (pureNestedBindings.length > 0) {
                const updateStatements: string[] = [];
                for (const binding of pureNestedBindings) {
                  const signalExpr = renameIdentifierInExpression(binding.expression, nestedRep.itemVar, 'v');
                  if (binding.type === 'text') {
                    updateStatements.push(`e = $n('${binding.elementId}'); if (e) e.firstChild.nodeValue = ${signalExpr};`);
                  } else if (binding.type === 'attr' && binding.property) {
                    updateStatements.push(`e = $n('${binding.elementId}'); if (e) e.setAttribute('${binding.property}', ${signalExpr});`);
                  }
                }
                if (updateStatements.length > 0) {
                  nestedUpdates.push(`${nestedItemSignalVar}.subscribe(v => { let e; ${updateStatements.join(' ')} }, true)`);
                }
              }
              for (const { binding, componentSignals } of mixedNestedBindings) {
                const signalExpr = renameIdentifierInExpression(binding.expression, nestedRep.itemVar, `${nestedItemSignalVar}()`);
                let updateStmt: string;
                if (binding.type === 'text') {
                  updateStmt = `e = $n('${binding.elementId}'); if (e) e.firstChild.nodeValue = ${signalExpr};`;
                } else if (binding.type === 'attr' && binding.property) {
                  updateStmt = `e = $n('${binding.elementId}'); if (e) e.setAttribute('${binding.property}', ${signalExpr});`;
                } else {
                  continue;
                }

                nestedUpdates.push(`${nestedItemSignalVar}.subscribe(() => { let e; ${updateStmt} }, true)`);
                for (const componentSignal of componentSignals) {
                  nestedUpdates.push(`${ap.signal(componentSignal)}.subscribe(() => { let e; ${updateStmt} }, true)`);
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
              for (const binding of nestedCond.nestedBindings.filter(isSimpleBinding)) {
                if (binding.type === 'text') {
                  condBindingUpdates.push(`${ap.signal(binding.signalName)}.subscribe(v => { const el = $n('${binding.id}'); if (el) el.firstChild.nodeValue = v; }, true)`);
                } else if (binding.type === 'attr' && binding.property) {
                  condBindingUpdates.push(
                    `${ap.signal(binding.signalName)}.subscribe(v => { const el = $n('${binding.id}'); if (el) el.setAttribute('${binding.property}', v); }, true)`,
                  );
                } else if (binding.type === 'style' && binding.property) {
                  const prop = toCamelCase(binding.property);
                  condBindingUpdates.push(`${ap.signal(binding.signalName)}.subscribe(v => { const el = $n('${binding.id}'); if (el) el.style.${prop} = v; }, true)`);
                }
              }
              for (const binding of nestedCond.nestedItemBindings) {
                const signalExpr = renameIdentifierInExpression(binding.expression, nestedRep.itemVar, `${nestedItemSignalVar}()`);

                if (binding.type === 'text') {
                  condBindingUpdates.push(`${nestedItemSignalVar}.subscribe(() => { const el = $n('${binding.elementId}'); if (el) el.firstChild.nodeValue = ${signalExpr}; }, true)`);
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
              const isSimple = nestedCond.signalNames.length === 1 && nestedCond.jsExpression === ap.signalCall(nestedCond.signalName);

              if (isSimple) {
                nestedUpdates.push(`${BIND_FN.IF}({ getElementById: $n }, ${ap.signal(nestedCond.signalName)}, '${nestedCond.id}', \`${condEscapedTemplate}\`, ${condNestedCode})`);
              } else {
                const signalsArray = nestedCond.signalNames.map((s) => ap.signal(s)).join(', ');
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
          const refsParentItem = expressionReferencesIdentifier(nestedRep.itemsExpression, rep.itemVar);

          if (refsParentItem) {
            nestedArrayExpr = renameIdentifierInExpression(nestedRep.itemsExpression, rep.itemVar, `${itemSignalVar}()`);
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
            for (const binding of nestedCond.nestedBindings.filter(isSimpleBinding)) {
              if (binding.type === 'text') {
                condBindingUpdates.push(`${ap.signal(binding.signalName)}.subscribe(v => { const el = $('${binding.id}'); if (el) el.firstChild.nodeValue = v; }, true)`);
              } else if (binding.type === 'attr' && binding.property) {
                condBindingUpdates.push(`${ap.signal(binding.signalName)}.subscribe(v => { const el = $('${binding.id}'); if (el) el.setAttribute('${binding.property}', v); }, true)`);
              } else if (binding.type === 'style' && binding.property) {
                const prop = toCamelCase(binding.property);
                condBindingUpdates.push(`${ap.signal(binding.signalName)}.subscribe(v => { const el = $('${binding.id}'); if (el) el.style.${prop} = v; }, true)`);
              }
            }
            if (condBindingUpdates.length > 0) {
              condNestedCode = `() => [${condBindingUpdates.join(', ')}]`;
            }
          }
          const isSimple = nestedCond.signalNames.length === 1 && nestedCond.jsExpression === ap.signalCall(nestedCond.signalName);

          if (isSimple) {
            nestedConditionalLines.push(`${BIND_FN.IF}({ getElementById: $ }, ${ap.signal(nestedCond.signalName)}, '${nestedCond.id}', \`${condEscapedTemplate}\`, ${condNestedCode})`);
          } else {
            const signalsArray = nestedCond.signalNames.map((s) => ap.signal(s)).join(', ');
            nestedConditionalLines.push(
              `${BIND_FN.IF_EXPR}({ getElementById: $ }, [${signalsArray}], () => ${nestedCond.jsExpression}, '${nestedCond.id}', \`${condEscapedTemplate}\`, ${condNestedCode})`,
            );
          }
        }
      }
      const itemEventCleanupLines: string[] = [];
      if (rep.itemEvents.length > 0) {
        for (const evt of rep.itemEvents) {
          let handlerExpr = evt.handlerExpression;
          handlerExpr = renameIdentifierInExpression(handlerExpr, rep.itemVar, `${itemSignalVar}()`);
          if (rep.indexVar) {
            handlerExpr = renameIdentifierInExpression(handlerExpr, rep.indexVar, indexVar);
          }
          const arrowParsed = parseArrowFunction(handlerExpr);
          if (arrowParsed) {
            handlerExpr = arrowParsed.isBlockBody ? arrowParsed.body.slice(1, -1).trim() : arrowParsed.body;
          } else if (ap.classStyle && isThisMethodReference(handlerExpr)) {
            handlerExpr = `${handlerExpr}(e)`;
          }

          const bodyParts: string[] = [];
          if (evt.modifiers.includes('self')) bodyParts.push('if (e.target !== e.currentTarget) return');
          const keyMods = evt.modifiers.filter(m => m !== 'prevent' && m !== 'stop' && m !== 'self');
          if (keyMods.length > 0) {
            const guard = compileKeyGuard(keyMods);
            if (guard) bodyParts.push(`if (${guard}) return`);
          }
          if (evt.modifiers.includes('prevent')) bodyParts.push('e.preventDefault()');
          if (evt.modifiers.includes('stop')) bodyParts.push('e.stopPropagation()');
          bodyParts.push(handlerExpr);

          itemEventCleanupLines.push(
            `((el) => { if (!el) return () => {}; const _h = (e) => { ${bodyParts.join('; ')}; }; el.addEventListener('${evt.eventName}', _h); return () => el.removeEventListener('${evt.eventName}', _h); })($('${evt.elementId}'))`
          );
        }
      }
      const allCleanupLines = [...subscriptionLines, ...nestedRepeatLines, ...nestedConditionalLines, ...itemEventCleanupLines];

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
    let bindRepeatCall = `${BIND_FN.REPEAT}(r, ${ap.signal(rep.signalName)}, '${rep.id}', ${templateFn}, ${initItemBindingsFn}`;
    if (rep.emptyTemplate) {
      const escapedEmptyTemplate = rep.emptyTemplate.replace(/`/g, '\\`');
      bindRepeatCall += `, \`${escapedEmptyTemplate}\``;
    } else if (rep.trackByFn) {
      bindRepeatCall += `, undefined`;
    }
    if (rep.trackByFn) {
      bindRepeatCall += `, undefined, ${rep.trackByFn}`;
    }

    bindRepeatCall += ')';

    lines.push(`    ${bindRepeatCall};`);
  }
  if (eventBindings.length > 0) {
    // Generate direct addEventListener calls (skip conditional-bound events here)
    const topLevelEvents = eventBindings.filter((evt) => !conditionalEventIds.has(evt.id));
    const eventLines = buildEventListenerStatements(topLevelEvents, 'r');
    for (const line of eventLines) {
      lines.push(`    ${line}`);
    }
  }

  lines.push('  };');

  return { code: '\n\n' + lines.join('\n'), staticTemplates };
};

/**
 * Generate a static template property for pre-compiled HTML
 */
export const generateStaticTemplate = (content: string, ap: AccessPattern = CLASS_ACCESS): string => {
  const escapedContent = content.replace(/`/g, '\\`');
  return `
  ${ap.staticTemplatePrefix} = (() => {
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
