/**
 * Code generation for reactive binding compiler
 *
 * Generates JavaScript code for bindings, subscriptions, static templates,
 * imports, and the body of the component's binding function.
 */

import type {
  ConditionalBlock,
  WhenElseBlock,
  RepeatBlock,
  BindingInfo,
  SimpleBinding,
  EventBinding,
  ItemEventBinding,
  EmitOptions,
  StaticTemplateInfo,
} from './types.js';
import { isExpressionBinding, isSimpleBinding } from './types.js';
import { generateStaticRepeatTemplate } from './repeat-analysis.js';
import { walkDirectives } from './directive-tree.js';
import {
  toCamelCase,
  BIND_FN,
  replaceReferences,
  parseArrowFunction,
  isFunctionExpressionText,
  expressionReferencesIdentifier,
} from '../../utils/index.js';
import { escapeTemplateLiteral } from '../../utils/html-parser/index.js';
import { buildDomModel, cookTemplateText, type DomModel, type DomNode } from './dom-model.js';
import { BOUND_MARK, stripMarks } from './template-utils.js';
import { ErrorCode } from '../../errors.js';
import type { ImportInfo } from '../../types.js';
import type { ChildMountInfo } from '../component-precompiler/component-precompiler.js';
import type { GeneratedInitBindingsArtifact, RuntimeHelperName } from '../../../contracts/index.js';
import {
  DOM_RUNTIME_SPECIFIER,
  INTERNAL_RUNTIME_SPECIFIER,
  PUBLIC_RUNTIME_SPECIFIER,
} from '../../../contracts/index.js';

/**
 * Rows per batch clone for repeat() rows without cleanups: the reconciler clones a fragment of
 * this many rows at once and binds each, instead of one cloneNode and insertBefore per row.
 */
const ROW_BATCH_SIZE = 16;

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

/** The reconciler's key argument: the key property as a string, the trackBy function, or the index. */
const keyArg = (rep: RepeatBlock): string => {
  const keyProp = rep.trackByFn ? extractKeyProperty(rep.trackByFn) : null;
  return keyProp ? `'${keyProp}'` : rep.trackByFn || '(_, i) => i';
};

const _repeatSourceRe = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)\s*$/;

const extractRepeatSourceExpression = (itemsExpression: string): string | null => {
  const match = _repeatSourceRe.exec(itemsExpression.trim());
  return match?.[1] ?? null;
};

const buildRepeatSubscriptionSources = (rep: RepeatBlock): string[] => {
  const directSource = extractRepeatSourceExpression(rep.itemsExpression);
  if (directSource) {
    return [directSource];
  }

  const sources: string[] = [];
  for (const signalName of rep.signalNames) {
    if (!sources.includes(signalName)) {
      sources.push(signalName);
    }
  }

  return sources;
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

/** True when generated statements read `name` as a variable (a property of that name does not count). */
const codeReferences = (statements: string[], name: string): boolean =>
  expressionReferencesIdentifier(`() => {\n${statements.join('\n')}\n}`, name);

// ============================================================================
// Scopes: where compiled code finds the nodes it binds
// ============================================================================

/**
 * How the code of one template reaches the nodes it binds (bound elements and child hosts, text
 * nodes, directive, list and child anchors), without ids and without searching. `at(id, name)` is
 * the expression for the node marked `id`: an element's BOUND_MARK, or an anchor comment's data
 * (`b3(`, `b3.`); `text(id, name)` is the text node after the text marker `id` (`<!--b3-->`). `name`
 * is the variable the caller wants it in. `head` holds the declarations they needed, which the
 * caller emits before any statement that changes the DOM: a path is only valid on the template as
 * it was cloned.
 */
interface NavScope {
  at: (id: string, name: string) => string;
  text: (id: string, name: string) => string;
  head: string[];
}

/** The tree the browser builds of a template as it is emitted (see dom-model.ts). */
const modelOf = (html: string, emit: EmitOptions): DomModel => buildDomModel(cookTemplateText(emit.html(html)));

function* nodesOf(nodes: DomNode[]): Generator<DomNode> {
  for (const n of nodes) {
    yield n;
    yield* nodesOf(n.children);
  }
}

const structureError = (model: DomModel): Error =>
  new Error(
    `${ErrorCode.TEMPLATE_STRUCTURE}: the browser rebuilds this template's markup, so the compiler cannot tell where its bound nodes end up: ${model.problems[0]}.`,
  );

const lostNode = (): Error =>
  new Error(
    `${ErrorCode.PLUGIN_ERROR}: internal compiler error — a bound node's position in its template could not be found. Please report this with the template.`,
  );

/**
 * The node marked `id` in a template's model; its absence is a compiler bug. Ids count from 0 in
 * every file, so a comment the developer wrote in the marker's form (`<!--b0-->`) could be
 * taken for the marker: that is reported instead.
 */
const markedNode = (model: DomModel, id: string): DomNode => {
  if (model.problems.length > 0) throw structureError(model);
  const found = [...nodesOf(model.roots)].filter((n) =>
    n.kind === 'comment' ? n.data === id : n.attrs.get(BOUND_MARK) === id,
  );
  if (found.length > 1) {
    throw new Error(
      `${ErrorCode.TEMPLATE_STRUCTURE}: a comment in this template has the form of the compiler's own markers (<!--${id}-->), so the compiler cannot tell which node it binds: change or remove the comment.`,
    );
  }
  if (!found[0]) throw lostNode();
  return found[0];
};

/** The text node a text binding writes: the one after its marker comment. */
const textAfter = (model: DomModel, marker: DomNode): DomNode => {
  const siblings = marker.parent ? marker.parent.children : model.roots;
  const text = siblings[siblings.indexOf(marker) + 1];
  if (text?.kind !== 'text') throw lostNode();
  return text;
};

/** Where a search starts: a node the code already holds (`node` null: the component root, `r`). */
interface NavSource {
  node: DomNode | null;
  expr: string;
  cost: number;
}

/**
 * The moves from `n` (null: the component root, whose last children are the template's top-level
 * nodes): the node each property reaches. A template's top-level nodes have no siblings or parent
 * outside it. An element target is reached with element steps only, which do not depend on the
 * text nodes around it.
 */
const movesFrom = (model: DomModel, n: DomNode | null, elementsOnly: boolean): [DomNode, string][] => {
  const moves: [DomNode, string][] = [];
  const isElement = (c: DomNode) => c.kind === 'element';
  const kids = n ? n.children : model.roots;
  if (kids.length > 0) {
    const els = kids.filter(isElement);
    if (!elementsOnly) {
      if (n) moves.push([kids[0]!, 'firstChild']);
      moves.push([kids[kids.length - 1]!, 'lastChild']);
    }
    if (els.length > 0) {
      if (n) moves.push([els[0]!, 'firstElementChild']);
      moves.push([els[els.length - 1]!, 'lastElementChild']);
    }
  }
  if (n) {
    const siblings = n.parent ? n.parent.children : model.roots;
    const i = siblings.indexOf(n);
    if (!elementsOnly) {
      if (i + 1 < siblings.length) moves.push([siblings[i + 1]!, 'nextSibling']);
      if (i > 0) moves.push([siblings[i - 1]!, 'previousSibling']);
    }
    const next = siblings.slice(i + 1).find(isElement);
    if (next) moves.push([next, 'nextElementSibling']);
    const previous = siblings.slice(0, i).reverse().find(isElement);
    if (previous) moves.push([previous, 'previousElementSibling']);
    if (n.parent) moves.push([n.parent, 'parentNode']);
  }
  return moves;
};

/** The shortest expression (in characters) that reaches `target` from one of `sources`. */
const shortestPath = (model: DomModel, sources: NavSource[], target: DomNode): string => {
  const elementsOnly = target.kind === 'element';
  const open = [...sources];
  const done = new Set<DomNode | null>();
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.cost < open[best]!.cost) best = i;
    const cur = open.splice(best, 1)[0]!;
    if (cur.node === target) return cur.expr;
    if (done.has(cur.node)) continue;
    done.add(cur.node);
    for (const [next, prop] of movesFrom(model, cur.node, elementsOnly)) {
      if (!done.has(next)) open.push({ node: next, expr: `${cur.expr}.${prop}`, cost: cur.cost + prop.length + 1 });
    }
  }
  throw new Error(
    `${ErrorCode.PLUGIN_ERROR}: internal compiler error — no path to a bound node. Please report this with the template.`,
  );
};

/**
 * A scope over one template. Each target is declared once as `name` (in `head`), from the shortest
 * path out of the scope's sources and the targets declared before it; `direct` can answer without a
 * declaration (the component scope's `_ns[i]` elements).
 */
const createScope = (
  model: DomModel,
  indent: string,
  sources: NavSource[],
  direct?: (node: DomNode) => string | undefined,
): NavScope => {
  const head: string[] = [];
  const known = [...sources];
  const declared = new Set<string>();
  const declare = (node: DomNode, name: string): string => {
    head.push(`${indent}const ${name} = ${shortestPath(model, known, node)};`);
    declared.add(name);
    known.push({ node, expr: name, cost: 2 });
    return name;
  };
  return {
    head,
    at: (id, name) => {
      if (declared.has(name)) return name;
      const node = markedNode(model, id);
      return direct?.(node) ?? declare(node, name);
    },
    text: (id, name) => (declared.has(name) ? name : declare(textAfter(model, markedNode(model, id)), name)),
  };
};

/**
 * The component template's scope. The registration factory hands `__b` the template's elements in
 * document order (`_ns`, listed from the clone before it is inserted), so an element is `_ns[i]`; any
 * other node is reached from one of them, or from the component root's last children (`_r`).
 */
const componentScope = (model: DomModel): NavScope & { used: () => boolean; usesRoot: () => boolean } => {
  let used = false;
  const scope = createScope(
    model,
    '    ',
    [
      ...model.elements.map((el) => ({ node: el, expr: `_ns[${el.order}]`, cost: 5 + String(el.order).length })),
      { node: null, expr: '_r', cost: 2 },
    ],
    (node) => {
      if (node.kind !== 'element') return undefined;
      used = true;
      return `_ns[${node.order}]`;
    },
  );
  return {
    ...scope,
    used: () => used || scope.head.some((line) => line.includes('_ns[')),
    usesRoot: () => scope.head.some((line) => line.includes(' = _r.')),
  };
};

/** A directive branch's scope, reached from the branch's first node (`_c`), which the runtime passes. */
const branchScope = (model: DomModel, indent: string): NavScope =>
  model.roots.length > 0
    ? createScope(model, indent, [{ node: model.roots[0]!, expr: '_c', cost: 2 }])
    : createScope(model, indent, []);

/**
 * The write for a dynamic attribute: through a DOM property when the analysis found one with
 * identical semantics (`class` → `className` on HTML elements), otherwise `setAttribute`.
 */
const attributeWrite = (
  target: string,
  binding: { property?: string | undefined; domProperty?: string | undefined },
  value: string,
): string =>
  binding.domProperty
    ? `${target}.${binding.domProperty} = ${value}`
    : `${target}.setAttribute('${binding.property}', ${value})`;

// ============================================================================
// Redundancy-guarded writes
// ============================================================================

/** A binding's first write and its guarded re-write, sharing one guard variable. */
interface GuardedWrite {
  fill: string;
  update: string;
}

/**
 * Wrap a DOM write in a redundancy guard. The guard variable keeps the last value written
 * for this binding, so a re-evaluation that produces the same value skips the DOM write —
 * a skipped `setAttribute`/`textContent` write is several times cheaper than the write.
 *
 * `fill` is the first write after cloning. When the static template already ships the
 * attribute as the empty string, the first write is skipped for an empty result too.
 *
 * @example guardedWrite('_p0', (v) => `_e0.textContent = ${v}`, 'item.label')
 *   fill:   _e0.textContent = _p0 = item.label
 *   update: if (_p0 !== (_p0 = item.label)) _e0.textContent = _p0
 */
const guardedWrite = (
  guardVar: string,
  write: (value: string) => string,
  expr: string,
  staticValue?: string | undefined,
  updateGuardVar: string = guardVar,
): GuardedWrite => ({
  fill: staticValue === '' ? `if ((${guardVar} = ${expr}) !== '') ${write(guardVar)}` : write(`${guardVar} = ${expr}`),
  update: `if (${updateGuardVar} !== (${updateGuardVar} = ${expr})) ${write(updateGuardVar)}`,
});

/**
 * Where a row-local variable lives once it is kept on the managed record instead of in a
 * per-row closure: `_p0` → `_m.p0`. Used by the shared update function of lean rows.
 */
const recordField = (local: string): string => `_m.${local.slice(1)}`;

/** Allocates guard variable names for one row factory. */
const createGuardAllocator = (prefix: string) => {
  const vars: string[] = [];
  return {
    vars,
    next: (): string => {
      const name = `${prefix}${vars.length}`;
      vars.push(name);
      return name;
    },
    /** `let` declaration for every guard allocated so far, or '' when none. */
    declaration: (): string => (vars.length > 0 ? `let ${vars.join(', ')};` : ''),
  };
};

// ============================================================================
// Selection bindings: one subscription per list instead of one per row
// ============================================================================

/** A row attribute of the form `signal() === item.<key> ? on : off`, resolved to its two values. */
interface SelectionBinding {
  signalName: string;
  onValue: string;
  offValue: string;
}

/** The selection pattern, with `ITEM` standing for the row's item name */
const _selectionRe =
  /^\s*(?:(\w+)\(\)\s*(===|!==)\s*ITEM\.(\w+)|ITEM\.(\w+)\s*(===|!==)\s*(\w+)\(\))\s*\?\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*$/;

/**
 * Recognise a selection binding: `signal() === item.<key> ? 'on' : 'off'` (or `!==`, or the
 * operands swapped) where `item` is the row's item and `<key>` the repeat's trackBy property.
 * Such a value depends only on the row's key and the signal, so the compiler can replace N per-row
 * subscriptions with one subscription on the list that rewrites the two rows whose value changed,
 * found through the reconciler's key map. Anything else keeps the general per-row path.
 */
const matchSelectionBinding = (
  expr: string,
  outerSignalNames: string[],
  keyProp: string | null,
  itemName: string,
): SelectionBinding | null => {
  if (!keyProp || outerSignalNames.length !== 1) return null;
  const m = new RegExp(_selectionRe.source.replaceAll('ITEM', itemName.replace(/\$/g, '\\$'))).exec(expr);
  if (!m) return null;
  const signalName = m[1] ?? m[6]!;
  const op = m[2] ?? m[5]!;
  const prop = m[3] ?? m[4]!;
  if (signalName !== outerSignalNames[0] || prop !== keyProp) return null;
  const first = m[7]!;
  const second = m[8]!;
  return op === '==='
    ? { signalName, onValue: first, offValue: second }
    : { signalName, onValue: second, offValue: first };
};

/**
 * Emit the list-level subscription for a selection binding. It remembers the previously
 * selected key, and on change clears the old row and marks the new one; rows that no longer
 * exist (or keys with no row) are skipped. Rows still compute the value on creation, so a row
 * created while selected starts in the right state. The unsubscribe goes into the list's `cleanups`.
 */
const buildSelectionSubscription = (
  repId: string,
  index: number,
  sel: SelectionBinding,
  path: number[],
  write: (target: string, value: string) => string,
  cleanups: string,
): string => {
  const nav = (managed: string) => (path.length === 0 ? `${managed}.el` : pathToSiblingNav(`${managed}.el`, path));
  const prev = `_sel_${repId}_${index}`;
  const rc = `_rc_${repId}`;
  return (
    `let ${prev} = ${sel.signalName}(); ` +
    `${cleanups}.push(${sel.signalName}.subscribe((_v) => { ` +
    `const _o = ${rc}.get(${prev}); if (_o) ${write(nav('_o'), sel.offValue)}; ` +
    `const _n = ${rc}.get(_v); if (_n) ${write(nav('_n'), sel.onValue)}; ` +
    `${prev} = _v; }, true));`
  );
};

// ============================================================================
// Row item names
// ============================================================================

/**
 * The name a row factory gives the row's item: the source's own, so that an inner list's item shadows
 * an outer one exactly as the source's scoping does. Names that start with `_` are the compiler's own
 * in row code (the event parameter `_e`, `_el`, `_ref`, guards), so such an item is called `_item` there.
 */
const rowItemName = (rep: RepeatBlock): string => (rep.itemVar && !rep.itemVar.startsWith('_') ? rep.itemVar : '_item');

/** A row expression as the row factory reads it: the item under the factory's name for it */
const inRow = (rep: RepeatBlock, expr: string): string =>
  rep.itemVar && rep.itemVar !== rowItemName(rep) ? replaceReferences(expr, rep.itemVar, rowItemName(rep)) : expr;

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
 * Turn a row event attribute's expression into statements for the row listener body, where
 * the event is `_e`. An arrow function is inlined (its parameter declared as `_e`); a function
 * expression or a plain reference is called with the event; any other expression, such as the call
 * `select(item.id)`, runs as written.
 */
const inlineRowHandler = (handlerExpr: string): string => {
  const arrow = parseArrowFunction(handlerExpr);
  if (arrow) {
    const body = arrow.isBlockBody ? arrow.body.slice(1, -1).trim() : arrow.body;
    const param = arrow.params.replace(/^\(|\)$/g, '').trim();
    if (param === '') return body;
    if (/^[A-Za-z_$][\w$]*$/.test(param)) return `{ const ${param} = _e; ${body}; }`;
    return `(${handlerExpr})(_e)`;
  }
  if (isFunctionExpressionText(handlerExpr)) return `(${handlerExpr})(_e)`;
  const trimmed = handlerExpr.trim();
  if (/^[A-Za-z_$][\w$.]*$/.test(trimmed)) return `${trimmed}(_e)`;
  return handlerExpr;
};

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
    handlerExpr = inRow(rep, handlerExpr);
    if (rep.indexVar) {
      handlerExpr = replaceReferences(handlerExpr, rep.indexVar, indexVar);
    }
    handlerExpr = inlineRowHandler(handlerExpr);

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
 * Each listener walks from _e.target up to the item root, reads __d, and dispatches. `captured`
 * names, per event, the row property that holds its element (see emitRepeat): in a row whose
 * when()/whenElse() content comes and goes, an element's position is only known at creation.
 */
const buildDelegatedListenerStatements = (
  delegatedByType: Map<string, DelegatedEvent[]>,
  containerVar: string,
  itemName: string,
  captured?: Map<DelegatedEvent, string>,
): string[] => {
  const statements: string[] = [];

  for (const [eventName, events] of delegatedByType) {
    // Walk up to the row once, remembering the row child the target came through (`_cell`).
    // Each handler first compares that child with its own compiled position, so only the
    // one handler whose subtree the target is in runs a containment check, and only for
    // the part of its path below the cell.
    const finalBody = [
      `let _row = _e.target, _cell = null;`,
      `while (_row && _row.parentNode !== ${containerVar}) { _cell = _row; _row = _row.parentNode; }`,
      `if (!_row || !_row.__d) return;`,
      `const ${itemName} = _row.__d;`,
    ];

    for (const evt of events) {
      const modParts: string[] = [];
      if (evt.modifiers.includes('prevent')) modParts.push('_e.preventDefault()');
      if (evt.modifiers.includes('stop')) modParts.push('_e.stopPropagation()');
      const keyMods = evt.modifiers.filter((m) => m !== 'prevent' && m !== 'stop' && m !== 'self');
      if (keyMods.length > 0) {
        const guard = compileKeyGuard(keyMods);
        if (guard) modParts.push(`if (${guard}) return`);
      }
      const handlerBody = [...modParts, evt.handlerExpr].join('; ');

      const capturedAs = captured?.get(evt);
      if (evt.path.length === 0) {
        finalBody.push(`${handlerBody};`);
      } else if (capturedAs) {
        finalBody.push(`if (_row.${capturedAs}.contains(_e.target)) { ${handlerBody}; return; }`);
      } else {
        const [cellIndex, ...rest] = evt.path;
        const cellExpr = pathToSiblingNav('_row', [cellIndex!]);
        const guard =
          rest.length === 0
            ? `_cell !== null && _cell === ${cellExpr}`
            : `_cell !== null && _cell === ${cellExpr} && ${pathToSiblingNav('_cell', rest)}?.contains(_e.target)`;
        finalBody.push(`if (${guard}) { ${handlerBody}; return; }`);
      }
    }

    statements.push(`${containerVar}.addEventListener('${eventName}', (_e) => { ${finalBody.join(' ')} });`);
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
    handlerExpr = inRow(rep, handlerExpr);
    if (rep.indexVar) {
      handlerExpr = replaceReferences(handlerExpr, rep.indexVar, indexVar);
    }
    handlerExpr = inlineRowHandler(handlerExpr);
    const bodyParts: string[] = [];
    if (evt.modifiers.includes('prevent')) bodyParts.push('_e.preventDefault()');
    if (evt.modifiers.includes('stop')) bodyParts.push('_e.stopPropagation()');
    if (evt.modifiers.includes('self')) bodyParts.push('if (_e.target !== _e.currentTarget) return');
    const keyMods = evt.modifiers.filter((m) => m !== 'prevent' && m !== 'stop' && m !== 'self');
    if (keyMods.length > 0) {
      const guard = compileKeyGuard(keyMods);
      if (guard) bodyParts.push(`if (${guard}) return`);
    }
    bodyParts.push(handlerExpr);
    addStatements.push(`${elVar}.addEventListener('${evt.eventName}', (_e) => { ${bodyParts.join('; ')}; })`);
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
 * @example compileKeyGuard(['enter', 'tab']) => "_e.key !== 'Enter' && _e.key !== 'Tab'"
 */
const compileKeyGuard = (modifiers: string[]): string | null => {
  const checks = modifiers
    .map((mod) => {
      const keys = KEY_MAP[mod];
      if (!keys) return null;
      return keys.length === 1 ? `_e.key !== '${keys[0]}'` : `!${JSON.stringify(keys)}.includes(_e.key)`;
    })
    .filter(Boolean);
  return checks.length > 0 ? checks.join(' && ') : null;
};

/** The variable that holds a bound node in compiled code: `_b3` for the binding id `b3`. */
const nodeVar = (id: string): string => `_${id}`;

/**
 * The DOM write of a simple binding, writing `value`: a camel-cased style property (a custom
 * property, which has no camel-cased name, through setProperty), an attribute, or, for text
 * bindings, the binding's text node (the one after its marker comment).
 */
const simpleWrite = (binding: SimpleBinding, value: string): string => {
  const elRef = nodeVar(binding.id);
  if (binding.type === 'style' && binding.property!.startsWith('--'))
    return `${elRef}.style.setProperty('${binding.property}', ${value})`;
  if (binding.type === 'style') return `${elRef}.style.${toCamelCase(binding.property!)} = ${value}`;
  if (binding.type === 'attr') return attributeWrite(elRef, binding, value);
  return `${elRef}.data = ${value} ?? ''`;
};

/** Generate binding update code for a single simple binding. */
const generateBindingUpdateCode = (binding: SimpleBinding): string => simpleWrite(binding, 'v');

/**
 * The DOM write for an expression binding, as a function of the value expression, keyed on
 * the binding's element/marker variable. Returns undefined for binding kinds with no write.
 */
const expressionWrite = (binding: {
  id: string;
  type: SimpleBinding['type'];
  property?: string | undefined;
  domProperty?: string | undefined;
}): ((value: string) => string) | undefined => {
  const node = nodeVar(binding.id);
  if (binding.type === 'text') return (v) => `${node}.data = (${v}) ?? ''`;
  if (binding.type === 'attr' && binding.property) return (v) => attributeWrite(node, binding, v);
  if (binding.type === 'style' && binding.property)
    return (v) => `${node}.style.setProperty('${binding.property}', ${v})`;
  return undefined;
};

/**
 * Generate initial value assignment code for a simple binding
 */
const generateInitialValueCode = (binding: SimpleBinding): string => simpleWrite(binding, `${binding.signalName}()`);

/**
 * Group simple bindings by their signal name for consolidated subscriptions
 */
const groupBindingsBySignal = (bindings: SimpleBinding[]): Map<string, SimpleBinding[]> => {
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
const generateConsolidatedSubscription = (signalName: string, bindings: SimpleBinding[]): string => {
  if (bindings.length === 1) {
    const update = generateBindingUpdateCode(bindings[0]!);
    return `${signalName}.subscribe(v => { ${update}; }, true)`;
  }
  const updates = bindings.map((b) => `      ${generateBindingUpdateCode(b)};`).join('\n');
  return `${signalName}.subscribe(v => {\n${updates}\n    }, true)`;
};

/**
 * Turn an event attribute's expression into the listener to register. Functions (arrow
 * functions and function expressions) and plain references are passed through (they receive
 * the event); any other expression, such as the call `navigate('/x')`, is wrapped so it runs
 * on the event, not at bind time; modifiers add their guards around the call.
 */
const compileEventHandler = (evt: EventBinding): string => {
  const handlerCode = evt.handlerExpression;
  const hasModifiers = evt.modifiers.length > 0;
  const hasPrevent = evt.modifiers.includes('prevent');
  const hasStop = evt.modifiers.includes('stop');
  const hasSelf = evt.modifiers.includes('self');
  const keyModifiers = evt.modifiers.filter((m) => m !== 'prevent' && m !== 'stop' && m !== 'self');
  const isFunction = isFunctionExpressionText(handlerCode);
  const isSimpleRef = /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(handlerCode.trim());
  const isFnCall = !isFunction && !isSimpleRef;

  if (hasModifiers && (hasPrevent || hasStop || hasSelf || keyModifiers.length > 0)) {
    const bodyParts: string[] = [];
    if (hasSelf) bodyParts.push('if (_e.target !== _e.currentTarget) return;');
    if (keyModifiers.length > 0) {
      const guard = compileKeyGuard(keyModifiers);
      if (guard) bodyParts.push(`if (${guard}) return;`);
    }
    if (hasPrevent) bodyParts.push('_e.preventDefault();');
    if (hasStop) bodyParts.push('_e.stopPropagation();');
    bodyParts.push(isFnCall ? `${handlerCode};` : `(${handlerCode})(_e);`);
    return `(_e) => { ${bodyParts.join(' ')} }`;
  }
  return isFnCall ? `() => { ${handlerCode}; }` : handlerCode;
};

/** A when() condition that is a bare signal read (`show()`): bound by `__bindIf` on the signal itself. */
const isSimpleConditional = (cond: ConditionalBlock): boolean =>
  cond.signalNames.length === 1 && cond.jsExpression === `${cond.signalName}()`;

/**
 * Generate the body of the component's binding function (`__b`) and the static templates.
 * Child components are mounted where their anchor is: the top-level ones by the body itself,
 * the others by the directive that contains them. `helpers` holds every runtime helper the
 * generated code calls, so that the component imports exactly those. For an exported fragment
 * (`fragment`), the body binds a copy of the template that is not in the page yet: it reaches the
 * nodes it binds, then puts the copy in its place (`_ctx.place()`), then binds.
 */
export const generateInitBindingsFunction = (
  bindings: BindingInfo[],
  conditionals: ConditionalBlock[],
  whenElseBlocks: WhenElseBlock[] = [],
  repeatBlocks: RepeatBlock[] = [],
  eventBindings: EventBinding[] = [],
  emit: EmitOptions,
  childMountsByDirective?: Map<string, { cm: ChildMountInfo; globalIndex: number }[]>,
  topLevelChildMounts: { cm: ChildMountInfo; globalIndex: number }[] = [],
  componentTemplate = '',
  childHosts: ReadonlySet<string> = new Set(),
  fragment = false,
): GeneratedInitBindingsArtifact => {
  const lines: string[] = [];
  // The component template's elements, by position
  const top = componentScope(modelOf(componentTemplate, emit));
  const staticTemplates: string[] = []; // Collect static templates for repeat optimizations
  const helpers = new Set<RuntimeHelperName>();
  /** A runtime helper's name, recorded as used where the call to it is emitted. */
  const use = (helper: RuntimeHelperName): RuntimeHelperName => {
    helpers.add(helper);
    return helper;
  };
  // A child's props, as written, in the row factory that mounts it: the factory's parameters have the
  // source's names (rowItemName), so the props read the row's item, and an outer row's, as written.
  const rowProps = (props: string, rep: RepeatBlock | undefined): string => (rep ? inRow(rep, props) : props);

  // A child component, mounted where its placeholder was: into its host element when the host
  // is in the template (see child-hosts.ts), otherwise into a new host that replaces its anchor
  // comment. `setup` holds the statements, `cleanup` the expression that mounts it and returns its
  // destroy function; the host and the anchor are reached through `scope`.
  const mountChild = (
    { cm, globalIndex }: { cm: ChildMountInfo; globalIndex: number },
    indent: string,
    scope: NavScope,
    rep?: RepeatBlock,
  ): { setup: string[]; cleanup: string } => {
    const varName = `_cm${globalIndex}`;
    // An imported fragment: its nodes go before its placeholder
    if (cm.fragment) {
      const anchor = scope.at(`${cm.anchorId}.`, `_cma${globalIndex}`);
      return { setup: [], cleanup: `${use(BIND_FN.MOUNT_FRAGMENT)}(${anchor}, ${cm.componentName})` };
    }
    const props = rowProps(cm.propsExpression, rep);
    const mount = (host: string) => `${use(BIND_FN.DESTROY_CHILD)}(${cm.componentName}.__f(${host}, ${props}))`;
    if (childHosts.has(cm.anchorId)) return { setup: [], cleanup: mount(scope.at(cm.anchorId, varName)) };
    const anchor = scope.at(`${cm.anchorId}.`, `_cma${globalIndex}`);
    return {
      setup: [
        `${indent}const ${varName} = document.createElement('${emit.selector(cm.selector)}');`,
        `${indent}${anchor}.replaceWith(${varName});`,
      ],
      cleanup: mount(varName),
    };
  };
  // The children inside one directive's template (a branch or a row), mounted by its code
  const generateMountInfo = (
    directiveId: string,
    indent: string,
    scope: NavScope,
    rep?: RepeatBlock,
  ): { setupLines: string[]; cleanupExprs: string[] } => {
    const setupLines: string[] = [];
    const cleanupExprs: string[] = [];
    for (const mount of childMountsByDirective?.get(directiveId) ?? []) {
      const { setup, cleanup } = mountChild(mount, indent, scope, rep);
      setupLines.push(...setup);
      cleanupExprs.push(cleanup);
    }
    return { setupLines, cleanupExprs };
  };

  const buildEventListenerStatements = (events: EventBinding[], scope: NavScope): string[] =>
    events.map(
      (evt) =>
        `${scope.at(evt.elementId, nodeVar(evt.elementId))}.addEventListener('${evt.eventName}', ${compileEventHandler(evt)});`,
    );
  // Events inside when() content (and whenElse branches nested in it) are bound by the branch
  // initializer, not at the top level. Row events belong to the row generator.
  const conditionalEventIds = new Set<string>();
  const addEventIds = (events: EventBinding[]) => events.forEach((evt) => conditionalEventIds.add(evt.id));
  walkDirectives(
    { conditionals },
    {
      cond: (cond) => addEventIds(cond.nestedEventBindings),
      whenElse: (we) => addEventIds([...we.thenEventBindings, ...we.elseEventBindings]),
      repeat: () => false,
    },
  );
  // Collect top-level subscription unsubscribe handles for cleanup on destroy
  lines.push(`    const _subs = [];`);

  // The call that binds a when() block between its two anchors (reached through `scope`):
  // `__bindIf` for a bare signal read, otherwise `__bindIfExpr` over every signal the condition
  // reads. The content's initializer is the branch initializer at every level, a row's too.
  // Callers add their wrapper.
  const whenCall = (cond: ConditionalBlock, scope: NavScope): string => {
    const initCode = generateNestedInitializer(
      cond.nestedBindings,
      cond.nestedConditionals,
      cond.nestedWhenElse,
      cond.nestedRepeats,
      cond.id,
      cond.nestedEventBindings,
      cond.templateContent,
    );
    const template = escapeTemplateLiteral(stripMarks(emit.html(cond.templateContent)));
    const range = `${scope.at(`${cond.id}(`, `_ws_${cond.id}`)}, ${scope.at(`${cond.id})`, `_we_${cond.id}`)}`;
    if (isSimpleConditional(cond)) {
      return `${use(BIND_FN.IF)}(${range}, ${cond.signalName}, \`${template}\`, ${initCode})`;
    }
    const signals = cond.signalNames.join(', ');
    return `${use(BIND_FN.IF_EXPR)}(${range}, [${signals}], () => ${cond.jsExpression}, \`${template}\`, ${initCode})`;
  };

  // The two `__bindIfExpr` calls that bind a whenElse() block over its three anchors: the then
  // branch between the first two on the condition, the else branch between the last two on its
  // negation. Callers add their wrapper.
  const whenElseCalls = (we: WhenElseBlock, scope: NavScope): [string, string] => {
    const thenInit = generateNestedInitializer(
      we.thenBindings,
      we.thenConditionals,
      we.thenWhenElse,
      we.thenRepeats,
      we.thenId,
      we.thenEventBindings ?? [],
      we.thenTemplate,
    );
    const elseInit = generateNestedInitializer(
      we.elseBindings,
      we.elseConditionals,
      we.elseWhenElse,
      we.elseRepeats,
      we.elseId,
      we.elseEventBindings ?? [],
      we.elseTemplate,
    );
    const signals = we.signalNames.join(', ');
    const [start, middle, end] = (['(', '|', ')'] as const).map((kind, i) =>
      scope.at(`${we.thenId}${kind}`, `_w${'sme'[i]}_${we.thenId}`),
    );
    const call = (range: string, condition: string, template: string, init: string) =>
      `${use(BIND_FN.IF_EXPR)}(${range}, [${signals}], () => ${condition}, \`${escapeTemplateLiteral(stripMarks(emit.html(template)))}\`, ${init})`;
    return [
      call(`${start}, ${middle}`, we.jsExpression, we.thenTemplate, thenInit),
      call(`${middle}, ${end}`, `!(${we.jsExpression})`, we.elseTemplate, elseInit),
    ];
  };

  // A list's source, after its reconciler: the `_items_` thunk, the optional empty-template
  // sync, the initial reconcile, one subscription per source signal into `cleanups`, and the
  // reconciler's clearAll.
  const emitListSource = (
    rep: RepeatBlock,
    reconcilerVar: string,
    containerVar: string,
    anchorVar: string,
    lines: string[],
    cleanups: string,
  ): void => {
    const itemsVar = `_items_${rep.id}`;
    const emptyVar = `_empty_${rep.id}`;
    const syncVar = `_syncEmpty_${rep.id}`;
    lines.push(`    const ${itemsVar} = () => ${rep.itemsExpression};`);
    if (rep.emptyTemplate) {
      const escapedEmptyTemplate = escapeTemplateLiteral(emit.html(rep.emptyTemplate));
      lines.push(`    let ${emptyVar};`);
      lines.push(
        `    const ${syncVar} = (items) => { items.length ? ${emptyVar}?.remove() : ${containerVar}.insertBefore(${emptyVar} ??= ${use(BIND_FN.TEMPLATE)}(\`${escapedEmptyTemplate}\`).content.firstElementChild, ${anchorVar}); };`,
      );
    }
    lines.push(`    ${reconcilerVar}.reconcile(${itemsVar}());`);
    if (rep.emptyTemplate) lines.push(`    ${syncVar}(${itemsVar}());`);
    const onChange = rep.emptyTemplate
      ? `const items = ${itemsVar}(); ${reconcilerVar}.reconcile(items); ${syncVar}(items);`
      : `${reconcilerVar}.reconcile(${itemsVar}());`;
    buildRepeatSubscriptionSources(rep).forEach((source, sourceIdx) => {
      const sourceVar = `_rsrc_${rep.id}_${sourceIdx}`;
      lines.push(`    const ${sourceVar} = ${source};`);
      lines.push(
        `    ${cleanups}.push(typeof ${sourceVar}?.subscribe === 'function' ? ${sourceVar}.subscribe(() => { ${onChange} }, true) : () => {});`,
      );
    });
    // When the scope ends (destroy, a branch hiding, a row going), the rows' own cleanups run too
    lines.push(`    ${cleanups}.push(() => ${reconcilerVar}.clearAll());`);
  };

  // A row's bindings to component signals: navigation to each bound element (`_sN`), the first
  // writes, and one subscription per signal into the row's `_cleanups`. Attribute and style bindings
  // are reached by element path from `_el`; a text binding's text node (`_stN`) through the row's
  // scope, which declares it in its head.
  const emitRowSignalBindings = (
    staticInfo: StaticTemplateInfo,
    nodes: NavScope,
  ): { nav: string[]; fill: string[]; subscriptions: string[] } => {
    const nav: string[] = [];
    const fill: string[] = [];
    const subscriptions: string[] = [];
    const bind = (write: string, signalNames: string[] | undefined, signalName: string) => {
      fill.push(write);
      for (const s of signalNames ?? [signalName]) {
        subscriptions.push(`_cleanups.push(${s}.subscribe(() => { ${write}; }, true))`);
      }
    };
    (staticInfo.signalElementBindings ?? []).forEach((sb, i) => {
      const varName = `_s${i}`;
      nav.push(`const ${varName} = ${sb.path.length === 0 ? '_el' : pathToSiblingNav('_el', sb.path)}`);
      const signalCall = sb.expression ?? `${sb.signalName}()`;
      // Only attr/style — text bindings use signalCommentBindings
      if (sb.type === 'attr' && sb.property) {
        bind(attributeWrite(varName, sb, signalCall), sb.signalNames, sb.signalName);
      } else if (sb.type === 'style' && sb.property) {
        bind(`${varName}.style.setProperty('${sb.property}', ${signalCall})`, sb.signalNames, sb.signalName);
      }
    });
    (staticInfo.signalCommentBindings ?? []).forEach((scb, i) => {
      const text = nodes.text(scb.commentId, `_st${i}`);
      const signalCall = scb.expression ?? `${scb.signalName}()`;
      bind(`${text}.data = ${signalCall} ?? ''`, scb.signalNames, scb.signalName);
    });
    return { nav, fill, subscriptions };
  };

  // One repeat() list: the anchor lookup, the row template, the row factory and the
  // subscriptions, written as statements into `lines`. `scope` reaches the list's anchor, and its
  // unsubscribes go into `cleanups`. Component-level lists write straight into the binding function
  // (`_subs`); a list inside a when()/whenElse() branch writes into that branch's initializer, where a
  // block-scoped `_subs` collects them; a list inside a row writes into the row factory, into the
  // row's `_cleanups`. A row factory is a function of its own, and its item has the source's
  // name, so an inner list's `_el`, item and guards shadow the outer row's, as the source's scoping does.
  /**
   * A list inside a row can be given `hoist`: the statements that are the same for every outer row (its
   * template's root, its bind and update functions, its batch helper) go there, before the outer row's
   * factory, when none of the list's bindings or handlers reads the outer row (`outerNames`).
   */
  const emitRepeat = (
    rep: RepeatBlock,
    lines: string[],
    scope: NavScope,
    cleanups = '_subs',
    hoist?: { lines: string[]; outerNames: string[] },
  ): void => {
    // The list's anchor comment, reached through the scope, which declares it in its head
    const anchorLine = (anchorVar: string): void => void scope.at(`${rep.id}.`, anchorVar);
    const indexVar = rep.indexVar || '_idx';
    const itemName = rowItemName(rep);
    const hasNestedRepeats = rep.nestedRepeats.length > 0;
    const hasNestedConditionals = rep.nestedConditionals.length > 0;
    const hasItemEvents = rep.itemEvents.length > 0;

    // A row that is a child component call (`(item) => Card({ item })`) has no markup of its
    // own: each row mounts the component into a host element.
    const directRepeatComponent = childMountsByDirective?.get(rep.id) ? null : rep.componentRow;
    if (directRepeatComponent) {
      const anchorVar = `_a_${rep.id}`;
      const containerVar = `_ct_${rep.id}`;
      const reconcilerVar = `_rc_${rep.id}`;
      const propsExpr = rowProps(directRepeatComponent.propsExpression, rep);

      anchorLine(anchorVar);
      lines.push(`    const ${containerVar} = ${anchorVar}.parentNode;`);
      lines.push(`    const ${reconcilerVar} = ${use(BIND_FN.KEYED_RECONCILER)}(${containerVar}, ${anchorVar},`);
      lines.push(`      (${itemName}, ${indexVar}, _ref) => {`);
      lines.push(`        const _el = document.createElement('div');`);
      lines.push(`        _insertBefore.call(${containerVar}, _el, _ref);`);
      lines.push(
        `        return { el: _el, cleanups: [${use(BIND_FN.DESTROY_CHILD)}(${directRepeatComponent.componentName}.__f(_el, ${propsExpr}))], value: ${itemName}, update: () => {} };`,
      );
      lines.push(`      },`);
      lines.push(`    ${keyArg(rep)});`);
      emitListSource(rep, reconcilerVar, containerVar, anchorVar, lines, cleanups);
      return;
    }

    {
      // Use optimized template-based approach
      const staticInfo = generateStaticRepeatTemplate(
        rep.itemTemplate,
        rep.itemBindings,
        rep.itemEvents,
        rep.signalBindings,
      );
      // The row's text nodes, directive and list anchors and child hosts, reached from `_el` by
      // path in the row template as emitted. Every one is declared (the scope's head)
      // before the row's first write.
      const rowModel = modelOf(staticInfo.staticHtml, emit);
      const rowScope = createScope(rowModel, '        ', [{ node: rowModel.roots[0]!, expr: '_el', cost: 2 }]);

      const hasCommentBindings = rep.itemBindings.some(
        (b) => b.type === 'text' && b.textBindingMode === 'commentMarker',
      );
      const hasSignalCommentBindings = (staticInfo.signalCommentBindings?.length ?? 0) > 0;
      const hasAnyBindings =
        staticInfo.elementBindings.length > 0 ||
        hasCommentBindings ||
        hasSignalCommentBindings ||
        (staticInfo.signalElementBindings?.length ?? 0) > 0 ||
        (staticInfo.mixedSignalItemBindings?.length ?? 0) > 0 ||
        hasItemEvents ||
        hasNestedConditionals ||
        hasNestedRepeats ||
        rep.nestedWhenElse.length > 0;

      if (hasAnyBindings) {
        // Generate static template identifier
        const templateId = `__tpl_${rep.id}`;

        // Generate static template IIFE
        staticTemplates.push(
          `  const ${templateId} = ${use(BIND_FN.TEMPLATE)}(\`${escapeTemplateLiteral(stripMarks(emit.html(staticInfo.staticHtml)))}\`);`,
        );

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

        // Generate fill statements using inlined var names. Every write is redundancy-guarded:
        // the row keeps the last value written per binding and skips writes that would not
        // change the DOM (see guardedWrite).
        const guards = createGuardAllocator('_p');
        const fillStatements: string[] = [];
        const updateStatements: string[] = [];
        // Lean rows keep guard state on the managed record and share one update function;
        // these are the same updates written against the record, plus the record's fields.
        const leanUpdateStatements: string[] = [];
        const leanCommentUpdateStatements: string[] = [];
        const textVars: string[] = [];
        const commentVars: string[] = [];
        let textNodeCount = 0;
        for (let i = 0; i < staticInfo.elementBindings.length; i++) {
          const eb = staticInfo.elementBindings[i]!;
          const varName = navVarNames[i]!;
          for (const binding of eb.bindings) {
            const expr = inRow(rep, binding.expression);
            let gw: GuardedWrite | undefined;
            if (binding.type === 'text') {
              // Sole-content text bindings: the element is empty in the static template and the
              // fill writes textContent, the cheapest way to create the Text node. The first
              // guarded update resolves that node lazily (`??=`) and every update writes its
              // nodeValue: a string store on an existing node instead of textContent discarding
              // the child and allocating a new one per write. Rows that never update never pay
              // the read; an empty value leaves no node, so the update falls back to textContent
              // and resolves again next time.
              const textVar = `_t${textNodeCount++}`;
              textVars.push(textVar);
              const guard = guards.next();
              const textUpdate = (g: string, t: string, target: string): string =>
                `if (${g} !== (${g} = ${expr})) (${t} ??= ${target}.firstChild) ? (${t}.nodeValue = ${g} ?? '') : (${target}.textContent = ${g} ?? '')`;
              gw = {
                fill: `${varName}.textContent = (${guard} = ${expr}) ?? ''; let ${textVar}`,
                update: textUpdate(guard, textVar, varName),
              };
              // The shared update navigates only when a binding actually changes, and the text
              // node cache on the record makes that a one-time cost per row
              leanUpdateStatements.push(textUpdate(recordField(guard), recordField(textVar), navExprs[i]!));
            } else if (binding.type === 'attr' && binding.property) {
              const guard = guards.next();
              const write = (v: string) => attributeWrite(varName, binding, v);
              gw = guardedWrite(guard, write, expr, binding.staticValue);
              const leanWrite = (v: string) => attributeWrite(navExprs[i]!, binding, v);
              leanUpdateStatements.push(
                guardedWrite(guard, leanWrite, expr, binding.staticValue, recordField(guard)).update,
              );
            }
            if (gw) {
              fillStatements.push(gw.fill);
              updateStatements.push(gw.update);
            }
          }
        }

        // Comment-marker item bindings (mixed-content text bindings)
        const commentBindings = rep.itemBindings.filter(
          (b) => b.type === 'text' && b.textBindingMode === 'commentMarker',
        );
        const commentFillStatements: string[] = [];
        const commentUpdateStatements: string[] = [];
        commentBindings.forEach((cb, i) => {
          const expr = inRow(rep, cb.expression);
          // The text node after the marker, reached by path once per row; fill and update write to it
          const textVar = rowScope.text(cb.elementId, `_c${i}`);
          commentVars.push(textVar);
          const guard = guards.next();
          const gw = guardedWrite(guard, (v) => `${textVar}.data = (${v}) ?? ''`, expr);
          commentFillStatements.push(gw.fill);
          commentUpdateStatements.push(gw.update);
          const rec = recordField(textVar);
          leanCommentUpdateStatements.push(
            guardedWrite(guard, (v) => `${rec}.data = (${v}) ?? ''`, expr, undefined, recordField(guard)).update,
          );
        });

        // Signal binding navigation and fill (Step 13), and signal text bindings (Step 13b)
        const {
          nav: signalNavStatements,
          fill: signalFillStatements,
          subscriptions: signalSubscriptions,
        } = emitRowSignalBindings(staticInfo, rowScope);

        // Mixed signal+item binding navigation, fill, subscription & update (Step 13c)
        const mixedNavStatements: string[] = [];
        const mixedFillStatements: string[] = [];
        const mixedUpdateStatements: string[] = [];
        // Selection bindings are lifted out of the row: one subscription per list (emitted after
        // the reconciler exists) instead of one per row
        const selectionSubscriptions: string[] = [];
        // In a row whose when()/whenElse() content or inner list rows come and go, positions are only
        // known when the row is created: selection bindings, which a list-level subscription reaches
        // later by position, stay per row there
        const rowHasRanges = hasNestedConditionals || rep.nestedWhenElse.length > 0 || hasNestedRepeats;
        const mixedKeyProp = rep.trackByFn && !rowHasRanges ? extractKeyProperty(rep.trackByFn) : null;
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
            const expr = inRow(rep, mb.expression);
            const selection =
              mb.type === 'attr' && mb.property
                ? matchSelectionBinding(expr, mb.outerSignalNames, mixedKeyProp, itemName)
                : null;
            if (selection) {
              // Fill on creation only (guarded, so an empty class skips the write); the list-level
              // subscription owns every later change, and a data update cannot change the value
              // because the row's key is constant
              mixedFillStatements.push(
                guardedWrite(guards.next(), (v) => attributeWrite(varName, mb, v), expr, mb.staticValue).fill,
              );
              selectionSubscriptions.push(
                buildSelectionSubscription(
                  rep.id,
                  i,
                  selection,
                  mb.path,
                  (target, value) => attributeWrite(target, mb, value),
                  cleanups,
                ),
              );
              continue;
            }
            let gw: GuardedWrite | undefined;
            if (mb.type === 'attr' && mb.property) {
              gw = guardedWrite(guards.next(), (v) => attributeWrite(varName, mb, v), expr, mb.staticValue);
            } else if (mb.type === 'text') {
              gw = guardedWrite(guards.next(), (v) => `${varName}.textContent = (${v}) ?? ''`, expr);
            } else if (mb.type === 'style' && mb.property) {
              gw = guardedWrite(guards.next(), (v) => `${varName}.style.setProperty('${mb.property}', ${v})`, expr);
            }
            if (gw) {
              mixedFillStatements.push(gw.fill);
              mixedUpdateStatements.push(gw.update);
              // Per-item subscription: re-evaluate the expression when an outer signal changes.
              // The row's item is captured by the row factory's closure: the per-row value. The guard
              // means a signal change that leaves this row's value alone costs no DOM write.
              for (const sigName of mb.outerSignalNames) {
                signalSubscriptions.push(`_cleanups.push(${sigName}.subscribe(() => { ${gw.update}; }, true))`);
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

        const tplContentLine = lines.length;
        lines.push(`    const ${tplContentVar} = ${templateId}.content.firstElementChild;`);
        anchorLine(anchorVar);
        lines.push(`    const ${containerVar} = ${anchorVar}.parentNode;`);
        // Partition item events into delegated (container listener) vs non-delegatable (per-item)
        const { delegatedByType: delegatedEventsByType, nonDelegatable: nonDelegatableEvents } = hasItemEvents
          ? partitionItemEvents(rep.itemEvents, staticInfo.eventElementPaths, rep, indexVar)
          : { delegatedByType: new Map<string, DelegatedEvent[]>(), nonDelegatable: [] as ItemEventBinding[] };

        // A row with ranges keeps each delegated element on the row (`_el.__eN`, set at creation),
        // because the delegated listener cannot find it by position later
        const capturedEvents = new Map<DelegatedEvent, string>();
        if (rowHasRanges) {
          for (const events of delegatedEventsByType.values()) {
            for (const evt of events) if (evt.path.length > 0) capturedEvents.set(evt, `__e${capturedEvents.size}`);
          }
        }
        // Build delegated listener code (emitted AFTER reconciler creation)
        const delegatedListenerStatements = buildDelegatedListenerStatements(
          delegatedEventsByType,
          containerVar,
          itemName,
          capturedEvents,
        );

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
        const keyFnExpr = keyArg(rep);

        const repMountInfo = generateMountInfo(rep.id, '        ', rowScope, rep);
        const hasRepMounts = repMountInfo.cleanupExprs.length > 0;
        const hasSignalSubs = signalSubscriptions.length > 0;
        const needsCleanups =
          hasSignalSubs || hasNestedConditionals || hasNestedRepeats || rep.nestedWhenElse.length > 0 || hasRepMounts;

        const updateParts = [...updateStatements, ...commentUpdateStatements, ...mixedUpdateStatements];
        if (useDelegation) {
          updateParts.push(`_el.__d = ${itemName}`);
        }
        // Row-scoped signals for nested directives (see createRowRefRewriter in repeat-analysis)
        const rowSignalVars = rep.rowSignalVars ?? [];
        const hasIndexSignal = rowSignalVars.includes(`${indexVar}$`);
        // A list whose bindings read the index asks the reconciler to refresh rows that move
        const usesIndex =
          hasIndexSignal ||
          (!!rep.indexVar && rep.itemBindings.some((b) => expressionReferencesIdentifier(b.expression, rep.indexVar!)));
        for (const v of rowSignalVars) {
          updateParts.push(`${v}(${v === `${rep.itemVar}$` ? itemName : indexVar})`);
        }

        // Rows that need no cleanups (no per-row subscriptions, nested directives or child mounts)
        // are bound by a standalone function, so the reconciler can clone them in batches of
        // ROW_BATCH_SIZE and bind each cloned row; the single-row factory clones, binds and inserts.
        const batchRows = !needsCleanups;
        // Statements hoisted out of nested lists go before this row's factory
        const factoryStart = lines.length;
        const hoisted: string[] = [];
        // Rows with no cleanups inside a list inside a row, reading nothing of the outer row: the bind and
        // update functions, the template root and the batch helper are created once for every outer row
        const hoistRows =
          !!hoist &&
          batchRows &&
          !hoist.outerNames.some(
            (name) =>
              rep.itemBindings.some((b) => expressionReferencesIdentifier(b.expression, name)) ||
              rep.itemEvents.some((e) => expressionReferencesIdentifier(e.handlerExpression, name)),
          );
        const bindStart = lines.length;
        if (batchRows) {
          lines.push(`    const _bind_${rep.id} = (_el, ${itemName}, ${indexVar}) => {`);
        } else {
          lines.push(`    const ${reconcilerVar} = ${use(BIND_FN.KEYED_RECONCILER)}(${containerVar}, ${anchorVar},`);
          lines.push(`      (${itemName}, ${indexVar}, _ref) => {`);
          lines.push(`        const _el = _cloneNode.call(${tplContentVar}, true);`);
        }
        if (useDelegation) {
          lines.push(`        _el.__d = ${itemName};`);
        }
        for (const [evt, prop] of capturedEvents)
          lines.push(`        _el.${prop} = ${pathToSiblingNav('_el', evt.path)};`);
        for (const v of rowSignalVars) {
          lines.push(`        const ${v} = ${use(BIND_FN.SIGNAL)}(${v === `${rep.itemVar}$` ? itemName : indexVar});`);
        }
        for (const navStmt of navStatements) {
          lines.push(`        ${navStmt};`);
        }
        // Nested conditionals (Step 14) and lists (Step 15): the row reaches each one's anchors from
        // `_el`. A directive that shows changes the row, so they are declared with the rest. Their
        // content is bound by the branch initializer, as at component level.
        const directiveCalls: string[] = [];
        for (const cond of rep.nestedConditionals) {
          directiveCalls.push(`        _cleanups.push(${whenCall(cond, rowScope)});`);
        }
        for (const we of rep.nestedWhenElse) {
          for (const call of whenElseCalls(we, rowScope)) directiveCalls.push(`        _cleanups.push(${call});`);
        }
        // A list inside the row is generated like any other list, its unsubscribes in the row's
        // cleanups
        const outerNames = [rep.itemVar, itemName, rep.indexVar, ...rowSignalVars].filter((n): n is string => !!n);
        for (const nr of rep.nestedRepeats) {
          const listLines: string[] = [];
          emitRepeat(nr, listLines, rowScope, '_cleanups', { lines: hoisted, outerNames });
          directiveCalls.push(...listLines.map((line) => `    ${line}`));
        }
        // The directives read the item and index through the row signals, except where they read the
        // item variable itself: a child's props, and an item that is a signal (`row()`, the
        // Signal<Signal<T>[]> pattern). That is the row factory's parameter, unless the source's name
        // is one the compiler keeps for itself (rowItemName): then it is declared under that name.
        if (rep.itemVar && rep.itemVar !== itemName && codeReferences(directiveCalls, rep.itemVar)) {
          lines.push(`        const ${rep.itemVar} = ${itemName};`);
        }
        lines.push(...rowScope.head);
        for (const navStmt of signalNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        for (const navStmt of eventNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        for (const navStmt of mixedNavStatements) {
          lines.push(`        ${navStmt};`);
        }
        if (guards.vars.length > 0) {
          lines.push(`        ${guards.declaration()}`);
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
        if (!batchRows) {
          lines.push(`        _insertBefore.call(${containerVar}, _el, _ref);`);
        }
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
        lines.push(...directiveCalls);
        // Lean rows: no per-row update closure. Guard state and lazily resolved text nodes live
        // on the managed record, and one update function per list re-navigates from the row
        // element. Rows with a mixed signal+item binding that is not lifted keep their closure.
        const leanRows = batchRows && mixedUpdateStatements.length === 0;
        if (leanRows) {
          const leanParts = [...leanUpdateStatements, ...leanCommentUpdateStatements];
          const usedByUpdate = (v: string): boolean => leanParts.some((s) => s.includes(recordField(v)));
          const fields = [
            ...guards.vars.filter(usedByUpdate).map((v) => `${v.slice(1)}: ${v}`),
            ...textVars.map((v) => `${v.slice(1)}: undefined`),
            ...commentVars.map((v) => `${v.slice(1)}: ${v}`),
          ];
          lines.push(
            `        return { el: _el, cleanups: ${use(BIND_FN.NO_CLEANUPS)}, value: ${itemName}, key: undefined${fields.length > 0 ? ', ' + fields.join(', ') : ''} };`,
          );
          lines.push(`    };`);
          if (useDelegation) leanParts.push(`_el.__d = ${itemName}`);
          lines.push(`    const _update_${rep.id} = (_m, ${itemName}, ${indexVar}) => {`);
          lines.push(`      const _el = _m.el;`);
          lines.push(`      ${leanParts.join('; ')};`);
          lines.push(`    };`);
        } else {
          lines.push(
            `        return { el: _el, cleanups: ${needsCleanups ? '_cleanups' : use(BIND_FN.NO_CLEANUPS)}, value: ${itemName},`,
          );
          lines.push(
            `          update: (${itemName}${usesIndex ? `, ${indexVar}` : ''}) => { ${updateParts.join('; ')}; } };`,
          );
        }
        if (batchRows) {
          if (!leanRows) lines.push(`    };`);
          const batchHelper = `${use(BIND_FN.BATCH_ROWS)}(${ROW_BATCH_SIZE}, ${tplContentVar}, _bind_${rep.id}${leanRows ? `, _update_${rep.id}` : ''})`;
          if (hoistRows) {
            // The template root, bind and update functions and batch helper move out of the outer row
            const bindLines = lines.splice(bindStart, lines.length - bindStart);
            const [tplLine] = lines.splice(tplContentLine, 1);
            hoist!.lines.push(tplLine!, ...bindLines, `    const _br_${rep.id} = ${batchHelper};`);
          }
          lines.push(`    const ${reconcilerVar} = ${use(BIND_FN.KEYED_RECONCILER)}(${containerVar}, ${anchorVar},`);
          lines.push(
            `      (${itemName}, ${indexVar}, _ref) => { const _el = _cloneNode.call(${tplContentVar}, true); const _m = _bind_${rep.id}(_el, ${itemName}, ${indexVar}); _insertBefore.call(${containerVar}, _el, _ref); return _m; },`,
          );
          lines.push(`    ${keyFnExpr}, ${hoistRows ? `_br_${rep.id}` : batchHelper}${usesIndex ? ', true' : ''});`);
        } else {
          lines.push(`      },`);
          lines.push(`    ${keyFnExpr}${usesIndex ? ', undefined, true' : ''});`);
        }
        if (hoisted.length > 0) lines.splice(factoryStart, 0, ...hoisted);
        for (const sub of selectionSubscriptions) {
          lines.push(`    ${sub}`);
        }

        // Empty template handling (inlined by compiler — not in reconciler)
        emitListSource(rep, reconcilerVar, containerVar, anchorVar, lines, cleanups);
        // Emit delegated event listeners on the container (after reconciler is ready)
        for (const stmt of delegatedListenerStatements) {
          lines.push(`    ${stmt}`);
        }

        return;
      } else {
        // No-bindings path: template clone with no fill/update

        const templateId = `__tpl_${rep.id}`;
        staticTemplates.push(
          `  const ${templateId} = ${use(BIND_FN.TEMPLATE)}(\`${escapeTemplateLiteral(stripMarks(emit.html(staticInfo.staticHtml)))}\`);`,
        );

        const tplContentVar = `_tc_${rep.id}`;
        const anchorVar = `_a_${rep.id}`;
        const containerVar = `_ct_${rep.id}`;
        const reconcilerVar = `_rc_${rep.id}`;

        lines.push(`    const ${tplContentVar} = ${templateId}.content.firstElementChild;`);
        anchorLine(anchorVar);
        lines.push(`    const ${containerVar} = ${anchorVar}.parentNode;`);

        lines.push(`    const ${reconcilerVar} = ${use(BIND_FN.KEYED_RECONCILER)}(${containerVar}, ${anchorVar},`);
        lines.push(`      (${itemName}, ${indexVar}, _ref) => {`);
        lines.push(`        const _el = _cloneNode.call(${tplContentVar}, true);`);
        // Child component mounts inside repeat items (Step 7 + Step 10)
        const fbRepMountInfo = generateMountInfo(rep.id, '        ', rowScope, rep);
        lines.push(...rowScope.head);
        lines.push(`        _insertBefore.call(${containerVar}, _el, _ref);`);
        for (const sl of fbRepMountInfo.setupLines) {
          lines.push(sl);
        }
        if (fbRepMountInfo.cleanupExprs.length > 0) {
          lines.push(
            `        return { el: _el, cleanups: [${fbRepMountInfo.cleanupExprs.join(', ')}], value: ${itemName}, update: () => {} };`,
          );
        } else {
          lines.push(`        return { el: _el, cleanups: [], value: ${itemName}, update: () => {} };`);
        }
        lines.push(`      },`);
        lines.push(`    ${keyArg(rep)});`);

        // Empty template handling (inlined)
        emitListSource(rep, reconcilerVar, containerVar, anchorVar, lines, cleanups);
        return;
      }
    }
  };

  // Nested initializer shared by when() content and whenElse branches
  /**
   * Where one level's binding code goes: the component's body, which pushes each cleanup into `_subs`, or
   * a branch initializer, which returns them. `statement` takes a line without its indent.
   */
  interface BindingSink {
    statement: (line: string) => void;
    cleanup: (expr: string) => void;
    repeat: (rep: RepeatBlock) => void;
  }

  /**
   * The code that binds one template's own bindings, branches, lists, events and child components, for the
   * component and for every branch: each bound node reached through `scope` before any code changes the
   * DOM, then the writes, subscriptions and directives in one order.
   */
  const emitBindings = (
    parts: {
      bindings: BindingInfo[];
      conditionals: ConditionalBlock[];
      whenElse: WhenElseBlock[];
      repeats: RepeatBlock[];
      events: EventBinding[];
      mounts: { cm: ChildMountInfo; globalIndex: number }[];
    },
    scope: NavScope,
    sink: BindingSink,
  ): void => {
    const ids = [...new Set(parts.bindings.map((b) => b.id))];
    const isText = (id: string) => parts.bindings.some((b) => b.id === id && b.type === 'text');
    // Elements first: a text node's path can then start from one of them. An element the scope reaches
    // directly (the component's `_ns[i]`) is named by a statement.
    for (const id of ids.filter((id) => !isText(id))) {
      const expr = scope.at(id, nodeVar(id));
      if (expr !== nodeVar(id)) sink.statement(`const ${nodeVar(id)} = ${expr};`);
    }
    for (const evt of parts.events) scope.at(evt.elementId, nodeVar(evt.elementId));
    for (const id of ids.filter(isText)) scope.text(id, nodeVar(id));

    // Simple bindings: the initial value, and one subscription per signal
    const simpleBindings = parts.bindings.filter(isSimpleBinding);
    for (const binding of simpleBindings) sink.statement(`${generateInitialValueCode(binding)};`);
    for (const [signalName, signalBindings] of groupBindingsBySignal(simpleBindings)) {
      sink.cleanup(generateConsolidatedSubscription(signalName, signalBindings));
    }
    // Expression bindings re-run whenever any of their signals change; the guard skips the DOM write when
    // the result is unchanged. They run once first: subscribe(…, true) skips the initial notification.
    parts.bindings.filter(isExpressionBinding).forEach((binding, idx) => {
      const write = expressionWrite({ ...binding, id: binding.id });
      if (!write) return;
      const updFn = `_upd_${binding.id}_${idx}`;
      const guard = `_pv_${binding.id}_${idx}`;
      sink.statement(
        `let ${guard}; const ${updFn} = () => { ${guardedWrite(guard, write, binding.expression).update}; };`,
      );
      sink.statement(`${updFn}();`);
      for (const sig of binding.signalNames) sink.cleanup(`${sig}.subscribe(${updFn}, true)`);
    });

    // when() element content is a full sub-template: the same initializer as a whenElse branch
    for (const cond of parts.conditionals) sink.cleanup(whenCall(cond, scope));
    for (const we of parts.whenElse) for (const call of whenElseCalls(we, scope)) sink.cleanup(call);
    for (const rep of parts.repeats) sink.repeat(rep);
    for (const line of buildEventListenerStatements(parts.events, scope)) sink.statement(line);
    // Child components: mounted once, destroyed with the template around them
    for (const mount of parts.mounts) {
      const { setup, cleanup } = mountChild(mount, '', scope);
      for (const line of setup) sink.statement(line);
      sink.cleanup(cleanup);
    }
  };

  const generateNestedInitializer = (
    bindings: BindingInfo[],
    nestedConds: ConditionalBlock[],
    nestedWE: WhenElseBlock[],
    nestedReps: RepeatBlock[],
    directiveId: string | undefined,
    nestedEvents: EventBinding[],
    template: string,
  ): string => {
    const mounts = (directiveId && childMountsByDirective?.get(directiveId)) || [];
    if (
      bindings.length === 0 &&
      nestedConds.length === 0 &&
      nestedWE.length === 0 &&
      nestedReps.length === 0 &&
      nestedEvents.length === 0 &&
      mounts.length === 0
    ) {
      return '() => []';
    }

    // Every node the branch binds is reached from the branch's first node, before any of the branch's
    // code changes the DOM
    const scope = branchScope(modelOf(template, emit), '      ');
    const statements: string[] = [];
    const cleanups: string[] = [];
    emitBindings(
      {
        bindings,
        conditionals: nestedConds,
        whenElse: nestedWE,
        repeats: nestedReps,
        events: nestedEvents,
        mounts,
      },
      scope,
      {
        statement: (line) => statements.push(`      ${line}`),
        cleanup: (expr) => cleanups.push(`        ${expr},`),
        // A list's cleanups are its own, released by one entry
        repeat: (rep) => {
          const repLines: string[] = [];
          emitRepeat(rep, repLines, scope);
          statements.push(`      const _rsubs_${rep.id} = [];`, `      { const _subs = _rsubs_${rep.id};`);
          for (const line of repLines) statements.push(`  ${line}`);
          statements.push('      }');
          cleanups.push(`        () => { for (let i = 0; i < _rsubs_${rep.id}.length; i++) _rsubs_${rep.id}[i](); },`);
        },
      },
    );
    return ['(_c) => {', ...scope.head, ...statements, '      return [', ...cleanups, '      ];', '    }'].join('\n');
  };
  // Cached prototype methods for repeat block hot paths (avoids prototype chain lookup per call).
  // Lists inside when()/whenElse() branches use them too, so any list at any depth counts.
  let hasAnyRepeat = false;
  walkDirectives(
    { conditionals, whenElse: whenElseBlocks, repeats: repeatBlocks },
    {
      repeat: () => {
        hasAnyRepeat = true;
        return false;
      },
    },
  );

  // The component's own bindings, branches, lists, events and children
  emitBindings(
    {
      bindings: bindings.filter((b) => !b.isInsideConditional),
      conditionals,
      whenElse: whenElseBlocks,
      repeats: repeatBlocks,
      events: eventBindings.filter((evt) => !conditionalEventIds.has(evt.id)),
      mounts: topLevelChildMounts,
    },
    top,
    {
      statement: (line) => lines.push(`    ${line}`),
      cleanup: (expr) => lines.push(`    _subs.push(${expr});`),
      repeat: (rep) => emitRepeat(rep, lines, top),
    },
  );

  // Return cleanup function that unsubscribes all top-level subscriptions
  lines.push(`    return () => { for (let i = 0; i < _subs.length; i++) _subs[i](); };`);
  // The component's anchors are reached before any of its code changes the DOM
  lines.splice(1, 0, ...top.head);
  if (fragment) lines.splice(1 + top.head.length, 0, '    _ctx.place();');
  if (top.usesRoot()) lines.unshift(`    const _r = _ctx.root;`);

  return { code: lines.join('\n'), staticTemplates, helpers, elementList: top.used(), domPrototype: hasAnyRepeat };
};

/**
 * Generate the static template declaration `name` for pre-compiled HTML (the file imports the runtime's `__T`)
 */
export const generateStaticTemplate = (content: string, emit: EmitOptions, name = '__tpl'): string => {
  const escapedContent = escapeTemplateLiteral(stripMarks(emit.html(content)));
  return `
  const ${name} = ${BIND_FN.TEMPLATE}(\`${escapedContent}\`);`;
};

/**
 * Generate updated import statements — splits user-facing imports (from 'thane')
 * and compiler-internal imports (from 'thane/runtime') into two separate lines.
 *
 * This keeps the public API surface clean: `import { signal } from 'thane'`
 * never shows __registerComponent or __bindIf in IDE autocomplete.
 */
export const generateUpdatedImport = (
  importInfo: ImportInfo,
  requiredBindFunctions: string[],
  domPrototype = false,
): string => {
  const q = importInfo.quoteChar;
  const userImports = importInfo.namedImports;
  const internalImports = requiredBindFunctions;

  // Resolve the internal specifier from the user's module specifier.
  // 'thane' or 'thane/…' → 'thane/runtime', relative paths stay unchanged (dev/test).
  const spec = importInfo.moduleSpecifier;
  const internalSpec =
    spec === PUBLIC_RUNTIME_SPECIFIER || spec.startsWith(`${PUBLIC_RUNTIME_SPECIFIER}/`)
      ? INTERNAL_RUNTIME_SPECIFIER
      : spec;

  const lines: string[] = [];
  if (userImports.length > 0) {
    lines.push(`import { ${userImports.join(', ')} } from ${q}${spec}${q}`);
  }
  if (internalImports.length > 0) {
    lines.push(`import { ${internalImports.join(', ')} } from ${q}${internalSpec}${q}`);
  }
  if (domPrototype) lines.push(`import { _cloneNode, _insertBefore } from ${q}${DOM_RUNTIME_SPECIFIER}${q}`);
  return lines.join('\n');
};
