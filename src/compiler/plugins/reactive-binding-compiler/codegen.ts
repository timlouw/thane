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
import {
  toCamelCase,
  BIND_FN,
  logger,
  PLUGIN_NAME,
  renameIdentifierInExpression,
  parseArrowFunction,
} from '../../utils/index.js';
import {
  injectIdIntoFirstElement,
  escapeTemplateLiteral,
  escapeRawTemplateLiteral,
  normalizeHtmlWhitespace,
} from '../../utils/html-parser/index.js';
import type { ImportInfo } from '../../types.js';
import type { ChildMountInfo } from '../component-precompiler/component-precompiler.js';
import type { GeneratedInitBindingsArtifact } from '../../../contracts/index.js';
import { INTERNAL_RUNTIME_SPECIFIER, PUBLIC_RUNTIME_SPECIFIER } from '../../../contracts/index.js';

const NAME = PLUGIN_NAME.REACTIVE;

// ============================================================================
// Key Function Inlining
// ============================================================================

/**
 * Detect simple `(param) => param.prop` trackBy patterns and extract the
 * property name. When matched, the codegen emits just the property name
 * string instead of the full arrow function, letting the runtime use a
 * direct property access (avoiding per-call function invocation overhead).
 */
const _simpleKeyFnRe = /^\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.(\w+)\s*$/;
const extractKeyProperty = (trackByFn: string): string | null => {
  const m = _simpleKeyFnRe.exec(trackByFn);
  return m ? m[2]! : null;
};

const _repeatSourceRe = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)\s*$/;

const extractRepeatSourceExpression = (itemsExpression: string): string | null => {
  const match = _repeatSourceRe.exec(itemsExpression.trim());
  return match?.[1] ?? null;
};

const buildRepeatSubscriptionSources = (rep: RepeatBlock, ap: AccessPattern): string[] => {
  const directSource = extractRepeatSourceExpression(rep.itemsExpression);
  if (directSource) {
    return [directSource];
  }

  const sources: string[] = [];
  for (const signalName of rep.signalNames) {
    const signalSource = ap.signal(signalName);
    if (!sources.includes(signalSource)) {
      sources.push(signalSource);
    }
  }

  return sources;
};

const _directRepeatComponentRe = /^\s*([A-Za-z_$][\w$]*)\((.*)\)\s*$/s;

const parseDirectRepeatComponentTemplate = (
  itemTemplate: string,
): { componentName: string; propsExpression: string } | null => {
  const match = _directRepeatComponentRe.exec(itemTemplate.trim());
  if (!match) {
    return null;
  }

  return {
    componentName: match[1]!,
    propsExpression: match[2]?.trim() || '{}',
  };
};

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
      const keyMods = evt.modifiers.filter((m) => m !== 'prevent' && m !== 'stop' && m !== 'self');
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

    statements.push(`${containerVar}.addEventListener('${eventName}', (e) => { ${finalBody.join(' ')} });`);
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
    const keyMods = evt.modifiers.filter((m) => m !== 'prevent' && m !== 'stop' && m !== 'self');
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
  enter: ['Enter'],
  tab: ['Tab'],
  delete: ['Backspace', 'Delete'],
  esc: ['Escape'],
  escape: ['Escape'],
  space: [' '],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
};

/**
 * Compile key modifier names into a JS guard expression.
 * Returns `null` if no valid key modifiers are present.
 *
 * The guard uses `&&` so that the early-return fires only when the pressed
 * key matches **none** of the listed keys.  With `||` the condition was a
 * tautology (always true) whenever more than one key was listed.
 *
 * @example compileKeyGuard(['enter', 'tab']) => "e.key !== 'Enter' && e.key !== 'Tab'"
 */
const compileKeyGuard = (modifiers: string[]): string | null => {
  const checks = modifiers
    .map((mod) => {
      const keys = KEY_MAP[mod];
      if (!keys) return null;
      return keys.length === 1 ? `e.key !== '${keys[0]}'` : `!${JSON.stringify(keys)}.includes(e.key)`;
    })
    .filter(Boolean);
  return checks.length > 0 ? checks.join(' && ') : null;
};

/**
 * Generate binding update code for a single simple binding.
 * For text bindings, navigates from comment marker to adjacent text node.
 */
export const generateBindingUpdateCode = (binding: SimpleBinding): string => {
  const elRef = binding.id;

  if (binding.type === 'style') {
    const prop = toCamelCase(binding.property!);
    return `${elRef}.style.${prop} = v`;
  } else if (binding.type === 'attr') {
    return `${elRef}.setAttribute('${binding.property}', v)`;
  } else {
    // Comment marker → next sibling text node
    return `${elRef}.nextSibling.data = v`;
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
    // Comment marker → next sibling text node
    return `${elRef}.nextSibling.data = ${signalCall}`;
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
export const generateConsolidatedSubscription = (
  signalName: string,
  bindings: SimpleBinding[],
  ap: AccessPattern = CLOSURE_ACCESS,
): string => {
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
  // Build comment marker map for text bindings in this conditional
  const itemTextIds = new Set(nestedItemBindings.filter((b) => b.type === 'text').map((b) => b.elementId));
  const signalTextIds = new Set([
    ...nestedBindings.filter((b) => b.type === 'text' && isSimpleBinding(b)).map((b) => (b as SimpleBinding).id),
    ...nestedBindings.filter((b) => b.type === 'text' && isExpressionBinding(b)).map((b) => (b as SimpleBinding).id),
  ]);
  const hasTextMarkers = itemTextIds.size > 0 || signalTextIds.size > 0;
  if (hasTextMarkers) {
    parts.push(
      `  const _rcm = {}; { const _w = document.createTreeWalker(_c || document, 128); let _n; while (_n = _w.nextNode()) _rcm[_n.data] = _n; }`,
    );
  }
  // Item bindings: set once when conditional shows
  const itemElIds = [...new Set(nestedItemBindings.map((b) => b.elementId))];
  for (const elId of itemElIds) {
    parts.push(`  const _n_${elId} = ${itemTextIds.has(elId) ? `_rcm['${elId}']` : `_gid('${elId}')`};`);
  }
  for (const ib of nestedItemBindings) {
    const expr = renameIdentifierInExpression(ib.expression, outerItemVar, 'item');
    if (ib.type === 'text') {
      // Comment marker: nextSibling.data targets the text node after <!--id-->
      parts.push(`  if (_n_${ib.elementId}) _n_${ib.elementId}.nextSibling.data = ${expr};`);
    } else if (ib.type === 'attr' && ib.property) {
      parts.push(`  if (_n_${ib.elementId}) _n_${ib.elementId}.setAttribute('${ib.property}', ${expr});`);
    }
  }
  // Signal bindings
  const simpleNested = nestedBindings.filter(isSimpleBinding);
  const exprNested = nestedBindings.filter(isExpressionBinding);
  const signalElIds = [...new Set([...simpleNested.map((b) => b.id), ...exprNested.map((b) => b.id)])];
  for (const elId of signalElIds) {
    if (!itemElIds.includes(elId)) {
      parts.push(`  const _n_${elId} = ${signalTextIds.has(elId) ? `_rcm['${elId}']` : `_gid('${elId}')`};`);
    }
  }
  // Initial values for signal bindings
  for (const sb of simpleNested) {
    const renamedSignalName = sb.signalName === outerItemVar ? 'item' : sb.signalName;
    const signalCall = ap.signalCall(renamedSignalName);
    if (sb.type === 'text') {
      parts.push(`  if (_n_${sb.id}) _n_${sb.id}.nextSibling.data = ${signalCall};`);
    } else if (sb.type === 'attr' && sb.property) {
      parts.push(`  if (_n_${sb.id}) _n_${sb.id}.setAttribute('${sb.property}', ${signalCall});`);
    } else if (sb.type === 'style' && sb.property) {
      parts.push(`  if (_n_${sb.id}) _n_${sb.id}.style.setProperty('${sb.property}', ${signalCall});`);
    }
  }
  for (const eb of exprNested) {
    const renamedExpr = renameIdentifierInExpression(eb.expression, outerItemVar, 'item');
    if (eb.type === 'text') {
      parts.push(`  if (_n_${eb.id}) _n_${eb.id}.nextSibling.data = ${renamedExpr};`);
    } else if (eb.type === 'attr' && eb.property) {
      parts.push(`  if (_n_${eb.id}) _n_${eb.id}.setAttribute('${eb.property}', ${renamedExpr});`);
    } else if (eb.type === 'style' && eb.property) {
      parts.push(`  if (_n_${eb.id}) _n_${eb.id}.style.setProperty('${eb.property}', ${renamedExpr});`);
    }
  }
  parts.push('  const _nsubs = [];');
  // Subscriptions for signal bindings
  const renamedSimpleNested = simpleNested.map((sb) => ({
    ...sb,
    signalName: sb.signalName === outerItemVar ? 'item' : sb.signalName,
  }));
  const signalGroups = groupBindingsBySignal(renamedSimpleNested);
  for (const [signalName, sbs] of signalGroups) {
    const updates = sbs
      .map((sb) => {
        if (sb.type === 'text') return `if (_n_${sb.id}) _n_${sb.id}.nextSibling.data = v`;
        if (sb.type === 'attr' && sb.property) return `if (_n_${sb.id}) _n_${sb.id}.setAttribute('${sb.property}', v)`;
        if (sb.type === 'style' && sb.property)
          return `if (_n_${sb.id}) _n_${sb.id}.style.setProperty('${sb.property}', v)`;
        return '';
      })
      .filter(Boolean);
    if (updates.length === 1) {
      parts.push(`  _nsubs.push(${ap.signal(signalName)}.subscribe(v => { ${updates[0]}; }, true));`);
    } else if (updates.length > 1) {
      parts.push(`  _nsubs.push(${ap.signal(signalName)}.subscribe(v => { ${updates.join('; ')}; }, true));`);
    }
  }
  for (const eb of exprNested) {
    const renamedExpr = renameIdentifierInExpression(eb.expression, outerItemVar, 'item');
    let updFn = '';
    if (eb.type === 'text') {
      updFn = `() => { if (_n_${eb.id}) _n_${eb.id}.nextSibling.data = ${renamedExpr}; }`;
    } else if (eb.type === 'attr' && eb.property) {
      updFn = `() => { if (_n_${eb.id}) _n_${eb.id}.setAttribute('${eb.property}', ${renamedExpr}); }`;
    } else if (eb.type === 'style' && eb.property) {
      updFn = `() => { if (_n_${eb.id}) _n_${eb.id}.style.setProperty('${eb.property}', ${renamedExpr}); }`;
    }
    if (!updFn) continue;
    for (const sig of eb.signalNames) {
      const renamedSig = sig === outerItemVar ? 'item' : ap.signal(sig);
      parts.push(`  _nsubs.push(${renamedSig}.subscribe(${updFn}, true));`);
    }
  }
  parts.push('  return _nsubs;');
  parts.push('}');
  return parts.join('\n');
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
  childMountsByDirective?: Map<string, { cm: ChildMountInfo; globalIndex: number }[]>,
): GeneratedInitBindingsArtifact => {
  const lines: string[] = [];
  const staticTemplates: string[] = []; // Collect static templates for repeat optimizations

  // ── Helper: generate child component mount lines for directive-nested mounts ──
  // Returns { setupLines, cleanupExprs } — consumers add setupLines as statements
  // and route cleanupExprs into the appropriate cleanup array/return value.
  const generateMountInfo = (
    directiveId: string,
    indent: string,
    repeatCtx?: { itemVar: string; indexVar: string },
  ): { setupLines: string[]; cleanupExprs: string[] } => {
    const mounts = childMountsByDirective?.get(directiveId);
    if (!mounts || mounts.length === 0) return { setupLines: [], cleanupExprs: [] };
    const setupLines: string[] = [];
    const cleanupExprs: string[] = [];
    for (const { cm, globalIndex } of mounts) {
      const varName = `_cm${globalIndex}`;
      const anchorVar = `_cma${globalIndex}`;
      let propsExpr = cm.propsExpression;
      // Step 10: Rename repeat-context variables in props expression
      if (repeatCtx) {
        propsExpr = renameIdentifierInExpression(propsExpr, repeatCtx.itemVar, 'item');
        if (repeatCtx.indexVar && repeatCtx.indexVar !== '_idx') {
          propsExpr = renameIdentifierInExpression(propsExpr, repeatCtx.indexVar, '_idx');
        }
      }
      setupLines.push(`${indent}const ${varName} = document.createElement('${cm.selector}');`);
      if (repeatCtx) {
        setupLines.push(
          `${indent}const ${anchorVar} = (_el.id === '${cm.anchorId}' ? _el : _el.querySelector('#${cm.anchorId}'));`,
        );
      } else {
        setupLines.push(`${indent}const ${anchorVar} = _gid('${cm.anchorId}');`);
      }
      setupLines.push(`${indent}if (${anchorVar}) ${anchorVar}.replaceWith(${varName});`);
      cleanupExprs.push(`${BIND_FN.DESTROY_CHILD}(${cm.componentName}.__f(${varName}, ${propsExpr}))`);
    }
    return { setupLines, cleanupExprs };
  };

  const buildEventListenerStatements = (events: EventBinding[], _rootVar: string): string[] => {
    const statements: string[] = [];
    for (const evt of events) {
      let handlerCode = evt.handlerExpression;

      const hasModifiers = evt.modifiers.length > 0;
      const hasPrevent = evt.modifiers.includes('prevent');
      const hasStop = evt.modifiers.includes('stop');
      const hasSelf = evt.modifiers.includes('self');
      const keyModifiers = evt.modifiers.filter((m) => m !== 'prevent' && m !== 'stop' && m !== 'self');

      // Detect whether the expression is a function call (e.g. navigate('/path'))
      // vs a function reference (e.g. handleClick) or arrow function (e.g. (e) => ...).
      // Function calls must be wrapped so they execute on-event, not at bind-time.
      const isArrow = parseArrowFunction(handlerCode) !== null;
      const isSimpleRef = /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(handlerCode.trim());
      const isFnCall = !isArrow && !isSimpleRef;

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
        if (isFnCall) {
          bodyParts.push(`${handlerCode};`);
        } else {
          bodyParts.push(`(${handlerCode})(e);`);
        }
        handlerExpr = `(e) => { ${bodyParts.join(' ')} }`;
      } else if (isFnCall) {
        handlerExpr = `() => { ${handlerCode}; }`;
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
  lines.push(`    const _gid = (id) => r.querySelector('#' + id);`);
  // Collect top-level subscription unsubscribe handles for cleanup on destroy
  lines.push(`    const _subs = [];`);
  // Compute top-level binding info early so we can decide whether to emit the comment walker
  const topLevelBindings = bindings.filter((b) => !b.isInsideConditional);
  // Separate expression bindings (multi-signal) from simple bindings
  const simpleBindings = topLevelBindings.filter(isSimpleBinding);
  const expressionBindings = topLevelBindings.filter(isExpressionBinding);
  // IDs that target comment markers (text bindings) vs element IDs (attr/style/event)
  const textBindingIds = new Set<string>();
  for (const b of topLevelBindings) {
    if (b.type === 'text') textBindingIds.add(b.id);
  }
  // Check if _fcm (comment marker factory) is needed at any level — conditionals and
  // whenElse branches may reference it even when top-level text bindings don't exist.
  const hasConditionalTextBindings = (() => {
    const checkCond = (cond: ConditionalBlock): boolean => {
      if (cond.nestedBindings?.some((b) => b.type === 'text')) return true;
      if (cond.nestedConditionals?.some((nc) => checkCond(nc))) return true;
      return false;
    };
    if (conditionals.some(checkCond)) return true;
    const checkWE = (we: WhenElseBlock): boolean => {
      if (we.thenBindings?.some((b) => b.type === 'text')) return true;
      if (we.elseBindings?.some((b) => b.type === 'text')) return true;
      if (we.nestedConditionals?.some((nc) => checkCond(nc))) return true;
      if (we.nestedWhenElse?.some((nwe) => checkWE(nwe))) return true;
      return false;
    };
    if (whenElseBlocks.some(checkWE)) return true;
    return false;
  })();
  const needsFcm = textBindingIds.size > 0 || hasConditionalTextBindings;
  // Collect all comment markers (<!--bN-->) into a map for O(1) lookup.
  // NodeFilter.SHOW_COMMENT = 128 — only emit when text bindings exist somewhere.
  if (needsFcm) {
    lines.push(
      `    const _fcm = (root) => { const m = {}; const w = document.createTreeWalker(root, 128); let n; while (n = w.nextNode()) m[n.data] = n; return m; };`,
    );
    if (textBindingIds.size > 0) {
      lines.push(`    const _cm = _fcm(r);`);
    }
  }
  const topLevelIds = [...new Set(topLevelBindings.map((b) => b.id))];
  if (topLevelIds.length > 0) {
    for (const id of topLevelIds) {
      // Text bindings use comment markers found via TreeWalker; others use getElementById
      lines.push(`    const ${id} = ${textBindingIds.has(id) ? `_cm['${id}']` : `_gid('${id}')`};`);
    }
  }
  // Simple bindings: initial value assignment + consolidated subscription
  for (const binding of simpleBindings) {
    lines.push(`    ${generateInitialValueCode(binding, ap)};`);
  }
  const signalGroups = groupBindingsBySignal(simpleBindings);
  for (const [signalName, signalBindings] of signalGroups) {
    lines.push(`    _subs.push(${generateConsolidatedSubscription(signalName, signalBindings, ap)});`);
  }
  // Expression bindings: multi-subscribe pattern
  // e.g. const _upd_b2 = () => { b2.nextSibling.data = count() + 1; };
  //      count.subscribe(_upd_b2, true);
  expressionBindings.forEach((binding, idx) => {
    const updFn = `_upd_${binding.id}_${idx}`;
    const expr = binding.expression;
    const signals = binding.signalNames;
    if (binding.type === 'text') {
      lines.push(`    const ${updFn} = () => { ${binding.id}.nextSibling.data = ${expr}; };`);
    } else if (binding.type === 'attr' && binding.property) {
      lines.push(`    const ${updFn} = () => { ${binding.id}.setAttribute('${binding.property}', ${expr}); };`);
    } else if (binding.type === 'style' && binding.property) {
      lines.push(`    const ${updFn} = () => { ${binding.id}.style.setProperty('${binding.property}', ${expr}); };`);
    } else {
      return;
    }
    lines.push(`    ${updFn}();`);
    for (const sig of signals) {
      lines.push(`    _subs.push(${ap.signal(sig)}.subscribe(${updFn}, true));`);
    }
  });

  for (const cond of conditionals) {
    const nestedBindings = cond.nestedBindings;
    const nestedConds = cond.nestedConditionals || [];
    const escapedTemplate = escapeTemplateLiteral(cond.templateContent);
    let nestedCode = '() => []';
    const condMountInfo = generateMountInfo(cond.id, '      ');
    const hasCondMounts = condMountInfo.setupLines.length > 0;
    if (nestedBindings.length > 0 || nestedConds.length > 0 || hasCondMounts) {
      const nestedTextIds = new Set(nestedBindings.filter((b) => b.type === 'text').map((b) => b.id));
      const nestedIds = [...new Set(nestedBindings.map((b) => b.id))];
      const nestedLines: string[] = [];
      nestedLines.push('() => {');
      // Re-scan for comment markers since conditional content was just inserted
      if (nestedTextIds.size > 0) {
        nestedLines.push(`      const _ncm = _fcm(r);`);
      }
      for (const id of nestedIds) {
        nestedLines.push(`      const ${id} = ${nestedTextIds.has(id) ? `_ncm['${id}']` : `_gid('${id}')`};`);
      }
      const nestedSimpleBindings = nestedBindings.filter(isSimpleBinding);
      const nestedExpressionBindings = nestedBindings.filter(isExpressionBinding);
      for (const binding of nestedSimpleBindings) {
        nestedLines.push(`      ${generateInitialValueCode(binding, ap)};`);
      }
      nestedExpressionBindings.forEach((binding, idx) => {
        const updFn = `_upd_${binding.id}_${idx}`;
        const expr = binding.expression;
        if (binding.type === 'text') {
          nestedLines.push(`      const ${updFn} = () => { ${binding.id}.nextSibling.data = ${expr}; };`);
        } else if (binding.type === 'attr' && binding.property) {
          nestedLines.push(
            `      const ${updFn} = () => { ${binding.id}.setAttribute('${binding.property}', ${expr}); };`,
          );
        } else if (binding.type === 'style' && binding.property) {
          nestedLines.push(
            `      const ${updFn} = () => { ${binding.id}.style.setProperty('${binding.property}', ${expr}); };`,
          );
        }
        // Expression bindings always need an explicit initial call because
        // subscribe(..., true) skips the initial notification.
        nestedLines.push(`      ${updFn}();`);
      });
      const nestedSignalGroups = groupBindingsBySignal(nestedSimpleBindings);
      if (cond.nestedEventBindings.length > 0) {
        const nestedEventLines = buildEventListenerStatements(cond.nestedEventBindings, 'r');
        for (const line of nestedEventLines) {
          nestedLines.push(`      ${line}`);
        }
      }
      for (const sl of condMountInfo.setupLines) {
        nestedLines.push(sl);
      }
      nestedLines.push('      return [');
      for (const [signalName, signalBindings] of nestedSignalGroups) {
        nestedLines.push(`        ${generateConsolidatedSubscription(signalName, signalBindings, ap)},`);
      }
      for (const ce of condMountInfo.cleanupExprs) {
        nestedLines.push(`        ${ce},`);
      }
      nestedExpressionBindings.forEach((binding, idx) => {
        const updFn = `_upd_${binding.id}_${idx}`;
        const signals = binding.signalNames;
        for (const sig of signals) {
          nestedLines.push(`        ${ap.signal(sig)}.subscribe(${updFn}, true),`);
        }
      });
      for (const nestedCond of nestedConds) {
        const nestedCondEscaped = escapeTemplateLiteral(nestedCond.templateContent);
        let innerNestedCode = '() => []';
        if (nestedCond.nestedBindings.length > 0) {
          const innerSimple = nestedCond.nestedBindings.filter(isSimpleBinding);
          const innerExpr = nestedCond.nestedBindings.filter(isExpressionBinding);
          const innerTextIds = new Set(nestedCond.nestedBindings.filter((b) => b.type === 'text').map((b) => b.id));
          const innerBindingLines: string[] = [];
          const innerIds = [...new Set(nestedCond.nestedBindings.map((b) => b.id))];
          innerBindingLines.push('() => {');
          if (innerTextIds.size > 0) {
            innerBindingLines.push(`        const _icm = _fcm(r);`);
          }
          for (const id of innerIds) {
            innerBindingLines.push(
              `        const ${id} = ${innerTextIds.has(id) ? `_icm['${id}']` : `_gid('${id}')`};`,
            );
          }
          for (const binding of innerSimple) {
            innerBindingLines.push(`        ${generateInitialValueCode(binding, ap)};`);
          }
          innerExpr.forEach((binding, idx) => {
            const updFn = `_upd_${binding.id}_${idx}`;
            const expr = binding.expression;
            if (binding.type === 'text') {
              innerBindingLines.push(`        const ${updFn} = () => { ${binding.id}.nextSibling.data = ${expr}; };`);
            } else if (binding.type === 'attr' && binding.property) {
              innerBindingLines.push(
                `        const ${updFn} = () => { ${binding.id}.setAttribute('${binding.property}', ${expr}); };`,
              );
            } else if (binding.type === 'style' && binding.property) {
              innerBindingLines.push(
                `        const ${updFn} = () => { ${binding.id}.style.setProperty('${binding.property}', ${expr}); };`,
              );
            }
            innerBindingLines.push(`        ${updFn}();`);
          });
          const innerGroups = groupBindingsBySignal(innerSimple);
          innerBindingLines.push('        return [');
          for (const [signalName, signalBindings] of innerGroups) {
            innerBindingLines.push(`          ${generateConsolidatedSubscription(signalName, signalBindings, ap)},`);
          }
          innerExpr.forEach((binding, idx) => {
            const updFn = `_upd_${binding.id}_${idx}`;
            for (const sig of binding.signalNames) {
              innerBindingLines.push(`          ${ap.signal(sig)}.subscribe(${updFn}, true),`);
            }
          });
          innerBindingLines.push('        ];');
          innerBindingLines.push('      }');
          innerNestedCode = innerBindingLines.join('\n');
        }

        const isNestedSimple =
          nestedCond.signalNames.length === 1 && nestedCond.jsExpression === ap.signalCall(nestedCond.signalName);
        if (isNestedSimple) {
          nestedLines.push(
            `        ${BIND_FN.IF}(r, ${ap.signal(nestedCond.signalName)}, '${nestedCond.id}', \`${nestedCondEscaped}\`, ${innerNestedCode}),`,
          );
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
      lines.push(
        `    _subs.push(${BIND_FN.IF}(r, ${ap.signal(cond.signalName)}, '${cond.id}', \`${escapedTemplate}\`, ${nestedCode}));`,
      );
    } else {
      const signalsArray = cond.signalNames.map((s) => ap.signal(s)).join(', ');
      lines.push(
        `    _subs.push(${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${cond.jsExpression}, '${cond.id}', \`${escapedTemplate}\`, ${nestedCode}));`,
      );
    }
  }
  for (const we of whenElseBlocks) {
    const thenTemplateWithId = injectIdIntoFirstElement(we.thenTemplate, we.thenId);
    const elseTemplateWithId = injectIdIntoFirstElement(we.elseTemplate, we.elseId);
    const escapedThenTemplate = escapeTemplateLiteral(thenTemplateWithId);
    const escapedElseTemplate = escapeTemplateLiteral(elseTemplateWithId);
    const generateNestedInitializer = (
      bindings: BindingInfo[],
      nestedConds: ConditionalBlock[],
      nestedWE: WhenElseBlock[],
      nestedReps: RepeatBlock[],
      directiveId?: string,
      nestedEvents: EventBinding[] = [],
    ): string => {
      const weMountInfo = directiveId ? generateMountInfo(directiveId, '      ') : { setupLines: [], cleanupExprs: [] };
      const hasWeMounts = weMountInfo.setupLines.length > 0;
      if (
        bindings.length === 0 &&
        nestedConds.length === 0 &&
        nestedWE.length === 0 &&
        nestedReps.length === 0 &&
        nestedEvents.length === 0 &&
        !hasWeMounts
      ) {
        return '() => []';
      }

      const initLines: string[] = [];
      initLines.push('() => {');
      const weTextIds = new Set(bindings.filter((b) => b.type === 'text').map((b) => b.id));
      const ids = [...new Set(bindings.map((b) => b.id))];
      if (weTextIds.size > 0) {
        initLines.push(`      const _wcm = _fcm(r);`);
      }
      for (const id of ids) {
        initLines.push(`      const ${id} = ${weTextIds.has(id) ? `_wcm['${id}']` : `_gid('${id}')`};`);
      }
      const simpleNestedBindings = bindings.filter(isSimpleBinding);
      const exprNestedBindings = bindings.filter(isExpressionBinding);
      for (const binding of simpleNestedBindings) {
        initLines.push(`      ${generateInitialValueCode(binding, ap)};`);
      }
      exprNestedBindings.forEach((binding, idx) => {
        const updFn = `_upd_${binding.id}_${idx}`;
        const expr = binding.expression;
        if (binding.type === 'text') {
          initLines.push(`      const ${updFn} = () => { ${binding.id}.nextSibling.data = ${expr}; };`);
        } else if (binding.type === 'attr' && binding.property) {
          initLines.push(
            `      const ${updFn} = () => { ${binding.id}.setAttribute('${binding.property}', ${expr}); };`,
          );
        } else if (binding.type === 'style' && binding.property) {
          initLines.push(
            `      const ${updFn} = () => { ${binding.id}.style.setProperty('${binding.property}', ${expr}); };`,
          );
        }
        // Expression bindings always need an explicit initial call because
        // subscribe(..., true) skips the initial notification.
        initLines.push(`      ${updFn}();`);
      });
      for (const sl of weMountInfo.setupLines) {
        initLines.push(sl);
      }

      // Generate addEventListener calls for event bindings inside whenElse branches
      if (nestedEvents.length > 0) {
        const nestedEventLines = buildEventListenerStatements(nestedEvents, 'r');
        for (const line of nestedEventLines) {
          initLines.push(`      ${line}`);
        }
      }

      const nestedRepeatCleanupVars: string[] = [];
      for (const rep of nestedReps) {
        const indexVarName = rep.indexVar || '_idx';
        const anchorVar = `_wra_${rep.id}`;
        const containerVar = `_wrc_${rep.id}`;
        const startVar = `_wrs_${rep.id}`;
        const renderItemVar = `_wri_${rep.id}`;
        const bindEventsVar = `_wbe_${rep.id}`;
        const renderVar = `_wrr_${rep.id}`;
        const itemsGetterVar = `_wget_${rep.id}`;
        const emptyFlagVar = `_wre_${rep.id}`;
        const sourceTemplate = rep.itemTemplate.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
        const itemSignalAccessorDecl = ` const ${rep.itemVar}$ = () => item;`;
        const itemAliasDecl = rep.itemVar === 'item' ? '' : ` const ${rep.itemVar} = item;`;
        const emptyTemplate = escapeRawTemplateLiteral(rep.emptyTemplate || '');

        initLines.push(`      let _wcleanup_${rep.id} = () => {};`);
        initLines.push(`      const ${anchorVar} = _gid('${rep.id}');`);
        initLines.push(`      if (${anchorVar}) {`);
        initLines.push(`        const ${containerVar} = ${anchorVar}.parentNode;`);
        initLines.push(`        const ${startVar} = document.createComment('r:${rep.id}');`);
        initLines.push(`        ${containerVar}.insertBefore(${startVar}, ${anchorVar});`);
        initLines.push(`        const ${itemsGetterVar} = () => ${rep.itemsExpression};`);
        initLines.push(
          `        const ${renderItemVar} = (item, ${indexVarName}) => {${itemSignalAccessorDecl}${itemAliasDecl} return \`${sourceTemplate}\`; };`,
        );
        initLines.push(`        const ${bindEventsVar} = (_frag, item, ${indexVarName}) => {`);
        rep.itemEvents.forEach((evt, eventIdx) => {
          let handlerExpr = renameIdentifierInExpression(evt.handlerExpression, rep.itemVar, 'item');
          if (rep.indexVar && rep.indexVar !== indexVarName) {
            handlerExpr = renameIdentifierInExpression(handlerExpr, rep.indexVar, indexVarName);
          }
          const arrowParsed = parseArrowFunction(handlerExpr);
          if (arrowParsed) {
            handlerExpr = arrowParsed.isBlockBody ? arrowParsed.body.slice(1, -1).trim() : arrowParsed.body;
          }

          const bodyParts: string[] = [];
          if (evt.modifiers.includes('self')) bodyParts.push('if (e.target !== e.currentTarget) return');
          const keyModifiers = evt.modifiers.filter((m) => m !== 'prevent' && m !== 'stop' && m !== 'self');
          if (keyModifiers.length > 0) {
            const guard = compileKeyGuard(keyModifiers);
            if (guard) bodyParts.push(`if (${guard}) return`);
          }
          if (evt.modifiers.includes('prevent')) bodyParts.push('e.preventDefault()');
          if (evt.modifiers.includes('stop')) bodyParts.push('e.stopPropagation()');
          bodyParts.push(handlerExpr);
          const listenerBody = bodyParts.join('; ');

          initLines.push(`          const _evt_${rep.id}_${eventIdx} = _frag.querySelector('#${evt.elementId}');`);
          initLines.push(`          if (_evt_${rep.id}_${eventIdx}) {`);
          initLines.push(
            `            _evt_${rep.id}_${eventIdx}.addEventListener('${evt.eventName}', (e) => { ${listenerBody}; });`,
          );
          initLines.push(`            _evt_${rep.id}_${eventIdx}.removeAttribute('id');`);
          initLines.push('          }');
        });
        initLines.push('        };');
        const hasRepNestedConds = rep.nestedConditionals.length > 0;
        if (hasRepNestedConds) {
          initLines.push(`        let _wric_${rep.id} = [];`);
        }
        if (rep.emptyTemplate) {
          initLines.push(`        let ${emptyFlagVar} = false;`);
        }
        initLines.push(`        const ${renderVar} = (items) => {`);
        initLines.push(`          let _n = ${startVar}.nextSibling;`);
        initLines.push(
          `          while (_n && _n !== ${anchorVar}) { const _next = _n.nextSibling; _n.remove(); _n = _next; }`,
        );
        if (hasRepNestedConds) {
          initLines.push(`          for (let _ic = 0; _ic < _wric_${rep.id}.length; _ic++) _wric_${rep.id}[_ic]();`);
          initLines.push(`          _wric_${rep.id} = [];`);
        }
        initLines.push(`          if (!items || items.length === 0) {`);
        if (rep.emptyTemplate) {
          initLines.push(`            if (!${emptyFlagVar}) {`);
          initLines.push(`              const _et = _T(\`${emptyTemplate}\`).content;`);
          initLines.push(
            `              while (_et.firstChild) ${containerVar}.insertBefore(_et.firstChild, ${anchorVar});`,
          );
          initLines.push(`              ${emptyFlagVar} = true;`);
          initLines.push('            }');
        }
        initLines.push('            return;');
        initLines.push('          }');
        if (rep.emptyTemplate) {
          initLines.push(`          ${emptyFlagVar} = false;`);
        }
        initLines.push('          for (let i = 0; i < items.length; i++) {');
        initLines.push('            const item = items[i];');
        initLines.push("            const _t = document.createElement('template');");
        initLines.push(`            _t.innerHTML = ${renderItemVar}(item, i);`);
        initLines.push('            const _f = _t.content;');
        if (rep.itemEvents.length > 0) {
          initLines.push(`            ${bindEventsVar}(_f, item, i);`);
        }
        // Find conditional anchor elements in item fragment before insertion
        for (const cond of rep.nestedConditionals) {
          initLines.push(`            const _ca_${cond.id} = _f.querySelector('#${cond.id}');`);
        }
        initLines.push(`            while (_f.firstChild) ${containerVar}.insertBefore(_f.firstChild, ${anchorVar});`);
        // Set up when directives after items are in the DOM
        for (const cond of rep.nestedConditionals) {
          const renamedExpr = renameIdentifierInExpression(cond.jsExpression, rep.itemVar, 'item');
          const condTemplate = escapeTemplateLiteral(cond.templateContent);
          const condInitNested = generateRepeatNestedCondInitFn(
            cond.nestedBindings,
            cond.nestedItemBindings,
            cond.nestedEventBindings,
            rep.itemVar,
            ap,
          );
          const renamedSignalNames = cond.signalNames.map((s) => (s === rep.itemVar ? 'item' : ap.signal(s)));
          const isSimpleExpr = cond.signalNames.length === 1 && cond.jsExpression === ap.signalCall(cond.signalName);
          if (isSimpleExpr) {
            const renamedSignal = cond.signalName === rep.itemVar ? 'item' : ap.signal(cond.signalName);
            initLines.push(
              `            _wric_${rep.id}.push(${BIND_FN.IF}(r, ${renamedSignal}, '${cond.id}', \`${condTemplate}\`, ${condInitNested}, _ca_${cond.id}));`,
            );
          } else {
            const signalsArray = renamedSignalNames.join(', ');
            initLines.push(
              `            _wric_${rep.id}.push(${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${renamedExpr}, '${cond.id}', \`${condTemplate}\`, ${condInitNested}, _ca_${cond.id}));`,
            );
          }
        }
        initLines.push('          }');
        initLines.push('        };');
        initLines.push(`        ${renderVar}(${itemsGetterVar}());`);
        const repeatSources = buildRepeatSubscriptionSources(rep, ap);
        if (repeatSources.length > 0) {
          initLines.push(`        const _wsrc_${rep.id} = ${repeatSources[0]};`);
          initLines.push(
            `        const _wsub_${rep.id} = typeof _wsrc_${rep.id}?.subscribe === 'function' ? _wsrc_${rep.id}.subscribe(() => { ${renderVar}(${itemsGetterVar}()); }, true) : () => {};`,
          );
        } else {
          initLines.push(`        const _wsub_${rep.id} = () => {};`);
        }

        const extraRepeatSources = repeatSources.slice(1);
        for (let sourceIdx = 0; sourceIdx < extraRepeatSources.length; sourceIdx++) {
          const sourceExpr = extraRepeatSources[sourceIdx]!;
          initLines.push(`        const _wsrc_${rep.id}_${sourceIdx} = ${sourceExpr};`);
          initLines.push(
            `        const _wsub_${rep.id}_${sourceIdx} = typeof _wsrc_${rep.id}_${sourceIdx}?.subscribe === 'function' ? _wsrc_${rep.id}_${sourceIdx}.subscribe(() => { ${renderVar}(${itemsGetterVar}()); }, true) : () => {};`,
          );
        }

        const fallbackSignals = [
          ...new Set(rep.signalBindings.map((s) => s.signalName).filter((s) => !!s && s !== rep.signalName)),
        ];
        for (const sig of fallbackSignals) {
          initLines.push(`        const _wsrc_${rep.id}_${sig} = ${ap.signal(sig)};`);
          initLines.push(
            `        const _wsub_${rep.id}_${sig} = typeof _wsrc_${rep.id}_${sig}?.subscribe === 'function' ? _wsrc_${rep.id}_${sig}.subscribe(() => { ${renderVar}(${itemsGetterVar}()); }, true) : () => {};`,
          );
        }

        const cleanupParts = [`_wsub_${rep.id}`];
        for (let sourceIdx = 0; sourceIdx < extraRepeatSources.length; sourceIdx++) {
          cleanupParts.push(`_wsub_${rep.id}_${sourceIdx}`);
        }
        for (const sig of fallbackSignals) {
          cleanupParts.push(`_wsub_${rep.id}_${sig}`);
        }
        if (hasRepNestedConds) {
          initLines.push(
            `        const _wric_cleanup_${rep.id} = () => { for (let _ic = 0; _ic < _wric_${rep.id}.length; _ic++) _wric_${rep.id}[_ic](); };`,
          );
          cleanupParts.push(`_wric_cleanup_${rep.id}`);
        }
        initLines.push(`        _wcleanup_${rep.id} = () => { ${cleanupParts.map((c) => `${c}();`).join(' ')} };`);
        nestedRepeatCleanupVars.push(`_wcleanup_${rep.id}`);
        initLines.push('      }');
      }

      initLines.push('      return [');
      const signalGroups = groupBindingsBySignal(simpleNestedBindings);
      for (const [signalName, signalBindings] of signalGroups) {
        initLines.push(`        ${generateConsolidatedSubscription(signalName, signalBindings, ap)},`);
      }
      for (const ce of weMountInfo.cleanupExprs) {
        initLines.push(`        ${ce},`);
      }
      exprNestedBindings.forEach((binding, idx) => {
        const updFn = `_upd_${binding.id}_${idx}`;
        const signals = binding.signalNames;
        for (const sig of signals) {
          initLines.push(`        ${ap.signal(sig)}.subscribe(${updFn}, true),`);
        }
      });
      for (const cond of nestedConds) {
        const nestedEscapedTemplate = escapeTemplateLiteral(cond.templateContent);
        const nestedBindingsCode = generateNestedInitializer(cond.nestedBindings, [], [], []);
        const isSimple = cond.signalNames.length === 1 && cond.jsExpression === ap.signalCall(cond.signalName);
        if (isSimple) {
          initLines.push(
            `        ${BIND_FN.IF}(r, ${ap.signal(cond.signalName)}, '${cond.id}', \`${nestedEscapedTemplate}\`, ${nestedBindingsCode}),`,
          );
        } else {
          const signalsArray = cond.signalNames.map((s) => ap.signal(s)).join(', ');
          initLines.push(
            `        ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${cond.jsExpression}, '${cond.id}', \`${nestedEscapedTemplate}\`, ${nestedBindingsCode}),`,
          );
        }
      }
      for (const nestedWe of nestedWE) {
        const nestedThenWithId = injectIdIntoFirstElement(nestedWe.thenTemplate, nestedWe.thenId);
        const nestedElseWithId = injectIdIntoFirstElement(nestedWe.elseTemplate, nestedWe.elseId);
        const nestedThenTemplate = escapeTemplateLiteral(nestedThenWithId);
        const nestedElseTemplate = escapeTemplateLiteral(nestedElseWithId);
        const thenInitCode = generateNestedInitializer(
          nestedWe.thenBindings,
          nestedWe.nestedConditionals.filter(
            (c) => nestedWe.thenBindings.some((b) => b.conditionalId === c.id) || true,
          ),
          nestedWe.nestedWhenElse,
          nestedWe.thenRepeats,
          undefined,
          nestedWe.thenEventBindings ?? [],
        );
        const elseInitCode = generateNestedInitializer(
          nestedWe.elseBindings,
          [],
          [],
          nestedWe.elseRepeats,
          undefined,
          nestedWe.elseEventBindings ?? [],
        );
        const signalsArray = nestedWe.signalNames.map((s) => ap.signal(s)).join(', ');
        initLines.push(
          `        ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${nestedWe.jsExpression}, '${nestedWe.thenId}', \`${nestedThenTemplate}\`, ${thenInitCode}),`,
        );
        initLines.push(
          `        ${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => !(${nestedWe.jsExpression}), '${nestedWe.elseId}', \`${nestedElseTemplate}\`, ${elseInitCode}),`,
        );
      }

      for (const cleanupVar of nestedRepeatCleanupVars) {
        initLines.push(`        ${cleanupVar},`);
      }

      initLines.push('      ];');
      initLines.push('    }');
      return initLines.join('\n');
    };
    const thenCode = generateNestedInitializer(
      we.thenBindings,
      we.nestedConditionals,
      we.nestedWhenElse,
      we.thenRepeats,
      we.thenId,
      we.thenEventBindings ?? [],
    );
    const elseCode = generateNestedInitializer(
      we.elseBindings,
      [],
      [],
      we.elseRepeats,
      we.elseId,
      we.elseEventBindings ?? [],
    );

    const signalsArray = we.signalNames.map((s) => ap.signal(s)).join(', ');
    lines.push(
      `    _subs.push(${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => ${we.jsExpression}, '${we.thenId}', \`${escapedThenTemplate}\`, ${thenCode}));`,
    );
    lines.push(
      `    _subs.push(${BIND_FN.IF_EXPR}(r, [${signalsArray}], () => !(${we.jsExpression}), '${we.elseId}', \`${escapedElseTemplate}\`, ${elseCode}));`,
    );
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

    {
      // Use optimized template-based approach
      // Collect directive anchor IDs for path computation (Step 14/15)
      const directiveAnchorIds: string[] = [
        ...rep.nestedConditionals.map((c) => c.id),
        ...rep.nestedWhenElse.flatMap((we) => [we.thenId, we.elseId]),
        ...rep.nestedRepeats.map((nr) => nr.id),
      ];
      const staticInfo = generateStaticRepeatTemplate(
        rep.itemTemplate,
        rep.itemBindings,
        rep.itemVar,
        rep.itemEvents,
        rep.signalBindings,
        directiveAnchorIds.length > 0 ? directiveAnchorIds : undefined,
      );

      const hasCommentBindings = rep.itemBindings.some(
        (b) => b.type === 'text' && b.textBindingMode === 'commentMarker',
      );
      const hasSignalCommentBindings = (staticInfo.signalCommentBindings?.length ?? 0) > 0;
      const hasAnyBindings =
        staticInfo.elementBindings.length > 0 ||
        hasCommentBindings ||
        hasSignalCommentBindings ||
        hasItemEvents ||
        hasNestedConditionals ||
        hasNestedRepeats ||
        rep.nestedWhenElse.length > 0;

      if (staticInfo.canUseOptimized && hasAnyBindings) {
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
        const navExprs: string[] = [];
        for (let i = 0; i < staticInfo.elementBindings.length; i++) {
          const eb = staticInfo.elementBindings[i]!;
          const varName = `_e${i}`;
          navVarNames.push(varName);
          const expr = eb.path.length === 0 ? '_el' : pathToSiblingNav('_el', eb.path);
          navExprs.push(expr);
          navStatements.push(`const ${varName} = ${expr}`);
        }
        // Optimize: reuse earlier navigation variables for shared path prefixes
        // e.g., _e0 = _el.firstElementChild, _e1 = _el.firstElementChild.nextElementSibling.firstElementChild
        // becomes _e1 = _e0.nextElementSibling.firstElementChild (saves one DOM property access per row)
        for (let j = 1; j < navExprs.length; j++) {
          for (let i = j - 1; i >= 0; i--) {
            const prefix = navExprs[i]!;
            if (navExprs[j]!.startsWith(prefix + '.')) {
              const suffix = navExprs[j]!.substring(prefix.length);
              navStatements[j] = `const ${navVarNames[j]} = ${navVarNames[i]}${suffix}`;
              break;
            }
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
              // Sole-content text bindings: textContent is optimal — works on empty elements,
              // no placeholder text node needed, lets templates be aggressively stripped
              fillStatements.push(`${varName}.textContent = ${expr}`);
              updateStatements.push(`${varName}.textContent = ${expr}`);
            } else if (binding.type === 'attr' && binding.property) {
              fillStatements.push(`${varName}.setAttribute('${binding.property}', ${expr})`);
              updateStatements.push(`${varName}.setAttribute('${binding.property}', ${expr})`);
            }
          }
        }

        // Comment-marker item bindings (mixed-content text bindings)
        const commentBindings = rep.itemBindings.filter(
          (b) => b.type === 'text' && b.textBindingMode === 'commentMarker',
        );
        const commentNavStatements: string[] = [];
        const commentFillStatements: string[] = [];
        const commentUpdateStatements: string[] = [];
        if (commentBindings.length > 0) {
          // Scan cloned element for comment markers
          commentNavStatements.push(
            `const _icm = {}; { const _tw = document.createTreeWalker(_el, 128); let _cn; while (_cn = _tw.nextNode()) _icm[_cn.data] = _cn; }`,
          );
          for (const cb of commentBindings) {
            const expr = renameIdentifierInExpression(cb.expression, rep.itemVar, 'item');
            const cmVar = `_icm['${cb.elementId}']`;
            commentFillStatements.push(`if (${cmVar}) ${cmVar}.nextSibling.data = ${expr}`);
            commentUpdateStatements.push(`if (${cmVar}) ${cmVar}.nextSibling.data = ${expr}`);
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
            // Fill + subscription (only attr/style — text bindings use signalCommentBindings)
            const signalRef = ap.signal(sb.signalName);
            const signalCall = ap.signalCall(sb.signalName);
            if (sb.type === 'attr' && sb.property) {
              signalFillStatements.push(`${varName}.setAttribute('${sb.property}', ${signalCall})`);
              signalSubscriptions.push(
                `_cleanups.push(${signalRef}.subscribe(() => { ${varName}.setAttribute('${sb.property}', ${signalCall}); }, true))`,
              );
            } else if (sb.type === 'style' && sb.property) {
              signalFillStatements.push(`${varName}.style.setProperty('${sb.property}', ${signalCall})`);
              signalSubscriptions.push(
                `_cleanups.push(${signalRef}.subscribe(() => { ${varName}.style.setProperty('${sb.property}', ${signalCall}); }, true))`,
              );
            }
          }
        }

        // Signal text bindings via comment markers (Step 13b)
        if (staticInfo.signalCommentBindings && staticInfo.signalCommentBindings.length > 0) {
          // Ensure comment marker TreeWalker is emitted (share _icm with item comment bindings)
          if (commentNavStatements.length === 0) {
            commentNavStatements.push(
              `const _icm = {}; { const _tw = document.createTreeWalker(_el, 128); let _cn; while (_cn = _tw.nextNode()) _icm[_cn.data] = _cn; }`,
            );
          }
          for (const scb of staticInfo.signalCommentBindings) {
            const signalRef = ap.signal(scb.signalName);
            const signalCall = ap.signalCall(scb.signalName);
            const cmVar = `_icm['${scb.commentId}']`;
            signalFillStatements.push(`if (${cmVar}) ${cmVar}.nextSibling.data = ${signalCall}`);
            signalSubscriptions.push(
              `_cleanups.push(${signalRef}.subscribe(() => { if (${cmVar}) ${cmVar}.nextSibling.data = ${signalCall}; }, true))`,
            );
          }
        }

        // Mixed signal+item binding navigation, fill, subscription & update (Step 13c)
        const mixedNavStatements: string[] = [];
        const mixedFillStatements: string[] = [];
        const mixedUpdateStatements: string[] = [];
        if (staticInfo.mixedSignalItemBindings && staticInfo.mixedSignalItemBindings.length > 0) {
          for (let i = 0; i < staticInfo.mixedSignalItemBindings.length; i++) {
            const mb = staticInfo.mixedSignalItemBindings[i]!;
            const varName = `_m${i}`;
            // Navigation — check if an existing nav var points to the same path
            const pathKey = JSON.stringify(mb.path);
            let reuseVar: string | undefined;
            for (let j = 0; j < staticInfo.elementBindings.length; j++) {
              if (JSON.stringify(staticInfo.elementBindings[j]!.path) === pathKey) {
                reuseVar = navVarNames[j];
                break;
              }
            }
            if (reuseVar) {
              mixedNavStatements.push(`const ${varName} = ${reuseVar}`);
            } else if (mb.path.length === 0) {
              mixedNavStatements.push(`const ${varName} = _el`);
            } else {
              mixedNavStatements.push(`const ${varName} = ${pathToSiblingNav('_el', mb.path)}`);
            }
            const expr = renameIdentifierInExpression(mb.expression, rep.itemVar, 'item');
            // Fill
            if (mb.type === 'attr' && mb.property) {
              mixedFillStatements.push(`${varName}.setAttribute('${mb.property}', ${expr})`);
              mixedUpdateStatements.push(`${varName}.setAttribute('${mb.property}', ${expr})`);
            } else if (mb.type === 'text') {
              mixedFillStatements.push(`${varName}.textContent = ${expr}`);
              mixedUpdateStatements.push(`${varName}.textContent = ${expr}`);
            } else if (mb.type === 'style' && mb.property) {
              mixedFillStatements.push(`${varName}.style.setProperty('${mb.property}', ${expr})`);
              mixedUpdateStatements.push(`${varName}.style.setProperty('${mb.property}', ${expr})`);
            }
            // Per-item subscription: re-evaluate full expression when outer signal changes.
            // 'item' is captured in the createItem closure — correct per-row value.
            for (const sigName of mb.outerSignalNames) {
              const signalRef = ap.signal(sigName);
              if (mb.type === 'attr' && mb.property) {
                signalSubscriptions.push(
                  `_cleanups.push(${signalRef}.subscribe(() => { ${varName}.setAttribute('${mb.property}', ${expr}); }, true))`,
                );
              } else if (mb.type === 'text') {
                signalSubscriptions.push(
                  `_cleanups.push(${signalRef}.subscribe(() => { ${varName}.textContent = ${expr}; }, true))`,
                );
              } else if (mb.type === 'style' && mb.property) {
                signalSubscriptions.push(
                  `_cleanups.push(${signalRef}.subscribe(() => { ${varName}.style.setProperty('${mb.property}', ${expr}); }, true))`,
                );
              }
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
        const { delegatedByType: delegatedEventsByType, nonDelegatable: nonDelegatableEvents } = hasItemEvents
          ? partitionItemEvents(rep.itemEvents, staticInfo.eventElementPaths, rep, indexVar)
          : { delegatedByType: new Map<string, DelegatedEvent[]>(), nonDelegatable: [] as ItemEventBinding[] };

        // Build delegated listener code (emitted AFTER reconciler creation)
        const delegatedListenerStatements = buildDelegatedListenerStatements(delegatedEventsByType, containerVar);

        // Handle non-delegatable events (e.g., .self modifier) with per-item listeners
        const { navStatements: eventNavStatements, addStatements: eventAddStatements } =
          buildNonDelegatableEventStatements(
            nonDelegatableEvents,
            staticInfo.eventElementPaths,
            staticInfo.elementBindings,
            navVarNames,
            rep,
            indexVar,
          );

        // Determine if we need to store item data on the element for delegation
        const useDelegation = delegatedEventsByType.size > 0;

        // Always use createKeyedReconciler — when no trackBy, inject (_, i) => i
        const _keyProp = rep.trackByFn ? extractKeyProperty(rep.trackByFn) : null;
        const keyFnExpr = _keyProp ? `'${_keyProp}'` : rep.trackByFn || '(_, i) => i';

        const repMountInfo = generateMountInfo(rep.id, '        ', {
          itemVar: rep.itemVar,
          indexVar: rep.indexVar || '_idx',
        });
        const hasRepMounts = repMountInfo.setupLines.length > 0;
        const hasSignalSubs = signalSubscriptions.length > 0;
        const needsCleanups =
          hasSignalSubs || hasNestedConditionals || hasNestedRepeats || rep.nestedWhenElse.length > 0 || hasRepMounts;

        const updateParts = [...updateStatements, ...commentUpdateStatements, ...mixedUpdateStatements];
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
        for (const navStmt of commentNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        for (const navStmt of signalNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        for (const navStmt of eventNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        for (const navStmt of mixedNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        lines.push(`        ${fillStatements.join('; ')};`);
        if (commentFillStatements.length > 0) {
          lines.push(`        ${commentFillStatements.join('; ')};`);
        }
        if (signalFillStatements.length > 0) {
          lines.push(`        ${signalFillStatements.join('; ')};`);
        }
        if (mixedFillStatements.length > 0) {
          lines.push(`        ${mixedFillStatements.join('; ')};`);
        }
        if (eventAddStatements.length > 0) {
          lines.push(`        ${eventAddStatements.join('; ')};`);
        }
        lines.push(`        ${ap.staticPrefix}_insertBefore.call(${containerVar}, _el, _ref);`);
        for (const sl of repMountInfo.setupLines) {
          lines.push(sl);
        }
        if (needsCleanups) {
          lines.push(`        const _cleanups = [];`);
          for (const ce of repMountInfo.cleanupExprs) {
            lines.push(`        _cleanups.push(${ce});`);
          }
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
          const condTemplate = escapeTemplateLiteral(cond.templateContent);
          const condInitNested = generateRepeatNestedCondInitFn(
            cond.nestedBindings,
            cond.nestedItemBindings,
            cond.nestedEventBindings,
            rep.itemVar,
            ap,
          );
          const isSimpleExpr = cond.signalNames.length === 1 && cond.jsExpression === ap.signalCall(cond.signalName);
          if (isSimpleExpr) {
            lines.push(
              `        _cleanups.push(${BIND_FN.IF}(r, ${ap.signal(cond.signalName)}, '${cond.id}', \`${condTemplate}\`, ${condInitNested}, _cond_${cond.id}));`,
            );
          } else {
            const condSignals = cond.signalNames.map((s) => ap.signal(s)).join(', ');
            lines.push(
              `        _cleanups.push(${BIND_FN.IF_EXPR}(r, [${condSignals}], () => ${cond.jsExpression}, '${cond.id}', \`${condTemplate}\`, ${condInitNested}, _cond_${cond.id}));`,
            );
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
          const escapedThen = escapeTemplateLiteral(thenTplWithId);
          const escapedElse = escapeTemplateLiteral(elseTplWithId);
          const thenInitFn = generateRepeatNestedCondInitFn(we.thenBindings, [], [], rep.itemVar, ap);
          const elseInitFn = generateRepeatNestedCondInitFn(we.elseBindings, [], [], rep.itemVar, ap);
          const weSignals = we.signalNames.map((s) => ap.signal(s)).join(', ');
          lines.push(
            `        _cleanups.push(${BIND_FN.IF_EXPR}(r, [${weSignals}], () => ${we.jsExpression}, '${we.thenId}', \`${escapedThen}\`, ${thenInitFn}, _cond_${we.thenId}));`,
          );
          lines.push(
            `        _cleanups.push(${BIND_FN.IF_EXPR}(r, [${weSignals}], () => !(${we.jsExpression}), '${we.elseId}', \`${escapedElse}\`, ${elseInitFn}, _cond_${we.elseId}));`,
          );
        }
        // Nested repeat codegen (Step 15)
        for (const nr of rep.nestedRepeats) {
          const nrAnchorPath = staticInfo.directiveAnchorPaths?.get(nr.id);
          if (!nrAnchorPath) continue;
          const nrNavExpr = pathToSiblingNav('_el', nrAnchorPath);
          lines.push(`        const _nrA_${nr.id} = ${nrNavExpr};`);
          lines.push(`        const _nrC_${nr.id} = _nrA_${nr.id}.parentNode;`);
          // Generate inner static template
          const innerStaticInfo = generateStaticRepeatTemplate(
            nr.itemTemplate,
            nr.itemBindings,
            nr.itemVar,
            nr.itemEvents,
            nr.signalBindings,
          );
          const innerTplId = `__tpl_${nr.id}`;
          if (innerStaticInfo.canUseOptimized) {
            const innerEscaped = (
              innerStaticInfo.staticHtml ||
              nr.itemTemplate.replace(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, '').replace(/\s*id="[ib]\d+"/g, '')
            )
              .replace(/\\/g, '\\\\')
              .replace(/`/g, '\\`')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r');
            staticTemplates.push(`  const ${innerTplId} = _T(\`${innerEscaped}\`);`);
          } else {
            const fallbackHtml = normalizeHtmlWhitespace(
              nr.itemTemplate.replace(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, '').replace(/\s*id="[ib]\d+"/g, ''),
            );
            const innerEscaped = fallbackHtml
              .replace(/\\/g, '\\\\')
              .replace(/`/g, '\\`')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r');
            staticTemplates.push(`  const ${innerTplId} = _T(\`${innerEscaped}\`);`);
          }
          const innerIndexVar = nr.indexVar || '_idx';
          const _innerKeyProp = nr.trackByFn ? extractKeyProperty(nr.trackByFn) : null;
          const innerKeyFn = _innerKeyProp ? `'${_innerKeyProp}'` : nr.trackByFn || '(_, i) => i';
          lines.push(`        const _nrTc_${nr.id} = ${ap.staticPrefix}${innerTplId}.content.firstElementChild;`);
          lines.push(`        const _nrRc_${nr.id} = ${BIND_FN.KEYED_RECONCILER}(_nrC_${nr.id}, _nrA_${nr.id},`);
          lines.push(`          (_nrItem, ${innerIndexVar}, _nrRef) => {`);
          lines.push(`            const _nrEl = ${ap.staticPrefix}_cloneNode.call(_nrTc_${nr.id}, true);`);
          // Inner item bindings fill & navigation (element-based)
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
          // Inner comment-marker item bindings (mixed-content text bindings)
          const innerCommentBindings = nr.itemBindings.filter(
            (b) => b.type === 'text' && b.textBindingMode === 'commentMarker',
          );
          const innerCommentNavStatements: string[] = [];
          const innerCommentFillStatements: string[] = [];
          const innerCommentUpdateStatements: string[] = [];
          if (innerCommentBindings.length > 0) {
            innerCommentNavStatements.push(
              `const _nricm = {}; { const _tw = document.createTreeWalker(_nrEl, 128); let _cn; while (_cn = _tw.nextNode()) _nricm[_cn.data] = _cn; }`,
            );
            for (const cb of innerCommentBindings) {
              const expr = renameIdentifierInExpression(cb.expression, nr.itemVar, '_nrItem');
              const cmVar = `_nricm['${cb.elementId}']`;
              innerCommentFillStatements.push(`if (${cmVar}) ${cmVar}.nextSibling.data = ${expr}`);
              innerCommentUpdateStatements.push(`if (${cmVar}) ${cmVar}.nextSibling.data = ${expr}`);
            }
          }
          for (const navStmt of innerCommentNavStatements) {
            lines.push(`            ${navStmt};`);
          }
          if (innerCommentFillStatements.length > 0) {
            lines.push(`            ${innerCommentFillStatements.join('; ')};`);
          }
          lines.push(`            ${ap.staticPrefix}_insertBefore.call(_nrC_${nr.id}, _nrEl, _nrRef);`);
          // Inner signal bindings navigation, fill & subscription (Step 13 for nested repeats)
          const innerSignalNavStatements: string[] = [];
          const innerSignalFillStatements: string[] = [];
          const innerSignalSubscriptions: string[] = [];
          if (innerStaticInfo.signalElementBindings && innerStaticInfo.signalElementBindings.length > 0) {
            for (let si = 0; si < innerStaticInfo.signalElementBindings.length; si++) {
              const sb = innerStaticInfo.signalElementBindings[si]!;
              const varName = `_nrs${si}`;
              if (sb.path.length === 0) {
                innerSignalNavStatements.push(`const ${varName} = _nrEl`);
              } else {
                innerSignalNavStatements.push(`const ${varName} = ${pathToSiblingNav('_nrEl', sb.path)}`);
              }
              const signalRef = ap.signal(sb.signalName);
              const signalCall = ap.signalCall(sb.signalName);
              // Only attr/style — text bindings use signalCommentBindings
              if (sb.type === 'attr' && sb.property) {
                innerSignalFillStatements.push(`${varName}.setAttribute('${sb.property}', ${signalCall})`);
                innerSignalSubscriptions.push(
                  `_nrCleanups.push(${signalRef}.subscribe(() => { ${varName}.setAttribute('${sb.property}', ${signalCall}); }, true))`,
                );
              } else if (sb.type === 'style' && sb.property) {
                innerSignalFillStatements.push(`${varName}.style.setProperty('${sb.property}', ${signalCall})`);
                innerSignalSubscriptions.push(
                  `_nrCleanups.push(${signalRef}.subscribe(() => { ${varName}.style.setProperty('${sb.property}', ${signalCall}); }, true))`,
                );
              }
            }
          }
          // Inner signal text bindings via comment markers
          if (innerStaticInfo.signalCommentBindings && innerStaticInfo.signalCommentBindings.length > 0) {
            // Share _nricm TreeWalker with item comment bindings if already emitted
            if (innerCommentBindings.length === 0) {
              innerSignalNavStatements.push(
                `const _nricm = {}; { const _tw = document.createTreeWalker(_nrEl, 128); let _cn; while (_cn = _tw.nextNode()) _nricm[_cn.data] = _cn; }`,
              );
            }
            for (const scb of innerStaticInfo.signalCommentBindings) {
              const signalRef = ap.signal(scb.signalName);
              const signalCall = ap.signalCall(scb.signalName);
              const cmVar = `_nricm['${scb.commentId}']`;
              innerSignalFillStatements.push(`if (${cmVar}) ${cmVar}.nextSibling.data = ${signalCall}`);
              innerSignalSubscriptions.push(
                `_nrCleanups.push(${signalRef}.subscribe(() => { if (${cmVar}) ${cmVar}.nextSibling.data = ${signalCall}; }, true))`,
              );
            }
          }
          const hasInnerSignalSubs = innerSignalSubscriptions.length > 0;
          for (const navStmt of innerSignalNavStatements) {
            lines.push(`            ${navStmt};`);
          }
          if (innerSignalFillStatements.length > 0) {
            lines.push(`            ${innerSignalFillStatements.join('; ')};`);
          }
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
          // Add comment-marker update statements
          innerUpdateParts.push(...innerCommentUpdateStatements);
          if (hasInnerSignalSubs) {
            lines.push(`            const _nrCleanups = [];`);
            for (const sub of innerSignalSubscriptions) {
              lines.push(`            ${sub};`);
            }
          }
          lines.push(
            `            return { el: _nrEl, cleanups: ${hasInnerSignalSubs ? '_nrCleanups' : '[]'}, value: _nrItem,`,
          );
          lines.push(
            `              update: (_nrItem) => { ${innerUpdateParts.join('; ')}${innerUpdateParts.length ? ';' : ''} } };`,
          );
          lines.push(`          },`);
          lines.push(`        ${innerKeyFn});`);
          // Subscribe to the signal driving the nested repeat
          const nrSignalRef = ap.signal(nr.signalName);
          // Check if the items expression references the outer item variable
          const nrItemsExpr = renameIdentifierInExpression(nr.itemsExpression, rep.itemVar, 'item');
          lines.push(`        _nrRc_${nr.id}.reconcile(${nrItemsExpr});`);
          // If the nested repeat is driven by a signal, subscribe
          if (nr.signalName) {
            lines.push(
              `        _cleanups.push(${nrSignalRef}.subscribe(() => { _nrRc_${nr.id}.reconcile(${nrItemsExpr}); }, true));`,
            );
          }
          lines.push(`        _cleanups.push(() => { _nrRc_${nr.id}.clearAll(); });`);
        }
        lines.push(`        return { el: _el, cleanups: ${needsCleanups ? '_cleanups' : '[]'}, value: item,`);
        lines.push(`          update: (item) => { ${updateParts.join('; ')}; } };`);
        lines.push(`      },`);
        lines.push(`    ${keyFnExpr});`);

        // Empty template handling (inlined by compiler — not in reconciler)
        const repeatSources = buildRepeatSubscriptionSources(rep, ap);
        lines.push(`    const _items_${rep.id} = () => ${rep.itemsExpression};`);
        if (rep.emptyTemplate) {
          const escapedEmptyTemplate = rep.emptyTemplate.replace(/`/g, '\\`');
          lines.push(`    let _empty_${rep.id};`);
          const emptyVar = `_empty_${rep.id}`;
          lines.push(
            `    const _syncEmpty_${rep.id} = (items) => { items.length ? ${emptyVar}?.remove() : ${containerVar}.insertBefore(${emptyVar} ??= _T(\`${escapedEmptyTemplate}\`).content.firstElementChild, ${anchorVar}); };`,
          );
          lines.push(`    ${reconcilerVar}.reconcile(_items_${rep.id}());`);
          lines.push(`    _syncEmpty_${rep.id}(_items_${rep.id}());`);
          for (let sourceIdx = 0; sourceIdx < repeatSources.length; sourceIdx++) {
            const sourceVar = `_rsrc_${rep.id}_${sourceIdx}`;
            lines.push(`    const ${sourceVar} = ${repeatSources[sourceIdx]};`);
            lines.push(
              `    _subs.push(typeof ${sourceVar}?.subscribe === 'function' ? ${sourceVar}.subscribe(() => { const items = _items_${rep.id}(); ${reconcilerVar}.reconcile(items); _syncEmpty_${rep.id}(items); }, true) : () => {});`,
            );
          }
        } else {
          lines.push(`    ${reconcilerVar}.reconcile(_items_${rep.id}());`);
          for (let sourceIdx = 0; sourceIdx < repeatSources.length; sourceIdx++) {
            const sourceVar = `_rsrc_${rep.id}_${sourceIdx}`;
            lines.push(`    const ${sourceVar} = ${repeatSources[sourceIdx]};`);
            lines.push(
              `    _subs.push(typeof ${sourceVar}?.subscribe === 'function' ? ${sourceVar}.subscribe(() => { ${reconcilerVar}.reconcile(_items_${rep.id}()); }, true) : () => {});`,
            );
          }
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
        const directRepeatComponent = repMounts ? null : parseDirectRepeatComponentTemplate(rep.itemTemplate);
        if (repMounts && staticInfo.staticHtml) {
          for (const { cm } of repMounts) {
            staticInfo.staticHtml = staticInfo.staticHtml.replace(
              '<template></template>',
              `<template id="${cm.anchorId}"></template>`,
            );
          }
        }

        if (directRepeatComponent) {
          const anchorVar = `_a_${rep.id}`;
          const containerVar = `_ct_${rep.id}`;
          const reconcilerVar = `_rc_${rep.id}`;
          const _fbKeyProp = rep.trackByFn ? extractKeyProperty(rep.trackByFn) : null;
          const keyFnArg = _fbKeyProp ? `'${_fbKeyProp}'` : rep.trackByFn || '(_, i) => i';
          let propsExpr = directRepeatComponent.propsExpression;
          propsExpr = renameIdentifierInExpression(propsExpr, rep.itemVar, 'item');
          if (rep.indexVar && rep.indexVar !== indexVar) {
            propsExpr = renameIdentifierInExpression(propsExpr, rep.indexVar, indexVar);
          }

          lines.push(`    const ${anchorVar} = _gid('${rep.id}');`);
          lines.push(`    const ${containerVar} = ${anchorVar}.parentNode;`);
          lines.push(`    const ${reconcilerVar} = ${BIND_FN.KEYED_RECONCILER}(${containerVar}, ${anchorVar},`);
          lines.push(`      (item, ${indexVar}, _ref) => {`);
          lines.push(`        const _el = document.createElement('div');`);
          lines.push(`        ${ap.staticPrefix}_insertBefore.call(${containerVar}, _el, _ref);`);
          lines.push(
            `        return { el: _el, cleanups: [${BIND_FN.DESTROY_CHILD}(${directRepeatComponent.componentName}.__f(_el, ${propsExpr}))], value: item, update: () => {} };`,
          );
          lines.push(`      },`);
          lines.push(`    ${keyFnArg});`);

          const repeatSources = buildRepeatSubscriptionSources(rep, ap);
          lines.push(`    const _items_${rep.id} = () => ${rep.itemsExpression};`);
          if (rep.emptyTemplate) {
            const escapedEmptyTemplate = rep.emptyTemplate.replace(/`/g, '\\`');
            lines.push(`    let _empty_${rep.id};`);
            const emptyVar = `_empty_${rep.id}`;
            lines.push(
              `    const _syncEmpty_${rep.id} = (items) => { items.length ? ${emptyVar}?.remove() : ${containerVar}.insertBefore(${emptyVar} ??= _T(\`${escapedEmptyTemplate}\`).content.firstElementChild, ${anchorVar}); };`,
            );
            lines.push(`    ${reconcilerVar}.reconcile(_items_${rep.id}());`);
            lines.push(`    _syncEmpty_${rep.id}(_items_${rep.id}());`);
            for (let sourceIdx = 0; sourceIdx < repeatSources.length; sourceIdx++) {
              const sourceVar = `_rsrc_${rep.id}_${sourceIdx}`;
              lines.push(`    const ${sourceVar} = ${repeatSources[sourceIdx]};`);
              lines.push(
                `    _subs.push(typeof ${sourceVar}?.subscribe === 'function' ? ${sourceVar}.subscribe(() => { const items = _items_${rep.id}(); ${reconcilerVar}.reconcile(items); _syncEmpty_${rep.id}(items); }, true) : () => {});`,
              );
            }
          } else {
            lines.push(`    ${reconcilerVar}.reconcile(_items_${rep.id}());`);
            for (let sourceIdx = 0; sourceIdx < repeatSources.length; sourceIdx++) {
              const sourceVar = `_rsrc_${rep.id}_${sourceIdx}`;
              lines.push(`    const ${sourceVar} = ${repeatSources[sourceIdx]};`);
              lines.push(
                `    _subs.push(typeof ${sourceVar}?.subscribe === 'function' ? ${sourceVar}.subscribe(() => { ${reconcilerVar}.reconcile(_items_${rep.id}()); }, true) : () => {});`,
              );
            }
          }

          continue;
        }

        // Use raw item template if static generation failed
        let templateHtml = staticInfo.staticHtml || rep.itemTemplate;
        // Strip remaining ${...} expressions and inline IDs for clean static template
        if (!staticInfo.staticHtml) {
          templateHtml = templateHtml.replace(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g, '');
          templateHtml = templateHtml.replace(/\s*id="[ib]\d+"/g, '');
          templateHtml = normalizeHtmlWhitespace(templateHtml);
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

        const _fbKeyProp = rep.trackByFn ? extractKeyProperty(rep.trackByFn) : null;
        let keyFnArg = _fbKeyProp ? `'${_fbKeyProp}'` : rep.trackByFn || '(_, i) => i';

        lines.push(`    const ${reconcilerVar} = ${BIND_FN.KEYED_RECONCILER}(${containerVar}, ${anchorVar},`);
        lines.push(`      (item, ${indexVar}, _ref) => {`);
        lines.push(`        const _el = ${ap.staticPrefix}_cloneNode.call(${tplContentVar}, true);`);
        lines.push(`        ${ap.staticPrefix}_insertBefore.call(${containerVar}, _el, _ref);`);
        // Child component mounts inside repeat items (Step 7 + Step 10)
        const fbRepMountInfo = generateMountInfo(rep.id, '        ', {
          itemVar: rep.itemVar,
          indexVar: rep.indexVar || '_idx',
        });
        for (const sl of fbRepMountInfo.setupLines) {
          lines.push(sl);
        }
        if (fbRepMountInfo.cleanupExprs.length > 0) {
          lines.push(
            `        return { el: _el, cleanups: [${fbRepMountInfo.cleanupExprs.join(', ')}], value: item, update: () => {} };`,
          );
        } else {
          lines.push(`        return { el: _el, cleanups: [], value: item, update: () => {} };`);
        }
        lines.push(`      },`);
        lines.push(`    ${keyFnArg});`);

        // Empty template handling (inlined)
        const repeatSources = buildRepeatSubscriptionSources(rep, ap);
        lines.push(`    const _items_${rep.id} = () => ${rep.itemsExpression};`);
        if (rep.emptyTemplate) {
          const escapedEmptyTemplate = rep.emptyTemplate.replace(/`/g, '\\`');
          lines.push(`    let _empty_${rep.id};`);
          const emptyVar = `_empty_${rep.id}`;
          lines.push(
            `    const _syncEmpty_${rep.id} = (items) => { items.length ? ${emptyVar}?.remove() : ${containerVar}.insertBefore(${emptyVar} ??= _T(\`${escapedEmptyTemplate}\`).content.firstElementChild, ${anchorVar}); };`,
          );
          lines.push(`    ${reconcilerVar}.reconcile(_items_${rep.id}());`);
          lines.push(`    _syncEmpty_${rep.id}(_items_${rep.id}());`);
          for (let sourceIdx = 0; sourceIdx < repeatSources.length; sourceIdx++) {
            const sourceVar = `_rsrc_${rep.id}_${sourceIdx}`;
            lines.push(`    const ${sourceVar} = ${repeatSources[sourceIdx]};`);
            lines.push(
              `    _subs.push(typeof ${sourceVar}?.subscribe === 'function' ? ${sourceVar}.subscribe(() => { const items = _items_${rep.id}(); ${reconcilerVar}.reconcile(items); _syncEmpty_${rep.id}(items); }, true) : () => {});`,
            );
          }
        } else {
          lines.push(`    ${reconcilerVar}.reconcile(_items_${rep.id}());`);
          for (let sourceIdx = 0; sourceIdx < repeatSources.length; sourceIdx++) {
            const sourceVar = `_rsrc_${rep.id}_${sourceIdx}`;
            lines.push(`    const ${sourceVar} = ${repeatSources[sourceIdx]};`);
            lines.push(
              `    _subs.push(typeof ${sourceVar}?.subscribe === 'function' ? ${sourceVar}.subscribe(() => { ${reconcilerVar}.reconcile(_items_${rep.id}()); }, true) : () => {});`,
            );
          }
        }

        continue;
      } else if (staticInfo.skipReason) {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        logger.warn(
          NAME,
          `repeat() in ${fileName}: ${getOptimizationSkipMessage(staticInfo.skipReason)} — using safe fallback renderer.`,
        );

        const indexVarName = rep.indexVar || '_idx';
        const anchorVar = `_a_${rep.id}`;
        const containerVar = `_ct_${rep.id}`;
        const startVar = `_rs_${rep.id}`;
        const renderItemVar = `_ri_${rep.id}`;
        const renderVar = `_rr_${rep.id}`;
        const emptyFlagVar = `_hasEmpty_${rep.id}`;
        const sourceTemplate = rep.itemTemplate.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
        const itemSignalAccessorDecl = ` const ${rep.itemVar}$ = () => item;`;
        const itemAliasDecl = rep.itemVar === 'item' ? '' : ` const ${rep.itemVar} = item;`;
        const emptyTemplate = escapeRawTemplateLiteral(rep.emptyTemplate || '');

        lines.push(`    const ${anchorVar} = _gid('${rep.id}');`);
        lines.push(`    const ${containerVar} = ${anchorVar}.parentNode;`);
        lines.push(`    const ${startVar} = document.createComment('r:${rep.id}');`);
        lines.push(`    ${containerVar}.insertBefore(${startVar}, ${anchorVar});`);
        lines.push(
          `    const ${renderItemVar} = (item, ${indexVarName}) => {${itemSignalAccessorDecl}${itemAliasDecl} return \`${sourceTemplate}\`; };`,
        );
        if (rep.emptyTemplate) {
          lines.push(`    let ${emptyFlagVar} = false;`);
        }
        lines.push(`    const ${renderVar} = (items) => {`);
        lines.push(`      let _n = ${startVar}.nextSibling;`);
        lines.push(
          `      while (_n && _n !== ${anchorVar}) { const _next = _n.nextSibling; _n.remove(); _n = _next; }`,
        );
        lines.push(`      if (!items || items.length === 0) {`);
        if (rep.emptyTemplate) {
          lines.push(`        if (!${emptyFlagVar}) {`);
          lines.push(`          const _et = _T(\`${emptyTemplate}\`).content;`);
          lines.push(`          while (_et.firstChild) ${containerVar}.insertBefore(_et.firstChild, ${anchorVar});`);
          lines.push(`          ${emptyFlagVar} = true;`);
          lines.push('        }');
        }
        lines.push('        return;');
        lines.push('      }');
        if (rep.emptyTemplate) {
          lines.push(`      ${emptyFlagVar} = false;`);
        }
        lines.push('      for (let i = 0; i < items.length; i++) {');
        lines.push('        const item = items[i];');
        lines.push("        const _t = document.createElement('template');");
        lines.push(`        _t.innerHTML = ${renderItemVar}(item, i);`);
        lines.push('        const _f = _t.content;');
        lines.push(`        while (_f.firstChild) ${containerVar}.insertBefore(_f.firstChild, ${anchorVar});`);
        lines.push('      }');
        lines.push('    };');
        lines.push(`    ${renderVar}(${ap.signal(rep.signalName)}());`);
        lines.push(
          `    _subs.push(${ap.signal(rep.signalName)}.subscribe((items) => { ${renderVar}(items); }, true));`,
        );

        const fallbackSignals = [
          ...new Set(rep.signalBindings.map((s) => s.signalName).filter((s) => !!s && s !== rep.signalName)),
        ];
        for (const sig of fallbackSignals) {
          lines.push(
            `    _subs.push(${ap.signal(sig)}.subscribe(() => { ${renderVar}(${ap.signal(rep.signalName)}()); }, true));`,
          );
        }
        continue;
      }
    }

    // Fallback path deleted (Step 17) — all repeats must use the optimized path.
    // If we reach here, it means the repeat has features not yet handled by the
    // optimized path.
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    logger.warn(NAME, `repeat() in ${fileName} cannot use optimized codegen — using safe fallback renderer.`);
    const indexVarName = rep.indexVar || '_idx';
    const anchorVar = `_a_${rep.id}`;
    const containerVar = `_ct_${rep.id}`;
    const startVar = `_rs_${rep.id}`;
    const renderItemVar = `_ri_${rep.id}`;
    const renderVar = `_rr_${rep.id}`;
    const emptyFlagVar = `_hasEmpty_${rep.id}`;
    const sourceTemplate = rep.itemTemplate.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    const itemSignalAccessorDecl = ` const ${rep.itemVar}$ = () => item;`;
    const itemAliasDecl = rep.itemVar === 'item' ? '' : ` const ${rep.itemVar} = item;`;
    const emptyTemplate = escapeRawTemplateLiteral(rep.emptyTemplate || '');

    lines.push(`    const ${anchorVar} = _gid('${rep.id}');`);
    lines.push(`    const ${containerVar} = ${anchorVar}.parentNode;`);
    lines.push(`    const ${startVar} = document.createComment('r:${rep.id}');`);
    lines.push(`    ${containerVar}.insertBefore(${startVar}, ${anchorVar});`);
    lines.push(
      `    const ${renderItemVar} = (item, ${indexVarName}) => {${itemSignalAccessorDecl}${itemAliasDecl} return \`${sourceTemplate}\`; };`,
    );
    if (rep.emptyTemplate) {
      lines.push(`    let ${emptyFlagVar} = false;`);
    }
    lines.push(`    const ${renderVar} = (items) => {`);
    lines.push(`      let _n = ${startVar}.nextSibling;`);
    lines.push(`      while (_n && _n !== ${anchorVar}) { const _next = _n.nextSibling; _n.remove(); _n = _next; }`);
    lines.push(`      if (!items || items.length === 0) {`);
    if (rep.emptyTemplate) {
      lines.push(`        if (!${emptyFlagVar}) {`);
      lines.push(`          const _et = _T(\`${emptyTemplate}\`).content;`);
      lines.push(`          while (_et.firstChild) ${containerVar}.insertBefore(_et.firstChild, ${anchorVar});`);
      lines.push(`          ${emptyFlagVar} = true;`);
      lines.push('        }');
    }
    lines.push('        return;');
    lines.push('      }');
    if (rep.emptyTemplate) {
      lines.push(`      ${emptyFlagVar} = false;`);
    }
    lines.push('      for (let i = 0; i < items.length; i++) {');
    lines.push('        const item = items[i];');
    lines.push("        const _t = document.createElement('template');");
    lines.push(`        _t.innerHTML = ${renderItemVar}(item, i);`);
    lines.push('        const _f = _t.content;');
    lines.push(`        while (_f.firstChild) ${containerVar}.insertBefore(_f.firstChild, ${anchorVar});`);
    lines.push('      }');
    lines.push('    };');
    lines.push(`    ${renderVar}(${ap.signal(rep.signalName)}());`);
    lines.push(`    _subs.push(${ap.signal(rep.signalName)}.subscribe((items) => { ${renderVar}(items); }, true));`);
    const fallbackSignals = [
      ...new Set(rep.signalBindings.map((s) => s.signalName).filter((s) => !!s && s !== rep.signalName)),
    ];
    for (const sig of fallbackSignals) {
      lines.push(
        `    _subs.push(${ap.signal(sig)}.subscribe(() => { ${renderVar}(${ap.signal(rep.signalName)}()); }, true));`,
      );
    }
  }
  if (eventBindings.length > 0) {
    // Generate direct addEventListener calls (skip conditional-bound events here)
    const topLevelEvents = eventBindings.filter((evt) => !conditionalEventIds.has(evt.id));
    const eventLines = buildEventListenerStatements(topLevelEvents, 'r');
    for (const line of eventLines) {
      lines.push(`    ${line}`);
    }
  }

  // Return cleanup function that unsubscribes all top-level subscriptions
  lines.push(`    return () => { for (let i = 0; i < _subs.length; i++) _subs[i](); };`);
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
 * Generate updated import statements — splits user-facing imports (from 'thane')
 * and compiler-internal imports (from 'thane/runtime') into two separate lines.
 *
 * This keeps the public API surface clean: `import { signal } from 'thane'`
 * never shows __registerComponent or __bindIf in IDE autocomplete.
 */
export const generateUpdatedImport = (importInfo: ImportInfo, requiredBindFunctions: string[]): string => {
  const q = importInfo.quoteChar;
  const userImports = importInfo.namedImports;
  const internalImports = requiredBindFunctions;

  // Resolve the internal specifier from the user's module specifier.
  // 'thane' → 'thane/runtime', relative paths stay unchanged (dev/test).
  const spec = importInfo.moduleSpecifier;
  const internalSpec = spec === PUBLIC_RUNTIME_SPECIFIER ? INTERNAL_RUNTIME_SPECIFIER : spec;

  const lines: string[] = [];
  if (userImports.length > 0) {
    lines.push(`import { ${userImports.join(', ')} } from ${q}${spec}${q}`);
  }
  if (internalImports.length > 0) {
    lines.push(`import { ${internalImports.join(', ')} } from ${q}${internalSpec}${q}`);
  }
  return lines.join('\n');
};
