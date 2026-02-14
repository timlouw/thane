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
  AccessPattern,
} from './types.js';
import { CLOSURE_ACCESS, isExpressionBinding, isSimpleBinding } from './types.js';
import { generateStaticRepeatTemplate, getOptimizationSkipMessage } from './repeat-analysis.js';
import { toCamelCase, BIND_FN, logger, PLUGIN_NAME, renameIdentifierInExpression, parseArrowFunction } from '../../utils/index.js';
import { injectIdIntoFirstElement } from '../../utils/html-parser/index.js';
import type { ImportInfo } from '../../types.js';
import type { ChildMountInfo } from '../component-precompiler/component-precompiler.js';

const NAME = PLUGIN_NAME.REACTIVE;

// ============================================================================
// Navigation Helper
// ============================================================================

/**
 * Convert a child-index path to firstElementChild/nextElementSibling navigation.
 * Avoids HTMLCollection creation from .children[N] access.
 * @example pathToSiblingNav('_el', [1, 0]) → '_el.firstElementChild.nextElementSibling.firstElementChild'
 */
const pathToSiblingNav = (root: string, path: number[]): string => {
  let expr = root;
  for (const idx of path) {
    expr += '.firstElementChild';
    for (let s = 0; s < idx; s++) expr += '.nextElementSibling';
  }
  return expr;
};

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
      const navExpr = evt.path.length === 0 ? '_row' : pathToSiblingNav('_row', evt.path);
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
            navStatements.push(`const ${varName} = ${pathToSiblingNav('_el', evtPath)}`);
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
export const generateInitialValueCode = (binding: SimpleBinding, ap: AccessPattern = CLOSURE_ACCESS): string => {
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
export const generateConsolidatedSubscription = (signalName: string, bindings: SimpleBinding[], ap: AccessPattern = CLOSURE_ACCESS): string => {
  if (bindings.length === 1) {
    const update = generateBindingUpdateCode(bindings[0]!);
    return `${ap.signal(signalName)}.subscribe(v => { ${update}; }, true)`;
  }
  const updates = bindings.map((b) => `      ${generateBindingUpdateCode(b)};`).join('\n');
  return `${ap.signal(signalName)}.subscribe(v => {\n${updates}\n    }, true)`;
};

/**
 * Generate an initNested function for a conditional/whenElse inside a repeat item.
 * The initNested receives `contentEl` (the root element of the conditional content)
 * which is already in the DOM by the time initNested is called, so we use
 * document.getElementById for consistent element lookup.
 */
const generateRepeatNestedCondInitFn = (
  nestedBindings: BindingInfo[],
  nestedItemBindings: ItemBinding[],
  nestedEventBindings: EventBinding[],
  outerItemVar: string,
  ap: AccessPattern,
): string => {
  const hasSignalBindings = nestedBindings.length > 0;
  const hasItemBindings = nestedItemBindings.length > 0;
  const hasEvents = nestedEventBindings.length > 0;
  if (!hasSignalBindings && !hasItemBindings && !hasEvents) return '() => []';

  const parts: string[] = [];
  parts.push('(_c) => {');
  // Item bindings: set once when conditional shows
  const itemElIds = [...new Set(nestedItemBindings.map(b => b.elementId))];
  for (const elId of itemElIds) {
    parts.push(`  const _n_${elId} = _gid('${elId}');`);
  }
  for (const ib of nestedItemBindings) {
    const expr = renameIdentifierInExpression(ib.expression, outerItemVar, 'item');
    if (ib.type === 'text') {
      parts.push(`  if (_n_${ib.elementId}) _n_${ib.elementId}.firstChild.nodeValue = ${expr};`);
    } else if (ib.type === 'attr' && ib.property) {
      parts.push(`  if (_n_${ib.elementId}) _n_${ib.elementId}.setAttribute('${ib.property}', ${expr});`);
    }
  }
  // Signal bindings
  const simpleNested = nestedBindings.filter(isSimpleBinding);
  const exprNested = nestedBindings.filter(isExpressionBinding);
  const signalElIds = [...new Set([...simpleNested.map(b => b.id), ...exprNested.map(b => b.id)])];
  for (const elId of signalElIds) {
    if (!itemElIds.includes(elId)) {
      parts.push(`  const _n_${elId} = _gid('${elId}');`);
    }
  }
  // Initial values for signal bindings
  for (const sb of simpleNested) {
    const signalCall = ap.signalCall(sb.signalName);
    if (sb.type === 'text') {
      parts.push(`  if (_n_${sb.id}) _n_${sb.id}.firstChild.nodeValue = ${signalCall};`);
    } else if (sb.type === 'attr' && sb.property) {
      parts.push(`  if (_n_${sb.id}) _n_${sb.id}.setAttribute('${sb.property}', ${signalCall});`);
    } else if (sb.type === 'style' && sb.property) {
      parts.push(`  if (_n_${sb.id}) _n_${sb.id}.style.setProperty('${sb.property}', ${signalCall});`);
    }
  }
  for (const eb of exprNested) {
    parts.push(`  if (_n_${eb.id}) _n_${eb.id}.firstChild.nodeValue = ${eb.expression};`);
  }
  parts.push('  const _nsubs = [];');
  // Subscriptions for signal bindings
  const signalGroups = groupBindingsBySignal(simpleNested);
  for (const [signalName, sbs] of signalGroups) {
    const updates = sbs.map(sb => {
      if (sb.type === 'text') return `if (_n_${sb.id}) _n_${sb.id}.firstChild.nodeValue = v`;
      if (sb.type === 'attr' && sb.property) return `if (_n_${sb.id}) _n_${sb.id}.setAttribute('${sb.property}', v)`;
      if (sb.type === 'style' && sb.property) return `if (_n_${sb.id}) _n_${sb.id}.style.setProperty('${sb.property}', v)`;
      return '';
    }).filter(Boolean);
    if (updates.length === 1) {
      parts.push(`  _nsubs.push(${ap.signal(signalName)}.subscribe(v => { ${updates[0]}; }, true));`);
    } else if (updates.length > 1) {
      parts.push(`  _nsubs.push(${ap.signal(signalName)}.subscribe(v => { ${updates.join('; ')}; }, true));`);
    }
  }
  for (const eb of exprNested) {
    const updFn = `() => { if (_n_${eb.id}) _n_${eb.id}.firstChild.nodeValue = ${eb.expression}; }`;
    for (const sig of eb.signalNames) {
      parts.push(`  _nsubs.push(${ap.signal(sig)}.subscribe(${updFn}, true));`);
    }
  }
  parts.push('  return _nsubs;');
  parts.push('}');
  return parts.join('\\n');
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
  ap: AccessPattern = CLOSURE_ACCESS,
  childMountsByDirective?: Map<string, { cm: ChildMountInfo, globalIndex: number }[]>,
): { code: string; staticTemplates: string[] } => {
  const lines: string[] = [];
  const staticTemplates: string[] = []; // Collect static templates for repeat optimizations

  // ── Helper: generate child component mount lines for directive-nested mounts ──
  const generateMountLines = (
    directiveId: string,
    indent: string,
    repeatCtx?: { itemVar: string; indexVar: string },
  ): string[] => {
    const mounts = childMountsByDirective?.get(directiveId);
    if (!mounts || mounts.length === 0) return [];
    const result: string[] = [];
    for (const { cm, globalIndex } of mounts) {
      const varName = `_cm${globalIndex}`;
      let propsExpr = cm.propsExpression;
      // Step 10: Rename repeat-context variables in props expression
      if (repeatCtx) {
        propsExpr = renameIdentifierInExpression(propsExpr, repeatCtx.itemVar, 'item');
        if (repeatCtx.indexVar && repeatCtx.indexVar !== '_idx') {
          propsExpr = renameIdentifierInExpression(propsExpr, repeatCtx.indexVar, '_idx');
        }
      }
      result.push(`${indent}const ${varName} = document.createElement('${cm.selector}');`);
      result.push(`${indent}_gid('${cm.anchorId}').replaceWith(${varName});`);
      result.push(`${indent}${cm.componentName}.__f(${varName}, ${propsExpr});`);
    }
    return result;
  };

  const buildEventListenerStatements = (events: EventBinding[], _rootVar: string): string[] => {
    const statements: string[] = [];
    for (const evt of events) {
      let handlerCode = evt.handlerExpression;

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

      statements.push(`_gid('${evt.elementId}')?.addEventListener('${evt.eventName}', ${handlerExpr});`);
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
  lines.push(`    const _gid = (id) => document.getElementById(id);`);
  const topLevelBindings = bindings.filter((b) => !b.isInsideConditional);
  // Separate expression bindings (multi-signal) from simple bindings
  const simpleBindings = topLevelBindings.filter(isSimpleBinding);
  const expressionBindings = topLevelBindings.filter(isExpressionBinding);
  const topLevelIds = [...new Set(topLevelBindings.map((b) => b.id))];
  if (topLevelIds.length > 0) {
    for (const id of topLevelIds) {
      lines.push(`    const ${id} = _gid('${id}');`);
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
    const condMountLines = generateMountLines(cond.id, '      ');
    if (nestedBindings.length > 0 || nestedConds.length > 0 || condMountLines.length > 0) {
      const nestedIds = [...new Set(nestedBindings.map((b) => b.id))];
      const nestedLines: string[] = [];
      nestedLines.push('() => {');
      for (const id of nestedIds) {
        nestedLines.push(`      const ${id} = _gid('${id}');`);
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
      for (const ml of condMountLines) {
        nestedLines.push(ml);
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
          innerBindingLines.push('() => {');
          for (const id of innerIds) {
            innerBindingLines.push(`        const ${id} = _gid('${id}');`);
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
    const generateNestedInitializer = (bindings: BindingInfo[], nestedConds: ConditionalBlock[], nestedWE: WhenElseBlock[], directiveId?: string): string => {
      const weMountLines = directiveId ? generateMountLines(directiveId, '      ') : [];
      if (bindings.length === 0 && nestedConds.length === 0 && nestedWE.length === 0 && weMountLines.length === 0) {
        return '() => []';
      }

      const initLines: string[] = [];
      initLines.push('() => {');
      const ids = [...new Set(bindings.map((b) => b.id))];
      for (const id of ids) {
        initLines.push(`      const ${id} = _gid('${id}');`);
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
      for (const ml of weMountLines) {
        initLines.push(ml);
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
    const thenCode = generateNestedInitializer(we.thenBindings, we.nestedConditionals, we.nestedWhenElse, we.thenId);
    const elseCode = generateNestedInitializer(we.elseBindings, [], [], we.elseId);

    const signalsArray = we.signalNames.map((s) => ap.signal(s)).join(', ');
    lines.push(`    ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${we.jsExpression}, '${we.thenId}', \`${escapedThenTemplate}\`, ${thenCode});`);
    lines.push(`    ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => !(${we.jsExpression}), '${we.elseId}', \`${escapedElseTemplate}\`, ${elseCode});`);
  }
  // Cached prototype methods for repeat block hot paths (avoids prototype chain lookup per call)
  if (repeatBlocks.length > 0) {
    staticTemplates.push(`  const _cloneNode = Node.prototype.cloneNode;`);
    staticTemplates.push(`  const _insertBefore = Node.prototype.insertBefore;`);
  }

  for (const rep of repeatBlocks) {
    const indexVar = rep.indexVar || '_idx';
    const hasItemBindings = rep.itemBindings.length > 0;
    const hasNestedRepeats = rep.nestedRepeats.length > 0;
    const hasNestedConditionals = rep.nestedConditionals.length > 0;
    const hasItemEvents = rep.itemEvents.length > 0;
    
    const canUseOptimized = true;
    
    if (canUseOptimized) {
      // Use optimized template-based approach
      // Collect directive anchor IDs for path computation (Step 14/15)
      const directiveAnchorIds: string[] = [
        ...rep.nestedConditionals.map(c => c.id),
        ...rep.nestedWhenElse.flatMap(we => [we.thenId, we.elseId]),
        ...rep.nestedRepeats.map(nr => nr.id),
      ];
      const staticInfo = generateStaticRepeatTemplate(rep.itemTemplate, rep.itemBindings, rep.itemVar, rep.itemEvents, rep.signalBindings, directiveAnchorIds.length > 0 ? directiveAnchorIds : undefined);
      
      if (staticInfo.canUseOptimized && staticInfo.elementBindings.length > 0) {
        // Restore child mount anchor IDs stripped by static template generation (Step 7)
        const repMounts = childMountsByDirective?.get(rep.id);
        if (repMounts) {
          for (const { cm } of repMounts) {
            staticInfo.staticHtml = staticInfo.staticHtml.replace(
              '<template></template>',
              `<template id="${cm.anchorId}"></template>`,
            );
          }
        }
        // Generate static template identifier
        const templateId = `__tpl_${rep.id}`;
        
        // Generate static template IIFE
        const escapedStaticHtml = staticInfo.staticHtml
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');
        
        staticTemplates.push(`  const ${templateId} = _T(\`${escapedStaticHtml}\`);`);
        
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
            navStatements.push(`const ${varName} = ${pathToSiblingNav('_el', eb.path)}`);
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
        
        // Signal binding navigation and fill (Step 13)
        const signalNavStatements: string[] = [];
        const signalFillStatements: string[] = [];
        const signalSubscriptions: string[] = [];
        if (staticInfo.signalElementBindings && staticInfo.signalElementBindings.length > 0) {
          for (let i = 0; i < staticInfo.signalElementBindings.length; i++) {
            const sb = staticInfo.signalElementBindings[i]!;
            const varName = `_s${i}`;
            // Navigation
            if (sb.path.length === 0) {
              signalNavStatements.push(`const ${varName} = _el`);
            } else {
              signalNavStatements.push(`const ${varName} = ${pathToSiblingNav('_el', sb.path)}`);
            }
            // Fill + subscription
            const signalRef = ap.signal(sb.signalName);
            const signalCall = ap.signalCall(sb.signalName);
            if (sb.type === 'text') {
              signalFillStatements.push(`${varName}.firstChild.nodeValue = ${signalCall}`);
              signalSubscriptions.push(`_cleanups.push(${signalRef}.subscribe(() => { ${varName}.firstChild.nodeValue = ${signalCall}; }, true))`);
            } else if (sb.type === 'attr' && sb.property) {
              signalFillStatements.push(`${varName}.setAttribute('${sb.property}', ${signalCall})`);
              signalSubscriptions.push(`_cleanups.push(${signalRef}.subscribe(() => { ${varName}.setAttribute('${sb.property}', ${signalCall}); }, true))`);
            } else if (sb.type === 'style' && sb.property) {
              signalFillStatements.push(`${varName}.style.setProperty('${sb.property}', ${signalCall})`);
              signalSubscriptions.push(`_cleanups.push(${signalRef}.subscribe(() => { ${varName}.style.setProperty('${sb.property}', ${signalCall}); }, true))`);
            }
          }
        }
        
        // Key function and empty template are handled inline below
        
        // Generate the inlined repeat setup
        const tplContentVar = `_tc_${rep.id}`;
        const anchorVar = `_a_${rep.id}`;
        const containerVar = `_ct_${rep.id}`;
        const reconcilerVar = `_rc_${rep.id}`;
        
        lines.push(`    const ${tplContentVar} = ${ap.staticPrefix}${templateId}.content.firstElementChild;`);
        lines.push(`    const ${anchorVar} = _gid('${rep.id}');`);
        lines.push(`    const ${containerVar} = ${anchorVar}.parentNode;`);
        // Partition item events into delegated (container listener) vs non-delegatable (per-item)
        const { delegatedByType: delegatedEventsByType, nonDelegatable: nonDelegatableEvents } =
          hasItemEvents
            ? partitionItemEvents(rep.itemEvents, staticInfo.eventElementPaths, rep, indexVar)
            : { delegatedByType: new Map<string, DelegatedEvent[]>(), nonDelegatable: [] as ItemEventBinding[] };

        // Build delegated listener code (emitted AFTER reconciler creation)
        const delegatedListenerStatements = buildDelegatedListenerStatements(delegatedEventsByType, containerVar);
        
        // Handle non-delegatable events (e.g., .self modifier) with per-item listeners
        const { navStatements: eventNavStatements, addStatements: eventAddStatements } =
          buildNonDelegatableEventStatements(
            nonDelegatableEvents, staticInfo.eventElementPaths,
            staticInfo.elementBindings, navVarNames, rep, indexVar,
          );
        
        // Determine if we need to store item data on the element for delegation
        const useDelegation = delegatedEventsByType.size > 0;
        
        // Always use createKeyedReconciler — when no trackBy, inject (_, i) => i
        const keyFnExpr = rep.trackByFn || '(_, i) => i';

        const repMountLines = generateMountLines(rep.id, '        ', {
          itemVar: rep.itemVar,
          indexVar: rep.indexVar || '_idx',
        });
        const hasSignalSubs = signalSubscriptions.length > 0;
        const needsCleanups = hasSignalSubs || hasNestedConditionals || hasNestedRepeats || rep.nestedWhenElse.length > 0;

        const updateParts = [...updateStatements];
        if (useDelegation) {
          updateParts.push('_el.__d = item');
        }

        lines.push(`    const ${reconcilerVar} = ${BIND_FN.KEYED_RECONCILER}(${containerVar}, ${anchorVar},`);
        lines.push(`      (item, ${indexVar}, _ref) => {`);
        lines.push(`        const _el = ${ap.staticPrefix}_cloneNode.call(${tplContentVar}, true);`);
        if (useDelegation) {
          lines.push(`        _el.__d = item;`);
        }
        for (const navStmt of navStatements) {
          lines.push(`        ${navStmt};`);
        }
        for (const navStmt of signalNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        for (const navStmt of eventNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        lines.push(`        ${fillStatements.join('; ')};`);
        if (signalFillStatements.length > 0) {
          lines.push(`        ${signalFillStatements.join('; ')};`);
        }
        if (eventAddStatements.length > 0) {
          lines.push(`        ${eventAddStatements.join('; ')};`);
        }
        lines.push(`        ${ap.staticPrefix}_insertBefore.call(${containerVar}, _el, _ref);`);
        for (const ml of repMountLines) {
          lines.push(ml);
        }
        if (needsCleanups) {
          lines.push(`        const _cleanups = [];`);
          for (const sub of signalSubscriptions) {
            lines.push(`        ${sub};`);
          }
        }
        // Nested conditional codegen (Step 14)
        for (const cond of rep.nestedConditionals) {
          const condAnchorPath = staticInfo.directiveAnchorPaths?.get(cond.id);
          if (!condAnchorPath) continue;
          const condNavExpr = pathToSiblingNav('_el', condAnchorPath);
          lines.push(`        const _cond_${cond.id} = ${condNavExpr};`);
          const condTemplate = cond.templateContent.replace(/`/g, '\\`').replace(/\$/g, '\\$');
          const condInitNested = generateRepeatNestedCondInitFn(cond.nestedBindings, cond.nestedItemBindings, cond.nestedEventBindings, rep.itemVar, ap);
          const isSimpleExpr = cond.signalNames.length === 1 && cond.jsExpression === ap.signalCall(cond.signalName);
          if (isSimpleExpr) {
            lines.push(`        _cleanups.push(${BIND_FN.IF}(r, ${ap.signal(cond.signalName)}, '${cond.id}', \`${condTemplate}\`, ${condInitNested}, _cond_${cond.id}));`);
          } else {
            const condSignals = cond.signalNames.map(s => ap.signal(s)).join(', ');
            lines.push(`        _cleanups.push(${BIND_FN.IF_EXPR}(r, [${condSignals}], () => ${cond.jsExpression}, '${cond.id}', \`${condTemplate}\`, ${condInitNested}, _cond_${cond.id}));`);
          }
        }
        // Nested whenElse codegen (Step 14)
        for (const we of rep.nestedWhenElse) {
          const thenAnchorPath = staticInfo.directiveAnchorPaths?.get(we.thenId);
          const elseAnchorPath = staticInfo.directiveAnchorPaths?.get(we.elseId);
          if (!thenAnchorPath || !elseAnchorPath) continue;
          const thenNavExpr = pathToSiblingNav('_el', thenAnchorPath);
          const elseNavExpr = pathToSiblingNav('_el', elseAnchorPath);
          lines.push(`        const _cond_${we.thenId} = ${thenNavExpr};`);
          lines.push(`        const _cond_${we.elseId} = ${elseNavExpr};`);
          const thenTplWithId = injectIdIntoFirstElement(we.thenTemplate, we.thenId);
          const elseTplWithId = injectIdIntoFirstElement(we.elseTemplate, we.elseId);
          const escapedThen = thenTplWithId.replace(/`/g, '\\`').replace(/\$/g, '\\$');
          const escapedElse = elseTplWithId.replace(/`/g, '\\`').replace(/\$/g, '\\$');
          const thenInitFn = generateRepeatNestedCondInitFn(we.thenBindings, [], [], rep.itemVar, ap);
          const elseInitFn = generateRepeatNestedCondInitFn(we.elseBindings, [], [], rep.itemVar, ap);
          const weSignals = we.signalNames.map(s => ap.signal(s)).join(', ');
          lines.push(`        _cleanups.push(${BIND_FN.IF_EXPR}(r, [${weSignals}], () => ${we.jsExpression}, '${we.thenId}', \`${escapedThen}\`, ${thenInitFn}, _cond_${we.thenId}));`);
          lines.push(`        _cleanups.push(${BIND_FN.IF_EXPR}(r, [${weSignals}], () => !(${we.jsExpression}), '${we.elseId}', \`${escapedElse}\`, ${elseInitFn}, _cond_${we.elseId}));`);
        }
        // Nested repeat codegen (Step 15)
        for (const nr of rep.nestedRepeats) {
          const nrAnchorPath = staticInfo.directiveAnchorPaths?.get(nr.id);
          if (!nrAnchorPath) continue;
          const nrNavExpr = pathToSiblingNav('_el', nrAnchorPath);
          lines.push(`        const _nrA_${nr.id} = ${nrNavExpr};`);
          lines.push(`        const _nrC_${nr.id} = _nrA_${nr.id}.parentNode;`);
          // Generate inner static template
          const innerStaticInfo = generateStaticRepeatTemplate(nr.itemTemplate, nr.itemBindings, nr.itemVar, nr.itemEvents);
          const innerTplId = `__tpl_${nr.id}`;
          if (innerStaticInfo.canUseOptimized) {
            const innerEscaped = (innerStaticInfo.staticHtml || nr.itemTemplate.replace(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, '').replace(/\s*id="[ib]\d+"/g, '')).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
            staticTemplates.push(`  const ${innerTplId} = _T(\`${innerEscaped}\`);`);
          } else {
            const fallbackHtml = nr.itemTemplate.replace(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, '').replace(/\s*id="[ib]\d+"/g, '').replace(/\s+/g, ' ').trim();
            const innerEscaped = fallbackHtml.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
            staticTemplates.push(`  const ${innerTplId} = _T(\`${innerEscaped}\`);`);
          }
          const innerIndexVar = nr.indexVar || '_idx';
          const innerKeyFn = nr.trackByFn || '(_, i) => i';
          lines.push(`        const _nrTc_${nr.id} = ${ap.staticPrefix}${innerTplId}.content.firstElementChild;`);
          lines.push(`        const _nrRc_${nr.id} = ${BIND_FN.KEYED_RECONCILER}(_nrC_${nr.id}, _nrA_${nr.id},`);
          lines.push(`          (_nrItem, ${innerIndexVar}, _nrRef) => {`);
          lines.push(`            const _nrEl = ${ap.staticPrefix}_cloneNode.call(_nrTc_${nr.id}, true);`);
          // Inner item bindings fill & navigation
          if (innerStaticInfo.canUseOptimized && innerStaticInfo.elementBindings.length > 0) {
            for (let bi = 0; bi < innerStaticInfo.elementBindings.length; bi++) {
              const eb = innerStaticInfo.elementBindings[bi]!;
              const nv = `_nre${bi}`;
              if (eb.path.length === 0) {
                lines.push(`            const ${nv} = _nrEl;`);
              } else {
                lines.push(`            const ${nv} = ${pathToSiblingNav('_nrEl', eb.path)};`);
              }
              for (const binding of eb.bindings) {
                const expr = renameIdentifierInExpression(binding.expression, nr.itemVar, '_nrItem');
                if (binding.type === 'text') {
                  lines.push(`            ${nv}.firstChild.nodeValue = ${expr};`);
                } else if (binding.type === 'attr' && binding.property) {
                  lines.push(`            ${nv}.setAttribute('${binding.property}', ${expr});`);
                }
              }
            }
          }
          lines.push(`            ${ap.staticPrefix}_insertBefore.call(_nrC_${nr.id}, _nrEl, _nrRef);`);
          // Inner update statements
          const innerUpdateParts: string[] = [];
          if (innerStaticInfo.canUseOptimized && innerStaticInfo.elementBindings.length > 0) {
            for (let bi = 0; bi < innerStaticInfo.elementBindings.length; bi++) {
              const eb = innerStaticInfo.elementBindings[bi]!;
              const nv = `_nre${bi}`;
              for (const binding of eb.bindings) {
                const expr = renameIdentifierInExpression(binding.expression, nr.itemVar, '_nrItem');
                if (binding.type === 'text') {
                  innerUpdateParts.push(`${nv}.firstChild.nodeValue = ${expr}`);
                } else if (binding.type === 'attr' && binding.property) {
                  innerUpdateParts.push(`${nv}.setAttribute('${binding.property}', ${expr})`);
                }
              }
            }
          }
          lines.push(`            return { itemSignal: null, el: _nrEl, cleanups: [], value: _nrItem,`);
          lines.push(`              update: (_nrItem) => { ${innerUpdateParts.join('; ')}${innerUpdateParts.length ? ';' : ''} } };`);
          lines.push(`          },`);
          lines.push(`        ${innerKeyFn});`);
          // Subscribe to the signal driving the nested repeat
          const nrSignalRef = ap.signal(nr.signalName);
          // Check if the items expression references the outer item variable
          const nrItemsExpr = renameIdentifierInExpression(nr.itemsExpression, rep.itemVar, 'item');
          lines.push(`        _nrRc_${nr.id}.reconcile(${nrItemsExpr});`);
          // If the nested repeat is driven by a signal, subscribe
          if (nr.signalName) {
            lines.push(`        ${nrSignalRef}.subscribe(() => { _nrRc_${nr.id}.reconcile(${nrItemsExpr}); }, true);`);
          }
          lines.push(`        _cleanups.push(() => { _nrRc_${nr.id}.clearAll(); });`);
        }
        lines.push(`        return { itemSignal: null, el: _el, cleanups: ${needsCleanups ? '_cleanups' : '[]'}, value: item,`);
        lines.push(`          update: (item) => { ${updateParts.join('; ')}; } };`);
        lines.push(`      },`);
        lines.push(`    ${keyFnExpr});`);

        // Empty template handling (inlined by compiler — not in reconciler)
        if (rep.emptyTemplate) {
          const escapedEmptyTemplate = rep.emptyTemplate.replace(/`/g, '\\`');
          lines.push(`    let _empty_${rep.id};`);
          const emptyVar = `_empty_${rep.id}`;
          lines.push(`    const _syncEmpty_${rep.id} = (items) => { items.length ? ${emptyVar}?.remove() : ${containerVar}.insertBefore(${emptyVar} ??= _T(\`${escapedEmptyTemplate}\`).content.firstElementChild, ${anchorVar}); };`);
          lines.push(`    ${reconcilerVar}.reconcile(${ap.signal(rep.signalName)}());`);
          lines.push(`    _syncEmpty_${rep.id}(${ap.signal(rep.signalName)}());`);
          lines.push(`    ${ap.signal(rep.signalName)}.subscribe((items) => { ${reconcilerVar}.reconcile(items); _syncEmpty_${rep.id}(items); }, true);`);
        } else {
          lines.push(`    ${reconcilerVar}.reconcile(${ap.signal(rep.signalName)}());`);
          lines.push(`    ${ap.signal(rep.signalName)}.subscribe((items) => { ${reconcilerVar}.reconcile(items); }, true);`);
        }
        // Emit delegated event listeners on the container (after reconciler is ready)
        for (const stmt of delegatedListenerStatements) {
          lines.push(`    ${stmt}`);
        }
        
        continue; // Skip the fallback path
      } else if (staticInfo.canUseOptimized || !hasItemBindings) {
        // No-bindings path: template clone with no fill/update
        // Restore child mount anchor IDs (Step 7)
        const repMounts = childMountsByDirective?.get(rep.id);
        if (repMounts && staticInfo.staticHtml) {
          for (const { cm } of repMounts) {
            staticInfo.staticHtml = staticInfo.staticHtml.replace(
              '<template></template>',
              `<template id="${cm.anchorId}"></template>`,
            );
          }
        }
        
        // Use raw item template if static generation failed
        let templateHtml = staticInfo.staticHtml || rep.itemTemplate;
        // Strip remaining ${...} expressions and inline IDs for clean static template
        if (!staticInfo.staticHtml) {
          templateHtml = templateHtml.replace(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, '');
          templateHtml = templateHtml.replace(/\s*id="[ib]\d+"/g, '');
          templateHtml = templateHtml.replace(/\s+/g, ' ').trim();
        }
        
        const templateId = `__tpl_${rep.id}`;
        const escapedStaticHtml = templateHtml
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');
        staticTemplates.push(`  const ${templateId} = _T(\`${escapedStaticHtml}\`);`);

        const tplContentVar = `_tc_${rep.id}`;
        const anchorVar = `_a_${rep.id}`;
        const containerVar = `_ct_${rep.id}`;
        const reconcilerVar = `_rc_${rep.id}`;

        lines.push(`    const ${tplContentVar} = ${ap.staticPrefix}${templateId}.content.firstElementChild;`);
        lines.push(`    const ${anchorVar} = _gid('${rep.id}');`);
        lines.push(`    const ${containerVar} = ${anchorVar}.parentNode;`);

        let keyFnArg = rep.trackByFn || '(_, i) => i';

        lines.push(`    const ${reconcilerVar} = ${BIND_FN.KEYED_RECONCILER}(${containerVar}, ${anchorVar},`);
        lines.push(`      (item, ${indexVar}, _ref) => {`);
        lines.push(`        const _el = ${ap.staticPrefix}_cloneNode.call(${tplContentVar}, true);`);
        lines.push(`        ${ap.staticPrefix}_insertBefore.call(${containerVar}, _el, _ref);`);
        // Child component mounts inside repeat items (Step 7 + Step 10)
        const repMountLines = generateMountLines(rep.id, '        ', {
          itemVar: rep.itemVar,
          indexVar: rep.indexVar || '_idx',
        });
        for (const ml of repMountLines) {
          lines.push(ml);
        }
        lines.push(`        return { itemSignal: null, el: _el, cleanups: [], value: item, update: () => {} };`);
        lines.push(`      },`);
        lines.push(`    ${keyFnArg});`);

        // Empty template handling (inlined)
        if (rep.emptyTemplate) {
          const escapedEmptyTemplate = rep.emptyTemplate.replace(/`/g, '\\`');
          lines.push(`    let _empty_${rep.id};`);
          const emptyVar = `_empty_${rep.id}`;
          lines.push(`    const _syncEmpty_${rep.id} = (items) => { items.length ? ${emptyVar}?.remove() : ${containerVar}.insertBefore(${emptyVar} ??= _T(\`${escapedEmptyTemplate}\`).content.firstElementChild, ${anchorVar}); };`);
          lines.push(`    ${reconcilerVar}.reconcile(${ap.signal(rep.signalName)}());`);
          lines.push(`    _syncEmpty_${rep.id}(${ap.signal(rep.signalName)}());`);
          lines.push(`    ${ap.signal(rep.signalName)}.subscribe((items) => { ${reconcilerVar}.reconcile(items); _syncEmpty_${rep.id}(items); }, true);`);
        } else {
          lines.push(`    ${reconcilerVar}.reconcile(${ap.signal(rep.signalName)}());`);
          lines.push(`    ${ap.signal(rep.signalName)}.subscribe((items) => { ${reconcilerVar}.reconcile(items); }, true);`);
        }

        continue;
      } else if (staticInfo.skipReason) {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        if (staticInfo.skipReason === 'multi-root') {
          logger.error(NAME, `repeat() template in ${fileName} has multiple root elements. ` +
            `Wrap in a single container element for optimized rendering.`);
        } else {
          logger.warn(NAME, `repeat() in ${fileName}: ${getOptimizationSkipMessage(staticInfo.skipReason)}`);
        }
      }
    }

    // Fallback path deleted (Step 17) — all repeats must use the optimized path.
    // If we reach here, it means the repeat has features not yet handled by the
    // optimized path.
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    logger.error(NAME, `repeat() in ${fileName} cannot be compiled: unknown reason. ` +
      `This repeat configuration is not yet supported by the optimized compiler path.`);
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
export const generateStaticTemplate = (content: string, ap: AccessPattern = CLOSURE_ACCESS): string => {
  const escapedContent = content.replace(/`/g, '\\`');
  return `
  const _T = (h) => { const t = document.createElement('template'); t.innerHTML = h; return t; };
  ${ap.staticTemplatePrefix} = _T(\`${escapedContent}\`);`;
};

/**
 * Generate an updated import statement with additional bind functions
 */
export const generateUpdatedImport = (importInfo: ImportInfo, requiredBindFunctions: string[]): string => {
  const allImports = [...importInfo.namedImports, ...requiredBindFunctions];
  return `import { ${allImports.join(', ')} } from ${importInfo.quoteChar}${importInfo.moduleSpecifier}${importInfo.quoteChar}`;
};
