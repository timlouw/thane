/**
 * Type definitions for the reactive binding compiler
 */



export interface ConditionalBlock {
  id: string;
  signalName: string; // Primary signal (for simple cases)
  signalNames: string[]; // All signals in the expression
  jsExpression: string; // The full JS expression e.g. "!this._loading()" or "this._a() && this._b()"
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
  nestedConditionals: ConditionalBlock[]; // Nested when blocks inside then/else
  nestedWhenElse: WhenElseBlock[]; // Nested whenElse blocks inside then/else
}

export interface RepeatBlock {
  id: string; // ID for the anchor element
  signalName: string; // Primary signal (the array signal)
  signalNames: string[]; // All signals in the expression
  itemsExpression: string; // e.g., "this._countries()"
  itemVar: string; // e.g., "country"
  indexVar?: string | undefined; // e.g., "index" (optional)
  itemTemplate: string; // HTML template for each item (processed)
  emptyTemplate?: string | undefined; // HTML template shown when list is empty
  trackByFn?: string | undefined; // Custom trackBy function source (deprecated - no longer used)
  startIndex: number; // Position in HTML where ${repeat starts
  endIndex: number; // Position after }
  itemBindings: ItemBinding[]; // Bindings inside item template that reference item/index
  itemEvents: ItemEventBinding[]; // Event handlers inside item template
  signalBindings: BindingInfo[]; // Signal bindings like ${this._class()}
  eventBindings: EventBinding[]; // Event bindings not involving item
  nestedConditionals: ConditionalBlock[];
  nestedWhenElse: WhenElseBlock[];
  nestedRepeats: RepeatBlock[];
}

export interface ItemBinding {
  elementId: string; // ID assigned to the element (e.g., 'i0', 'i1')
  type: 'text' | 'attr' | 'style'; // Type of binding
  property?: string | undefined; // For attr/style: the property name
  expression: string; // The JS expression (e.g., 'item.label', 'item.count > 0')
  /**
   * For text bindings: how the binding is rendered in the DOM
   * - 'textContent': Uses parent element's textContent (when binding is only child)
   * - 'commentMarker': Uses <!--id--> comment marker to locate text node (for mixed content)
   */
  textBindingMode?: 'textContent' | 'commentMarker';
}

export interface ItemEventBinding {
  eventId: string; // Unique ID for this event handler (e.g., 'ie0', 'ie1')
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

export interface BindingInfo {
  id: string;
  signalName: string;
  type: 'text' | 'style' | 'attr';
  property?: string | undefined; // For style/attr bindings
  isInsideConditional: boolean;
  conditionalId?: string | undefined; // Which conditional block this is inside
}

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
      type: 'text' | 'attr';
      property?: string | undefined;
      expression: string;
    }>;
  }>;
  /** Whether this template can use the optimized path */
  canUseOptimized: boolean;
  /** Reason optimization was skipped (for warnings) */
  skipReason?: RepeatOptimizationSkipReason;
}

/** Reasons why a repeat block cannot use the optimized template-based rendering */
export type RepeatOptimizationSkipReason = 
  | 'no-bindings'           // No item bindings at all
  | 'signal-bindings'       // Has this._signal() bindings inside
  | 'nested-repeat'         // Has repeat() inside repeat()
  | 'nested-conditional'    // Has when() or whenElse() inside
  | 'item-events'           // Has @click etc. inside items
  | 'mixed-bindings'        // Item binding expressions contain this._
  | 'multi-root'            // Template has multiple root elements
  | 'path-not-found';       // Element path couldn't be computed
