/**
 * Type definitions for the reactive binding compiler
 */

import type { ReactiveBindingKind, TextBindingMode } from '../../../contracts/index.js';

/**
 * A child component mounted where its template calls it (`${Card({…})}`), or a fragment imported from another
 * module mounted where its template uses it. The binding compiler gives it a placeholder, `<!--b0.-->`, as
 * it reads the template, and mounts it there.
 */
export interface ChildMountInfo {
  /** The name the file calls the component by; for a fragment, the name the file imports it under */
  componentName: string;
  /** Kebab-case selector, e.g. "my-element-component" ('' for a fragment) */
  selector: string;
  /** Raw source text of the props argument, e.g. "{ color: myColor }" */
  propsExpression: string;
  /** Its placeholder's id ("b0", "b1", …): the placeholder is `<!--b0.-->` */
  anchorId: string;
  /** An imported fragment: mounted before its placeholder, which stays */
  fragment?: true;
}

/** What a file's templates call and use by name: the components the file can call, and the fragments it imports */
export interface TemplateNames {
  components: ReadonlyMap<string, { selector: string }>;
  fragments: ReadonlyMap<string, { staticText: string | null }>;
}

/** What the code generator emits differently in a production build. */
export interface EmitOptions {
  /**
   * Prepare a compiled template's HTML for emission. Identity in development; the HTML
   * minifier in production. Every template the generated code carries goes through it, so
   * templates are minified here, as HTML, and never later as part of a JavaScript file.
   */
  html: (template: string) => string;
  /** The name a component selector is emitted under: itself, or its production short name */
  selector: (name: string) => string;
}

export interface ConditionalBlock {
  id: string;
  signalName: string; // Primary signal (for simple cases)
  signalNames: string[]; // All signals in the expression
  jsExpression: string; // The full JS expression e.g. "!_loading()" or "_a() && _b()"
  initialValue: boolean | undefined; // undefined = not resolvable at compile time; runtime decides at mount
  templateContent: string; // HTML to insert when true
  startIndex: number; // Position in HTML where the element/block starts
  endIndex: number; // Position where it ends
  nestedBindings: BindingInfo[]; // Signal bindings directly inside this conditional (not inside nested directives)
  nestedConditionals: ConditionalBlock[]; // Nested when blocks inside this conditional
  nestedWhenElse: WhenElseBlock[]; // Nested whenElse blocks inside this conditional
  nestedRepeats: RepeatBlock[]; // Nested repeat blocks inside this conditional
  nestedEventBindings: EventBinding[]; // Event bindings inside this conditional
}

export interface WhenElseBlock {
  thenId: string; // ID for the "then" conditional element
  elseId: string; // ID for the "else" conditional element
  signalName: string; // Primary signal
  signalNames: string[]; // All signals in the expression
  jsExpression: string; // The condition expression
  initialValue: boolean | undefined; // undefined = not resolvable at compile time; runtime decides at mount
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
  thenConditionals: ConditionalBlock[]; // Nested when blocks inside then template
  elseConditionals: ConditionalBlock[]; // Nested when blocks inside else template
  thenWhenElse: WhenElseBlock[]; // Nested whenElse blocks inside then template
  elseWhenElse: WhenElseBlock[]; // Nested whenElse blocks inside else template
}
export interface RepeatBlock {
  id: string; // ID for the anchor element
  signalName: string; // Primary signal (the array signal)
  signalNames: string[]; // All signals in the expression
  itemsExpression: string; // e.g., "_countries()"
  itemVar: string; // e.g., "country"
  indexVar?: string | undefined; // e.g., "index" (optional)
  itemTemplate: string; // HTML template for each item (processed)
  /**
   * A row that is a component call: the component and its props, as written, and the signals of the rows
   * around this list that its props read (see RowChildMount)
   */
  componentRow?: { componentName: string; propsExpression: string; follows?: string[] } | undefined;
  emptyTemplate?: string | undefined; // HTML template shown when list is empty
  trackByFn?: string | undefined; // Custom trackBy function source: the reconciler's row key (its property name for `(x) => x.prop`)
  startIndex: number; // Position in HTML where ${repeat starts
  endIndex: number; // Position after }
  itemBindings: ItemBinding[]; // Bindings inside item template that reference item/index
  itemEvents: ItemEventBinding[]; // Event handlers inside item template
  signalBindings: SimpleBinding[]; // Component-level signal bindings inside repeat items (always simple)
  nestedConditionals: ConditionalBlock[];
  nestedWhenElse: WhenElseBlock[];
  nestedRepeats: RepeatBlock[];
  /**
   * Row-scoped signals the row factory declares (`<itemVar>$`, `<indexVar>$`) so that nested
   * directives read the row's item and index through a signal and re-evaluate when the row's
   * update writes them. Only present when a nested directive references the item or index.
   */
  rowSignalVars?: string[] | undefined;
}

export interface ItemBinding {
  elementId: string; // ID assigned to the element (e.g., 'i0', 'i1')
  type: ReactiveBindingKind; // Type of binding
  property?: string | undefined; // For attr/style: the property name
  expression: string; // The JS expression (e.g., 'item.label', 'item.count > 0')
  /**
   * For text bindings: how the binding is rendered in the DOM
   * - 'textNode': the binding is the element's only content; the row creates the Text node
   *   on fill and writes its nodeValue on update
   * - 'commentMarker': Uses <!--id--> comment marker to locate text node (for mixed content)
   */
  textBindingMode?: TextBindingMode;
  /** Outer component signals referenced in this expression (for mixed signal + item bindings) */
  outerSignalNames?: string[];
  /**
   * For attr bindings: the attribute value the static template ships with (the source value
   * with every `${…}` removed). When it is the empty string the first write can be skipped
   * whenever the expression also evaluates to the empty string.
   */
  staticValue?: string | undefined;
  /** For attr bindings: DOM property to write instead of setAttribute (e.g. `className`), when one applies */
  domProperty?: string | undefined;
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
  handlerExpression: string; // The handler code (method reference or arrow function); for a ref, its name
  elementId: string; // ID of the element with the event binding
  /** An element ref in the tag (`<input ${input}>`): the binding assigns the element to the ref's `el` */
  ref?: boolean;
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
  /** For attr bindings: DOM property to write instead of setAttribute (e.g. `className`), when one applies */
  domProperty?: string | undefined;
  /**
   * Row signal bindings only: the full expression when it is more than a bare signal read
   * (`user().name`, `row$().label`), and every signal it reads. Absent for `signal()`.
   */
  expression?: string | undefined;
  signalNames?: string[] | undefined;
}

/**
 * An expression text binding referencing one or more signals.
 * The full JS expression is evaluated on each signal change.
 * Text bindings are rendered after a marker comment (`<!--bN-->value<!---->` while compiled, the
 * marker emitted without its id); updates write the text node after it, reached by path.
 */
export interface ExpressionBinding extends BindingBase {
  signalNames: string[];
  expression: string;
  type: ReactiveBindingKind;
  property?: string;
  /** For attr bindings: DOM property to write instead of setAttribute (e.g. `className`), when one applies */
  domProperty?: string | undefined;
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
      domProperty?: string | undefined;
      expression: string;
      staticValue?: string | undefined;
    }>;
  }>;
  /** Navigation paths for event-bound elements (elementId -> path) */
  eventElementPaths?: Map<string, number[]> | undefined;
  /** Navigation paths and binding info for signal-bound elements inside repeat items */
  signalElementBindings?: Array<{
    expression?: string | undefined;
    signalNames?: string[] | undefined;
    path: number[];
    signalName: string;
    type: ReactiveBindingKind;
    property?: string | undefined;
    domProperty?: string | undefined;
  }>;
  /** Signal text bindings that use comment markers (cannot be navigated by element path) */
  signalCommentBindings?: Array<{
    expression?: string | undefined;
    signalNames?: string[] | undefined;
    commentId: string;
    signalName: string;
  }>;
  /** Item bindings that also reference outer signals — need per-item subscriptions */
  mixedSignalItemBindings?: Array<{
    path: number[];
    outerSignalNames: string[];
    type: ReactiveBindingKind;
    property?: string | undefined;
    domProperty?: string | undefined;
    expression: string;
    staticValue?: string | undefined;
  }>;
}
