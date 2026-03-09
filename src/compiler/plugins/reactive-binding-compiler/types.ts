/**
 * Type definitions for the reactive binding compiler
 */

import type {
  ReactiveBindingKind,
  RepeatOptimizationSkipReasonKind,
  TextBindingMode,
} from '../../../contracts/index.js';

/**
 * Access pattern abstraction for code generation.
 *
 * Codegen and template-processing use this to emit the correct
 * member-access syntax for each component model:
 *
 *  - **class-based**: `this.signal`, `this.shadowRoot`, `this.constructor.X`, `.call(this, e)`
 *  - **defineComponent (closure)**: bare `signal`, `ctx.root`, plain `X`, `.call(null, e)`
 */
export interface AccessPattern {
  /** Wrap a signal name for read access, e.g. `"this." + name` or bare `name` */
  signal: (name: string) => string;
  /** Wrap a signal call expression, e.g. `"this.foo()"` or `"foo()"` */
  signalCall: (name: string) => string;
  /** Root element expression used by initializeBindings, e.g. `"this.shadowRoot"` or `"ctx.root"` */
  root: string;
  /** Alias variable for root inside initializeBindings, e.g. `"const r = this.shadowRoot;"` or `"const r = ctx.root;"` */
  rootAlias: string;
  /** Prefix for static template class properties, e.g. `"this.constructor."` or `""` */
  staticPrefix: string;
  /** Static template declaration format: class property or standalone const */
  staticTemplatePrefix: string;
}

/** Access pattern for defineComponent (closure-based) */
export const CLOSURE_ACCESS: AccessPattern = {
  signal: (name) => name,
  signalCall: (name) => `${name}()`,
  root: 'ctx.root',
  rootAlias: 'const r = ctx.root;',
  staticPrefix: '',
  staticTemplatePrefix: 'const __tpl',
};

export interface ConditionalBlock {
  id: string;
  signalName: string; // Primary signal (for simple cases)
  signalNames: string[]; // All signals in the expression
  jsExpression: string; // The full JS expression e.g. "!_loading()" or "_a() && _b()"
  initialValue: boolean;
  templateContent: string; // HTML to insert when true
  startIndex: number; // Position in HTML where the element/block starts
  endIndex: number; // Position where it ends
  nestedBindings: BindingInfo[]; // Signal bindings inside this conditional
  nestedItemBindings: ItemBinding[]; // Item bindings inside this conditional (for conditionals inside repeats)
  nestedConditionals: ConditionalBlock[]; // Nested when blocks inside this conditional
  nestedEventBindings: EventBinding[]; // Event bindings inside this conditional
}

export interface WhenElseBlock {
  thenId: string; // ID for the "then" conditional element
  elseId: string; // ID for the "else" conditional element
  signalName: string; // Primary signal
  signalNames: string[]; // All signals in the expression
  jsExpression: string; // The condition expression
  initialValue: boolean;
  thenTemplate: string; // HTML to insert when true
  elseTemplate: string; // HTML to insert when false
  startIndex: number; // Position in HTML where ${whenElse starts
  endIndex: number; // Position after }
  thenBindings: BindingInfo[]; // Bindings inside then template
  elseBindings: BindingInfo[]; // Bindings inside else template
  thenRepeats: RepeatBlock[]; // Repeat blocks inside then template
  elseRepeats: RepeatBlock[]; // Repeat blocks inside else template
  thenEventBindings: EventBinding[]; // Event bindings inside then template
  elseEventBindings: EventBinding[]; // Event bindings inside else template
  nestedConditionals: ConditionalBlock[]; // Nested when blocks inside then/else
  nestedWhenElse: WhenElseBlock[]; // Nested whenElse blocks inside then/else
  nestedRepeats: RepeatBlock[]; // Nested repeat blocks inside then/else
}

export interface RepeatBlock {
  id: string; // ID for the anchor element
  signalName: string; // Primary signal (the array signal)
  signalNames: string[]; // All signals in the expression
  itemsExpression: string; // e.g., "_countries()"
  itemVar: string; // e.g., "country"
  indexVar?: string | undefined; // e.g., "index" (optional)
  itemTemplate: string; // HTML template for each item (processed)
  emptyTemplate?: string | undefined; // HTML template shown when list is empty
  trackByFn?: string | undefined; // Custom trackBy function source (deprecated - no longer used)
  startIndex: number; // Position in HTML where ${repeat starts
  endIndex: number; // Position after }
  itemBindings: ItemBinding[]; // Bindings inside item template that reference item/index
  itemEvents: ItemEventBinding[]; // Event handlers inside item template
  signalBindings: SimpleBinding[]; // Component-level signal bindings inside repeat items (always simple)
  eventBindings: EventBinding[]; // Event bindings not involving item
  nestedConditionals: ConditionalBlock[];
  nestedWhenElse: WhenElseBlock[];
  nestedRepeats: RepeatBlock[];
}

export interface ItemBinding {
  elementId: string; // ID assigned to the element (e.g., 'i0', 'i1')
  type: ReactiveBindingKind; // Type of binding
  property?: string | undefined; // For attr/style: the property name
  expression: string; // The JS expression (e.g., 'item.label', 'item.count > 0')
  /**
   * For text bindings: how the binding is rendered in the DOM
   * - 'textContent': Uses parent element's textContent (when binding is only child)
   * - 'commentMarker': Uses <!--id--> comment marker to locate text node (for mixed content)
   */
  textBindingMode?: TextBindingMode;
  /** Outer component signals referenced in this expression (for mixed signal + item bindings) */
  outerSignalNames?: string[];
}

export interface ItemEventBinding {
  eventId: string; // Unique ID for this event handler (e.g., 'ie0', 'ie1')
  elementId: string; // ID of the element with the event binding (e.g., 'b0')
  eventName: string; // Event type (e.g., 'click', 'mouseenter')
  modifiers: string[]; // Event modifiers (e.g., ['stop', 'prevent'])
  handlerExpression: string; // The handler code with item/index references
}

export interface EventBinding {
  id: string; // Unique ID for this event handler (e.g., 'e0', 'e1')
  eventName: string; // Event type (e.g., 'click', 'mouseenter')
  modifiers: string[]; // Event modifiers (e.g., ['stop', 'prevent'])
  handlerExpression: string; // The handler code (method reference or arrow function)
  elementId: string; // ID of the element with the event binding
  startIndex: number; // Position in HTML where @event= starts
  endIndex: number; // Position after closing quote
}

export interface BindingBase {
  id: string;
  isInsideConditional: boolean;
  conditionalId?: string;
}

/**
 * A simple 1:1 signal → element binding.
 * One signal drives one DOM update (text, style, or attribute).
 */
export interface SimpleBinding extends BindingBase {
  signalName: string;
  type: ReactiveBindingKind;
  property?: string;
}

/**
 * An expression text binding referencing one or more signals.
 * The full JS expression is evaluated on each signal change.
 * Text bindings are rendered via comment markers: `<!--bN-->value`.
 * Updates target `commentNode.nextSibling.data` (the text node after the comment).
 */
export interface ExpressionBinding extends BindingBase {
  signalNames: string[];
  expression: string;
  type: ReactiveBindingKind;
  property?: string;
}

/**
 * Discriminated union of all binding types.
 * Use `isExpressionBinding()` / `isSimpleBinding()` to narrow.
 */
export type BindingInfo = SimpleBinding | ExpressionBinding;

/** Type guard: narrows BindingInfo to ExpressionBinding */
export const isExpressionBinding = (b: BindingInfo): b is ExpressionBinding => 'expression' in b;

/** Type guard: narrows BindingInfo to SimpleBinding */
export const isSimpleBinding = (b: BindingInfo): b is SimpleBinding => !('expression' in b);

/**
 * Information about a static repeat template with DOM navigation paths
 */
export interface StaticTemplateInfo {
  /** Static HTML template without dynamic values */
  staticHtml: string;
  /** Array of element bindings with navigation paths */
  elementBindings: Array<{
    id: string;
    path: number[];
    bindings: Array<{
      type: Exclude<ReactiveBindingKind, 'style'>;
      property?: string | undefined;
      expression: string;
    }>;
  }>;
  /** Navigation paths for event-bound elements (elementId -> path) */
  eventElementPaths?: Map<string, number[]> | undefined;
  /** Navigation paths and binding info for signal-bound elements inside repeat items */
  signalElementBindings?: Array<{
    path: number[];
    signalName: string;
    type: ReactiveBindingKind;
    property?: string | undefined;
  }>;
  /** Signal text bindings that use comment markers (cannot be navigated by element path) */
  signalCommentBindings?: Array<{
    commentId: string;
    signalName: string;
  }>;
  /** Navigation paths for directive anchors: conditional/repeat anchors inside item template (Step 14/15) */
  directiveAnchorPaths?: Map<string, number[]>;
  /** Item bindings that also reference outer signals — need per-item subscriptions */
  mixedSignalItemBindings?: Array<{
    path: number[];
    outerSignalNames: string[];
    type: ReactiveBindingKind;
    property?: string | undefined;
    expression: string;
  }>;
  /** Whether this template can use the optimized path */
  canUseOptimized: boolean;
  /** Reason optimization was skipped (for warnings) */
  skipReason?: RepeatOptimizationSkipReason;
}

/** Reasons why a repeat block cannot use the optimized template-based rendering */
export type RepeatOptimizationSkipReason = RepeatOptimizationSkipReasonKind;
