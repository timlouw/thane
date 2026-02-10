# Thane Lint Rules Reference

> Complete reference for all Thane compiler lint rules.
> Rules enforce patterns the TypeScript type system **cannot** catch — silent failures,
> compiler assumptions, and binding-detection edge cases.
>
> Rules are run both at build time (via the `thane-linter` compiler plugin) and in real-time
> inside VS Code (via the `tagged-templates` extension with the linter enabled).

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✔ | Implemented and shipping |
| ○ | Proposed — not yet implemented |
| ◈ | Under discussion — may require compiler changes |

---

## Quick Reference

| Code | Name | Severity | Status | Category |
|------|------|----------|--------|----------|
| THANE400 | [no-default-export-component](#thane400--no-default-export-component) | error | ✔ | Component |
| THANE401 | [component-property-order](#thane401--component-property-order) | error | ✔ | Component |
| THANE402 | [lifecycle-arrow-function](#thane402--lifecycle-arrow-function) | error | ✔ | Component |
| THANE403 | [require-template-property](#thane403--require-template-property) | error | ○ | Component |
| THANE404 | [return-object-literal](#thane404--return-object-literal) | error | ○ | Component |
| THANE405 | [valid-component-selector](#thane405--valid-component-selector) | error | ○ | Component |
| THANE406 | [setup-arrow-function](#thane406--setup-arrow-function) | warning | ○ | Component |
| THANE410 | [signal-call-in-template](#thane410--signal-call-in-template) | error | ○ | Bindings |
| THANE411 | ~~no-complex-text-binding~~ | ~~warning~~ | ✘ Removed | ~~Bindings~~ |
| THANE412 | [no-this-in-template-binding](#thane412--no-this-in-template-binding) | error | ○ | Bindings |
| THANE413 | [no-nested-html-template](#thane413--no-nested-html-template) | warning | ○ | Bindings |
| THANE420 | [event-handler-expression-required](#thane420--event-handler-expression-required) | error | ○ | Events |
| THANE421 | [no-unknown-event-modifier](#thane421--no-unknown-event-modifier) | warning | ○ | Events |
| THANE422 | [key-modifier-on-non-keyboard-event](#thane422--key-modifier-on-non-keyboard-event) | warning | ○ | Events |
| THANE430 | ~~no-when-on-void-element~~ | ~~error~~ | ✘ Removed | ~~Conditionals~~ |
| THANE431 | [when-else-argument-count](#thane431--when-else-argument-count) | error | ○ | Conditionals |
| THANE432 | [when-else-inline-templates](#thane432--when-else-inline-templates) | error | ◈ | Conditionals |
| THANE433 | [when-directive-placement](#thane433--when-directive-placement) | error | ○ | Conditionals |
| THANE440 | [repeat-template-arrow-function](#thane440--repeat-template-arrow-function) | error | ○ | Repeat |
| THANE441 | [repeat-single-root-element](#thane441--repeat-single-root-element) | error | ○ | Repeat |
| THANE442 | [repeat-argument-count](#thane442--repeat-argument-count) | error | ○ | Repeat |
| THANE443 | [repeat-track-by-arrow-function](#thane443--repeat-track-by-arrow-function) | warning | ○ | Repeat |
| THANE450 | [signal-static-initial-value](#thane450--signal-static-initial-value) | info | ○ | Signals |
| THANE460 | [no-conflicting-bind-ids](#thane460--no-conflicting-bind-ids) | warning | ◈ | HTML |
| THANE461 | [void-element-no-children](#thane461--void-element-no-children) | warning | ○ | HTML |
| THANE470 | [route-component-module-format](#thane470--route-component-module-format) | error | ○ | Routes |
| THANE480 | [prefer-optimized-repeat](#thane480--prefer-optimized-repeat) | info | ○ | Performance |

---

## 1 · Component Structure

### THANE400 — no-default-export-component

| | |
|---|---|
| **Severity** | error |
| **Status** | ✔ Implemented |
| **Why** | The compiler auto-derives the CSS custom-element selector from the export name. A default export has no name, so the selector cannot be derived and the component silently fails to register. |

```ts
// ✅ Named export — compiler derives selector "my-counter"
export const MyCounter = defineComponent(() => {
  const count = signal(0);
  const template = html`<span>${count()}</span>`;
  return { template };
});

// ❌ THANE400 — default export, cannot derive selector
export default defineComponent(() => {
  const count = signal(0);
  const template = html`<span>${count()}</span>`;
  return { template };
});
```

---

### THANE401 — component-property-order

| | |
|---|---|
| **Severity** | error |
| **Status** | ✔ Implemented |
| **Why** | Enforces a canonical ordering in the return object: `template → styles → onMount → onDestroy`. Consistent ordering makes components scannable and prevents confusion about which lifecycle hooks are present. |

```ts
// ✅ Correct order
return {
  template,
  styles,
  onMount: () => { console.log('mounted'); },
  onDestroy: () => { console.log('destroyed'); },
};

// ❌ THANE401 — "onMount" must be declared before "onDestroy"
return {
  template,
  onDestroy: () => {},
  onMount: () => {},
};

// ❌ THANE401 — "template" must be declared before "styles"
return {
  styles,
  template,
};
```

---

### THANE402 — lifecycle-arrow-function

| | |
|---|---|
| **Severity** | error |
| **Status** | ✔ Implemented |
| **Why** | `onMount` and `onDestroy` must be arrow functions. Method shorthand (`onMount() {}`) and `function()` expressions create their own `this` context and can mask subtle bugs. Arrow functions also align with the `ComponentReturnType` intersection type, which prevents method shorthand from appearing in autocomplete. |

```ts
// ✅ Arrow function
return {
  template,
  onMount: () => {
    console.log('mounted');
  },
};

// ❌ THANE402 — method shorthand
return {
  template,
  onMount() {
    console.log('mounted');
  },
};

// ❌ THANE402 — function expression
return {
  template,
  onMount: function() {
    console.log('mounted');
  },
};

// ❌ THANE402 — non-inline value (variable reference)
const mount = () => console.log('mounted');
return {
  template,
  onMount: mount,
};
```

---

### THANE403 — require-template-property

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | The return object must include a `template` property. Without it the component renders nothing. TypeScript won't catch this because `template` is typed as `string` and the type allows optional properties. |

```ts
// ✅
return { template: html`<div>Hello</div>` };

// ❌ THANE403 — missing template, component renders nothing
return { styles: css`.foo { color: red }` };

// ❌ THANE403 — empty return object
return {};
```

---

### THANE404 — return-object-literal

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | The compiler injects `__bindings` into the return object at compile time via AST transformation. If the return value is a variable or function call instead of an object literal, the injection silently fails and **no reactive bindings work** — signals render their initial value and never update. |

```ts
// ✅ Object literal — compiler can inject __bindings
return { template, styles };

// ❌ THANE404 — variable reference, compiler cannot inject
const result = { template, styles };
return result;

// ❌ THANE404 — function call, compiler cannot inject
return buildComponent();
```

---

### THANE405 — valid-component-selector

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | Custom elements require a hyphenated name (per the HTML spec). The compiler derives the selector from the PascalCase export name by inserting hyphens. A single-word name like `Counter` produces `counter` (no hyphen), which is an invalid custom element name and fails to register. |

```ts
// ✅ PascalCase with multiple words → "my-counter"
export const MyCounter = defineComponent(() => { ... });

// ✅ Explicit valid selector
export const Counter = defineComponent('my-counter', () => { ... });

// ❌ THANE405 — "Counter" → "counter" (no hyphen, invalid)
export const Counter = defineComponent(() => { ... });

// ❌ THANE405 — "APP" → "a-p-p" or similar unexpected result
export const APP = defineComponent(() => { ... });
```

---

### THANE406 — setup-arrow-function

| | |
|---|---|
| **Severity** | warning |
| **Status** | ○ Proposed |
| **Why** | Consistency and `this`-safety. The setup function should be an arrow to match the lifecycle convention and avoid accidental `this` references. |

```ts
// ✅ Arrow function
export const MyComp = defineComponent(() => {
  return { template };
});

// ❌ THANE406 — function expression
export const MyComp = defineComponent(function() {
  return { template };
});
```

---

## 2 · Template Bindings

### THANE410 — signal-call-in-template

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | Signals are functions. Writing `${count}` in a template interpolates the function object itself (renders as `function signal() { ... }` in the DOM). You must call `${count()}` to read the value and create a reactive binding. |

```ts
const count = signal(0);

// ✅ Call the signal — reactive text binding
html`<span>${count()}</span>`

// ❌ THANE410 — interpolates the function object, not the value
html`<span>${count}</span>`
```

**Detection:** In template-tagged literals, check interpolation expressions for identifiers known to be signals that are missing the `()` call.

---

### ~~THANE411 — no-complex-text-binding~~ (REMOVED)

| | |
|---|---|
| **Status** | ✘ Removed — compiler now supports complex text expressions natively |
| **Why removed** | The compiler was updated to detect expression interpolations containing signal calls (e.g. `${count() + 1}`, `${isActive() ? 'Yes' : 'No'}`) and generates a multi-subscribe pattern. Each signal in the expression triggers an update function that re-evaluates the full expression. No runtime changes were needed — only binding detection and codegen were updated. |

```ts
const count = signal(0);
const isActive = signal(false);

// ✅ All of these are now reactive:
html`<span>${count()}</span>`           // bare signal (always worked)
html`<span>${count() + 1}</span>`       // arithmetic expression (NEW)
html`<span>${isActive() ? 'Yes' : 'No'}</span>` // ternary (NEW)
html`<span>${a() + b()}</span>`         // multi-signal expression (NEW)
```

**Generated code pattern for `${count() + 1}`:**
```js
const _upd_b0 = () => { b0.firstChild.nodeValue = count() + 1; };
count.subscribe(_upd_b0, true);
```

---

### THANE412 — no-this-in-template-binding

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | The binding detection regex uses a negative lookbehind `(?<!\.)` that explicitly excludes `this.signalName()` patterns. Using `this.` makes the binding completely invisible to the compiler — no subscription is created, the text node never updates. |

```ts
// ✅ Direct reference — detected by compiler
html`<span>${count()}</span>`

// ❌ THANE412 — this. prefix, invisible to compiler
html`<span>${this.count()}</span>`
```

---

### THANE413 — no-nested-html-template

| | |
|---|---|
| **Severity** | warning |
| **Status** | ○ Proposed |
| **Why** | The compiler processes `html` tagged templates top-down. A nested `html\`...\`` inside another `html\`...\`` is **skipped** — the inner template is not processed for bindings and not precompiled. Bindings inside the inner template will be inert. |

```ts
// ❌ THANE413 — inner html`` is skipped, bindings inside it don't work
html`<div>${html`<span>${count()}</span>`}</div>`

// ✅ Use whenElse or repeat for dynamic sub-templates
html`<div>${whenElse(show(), html`<span>Yes</span>`, html`<span>No</span>`)}</div>`
```

---

## 3 · Event Bindings

### THANE420 — event-handler-expression-required

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | Event handlers must use `${}` interpolation. A bare string like `@click="handleClick"` is treated as a string attribute value, not a handler reference — the handler is never attached and clicks do nothing. |

```ts
// ✅ Interpolation — handler is attached
html`<button @click=${handleClick}>Click</button>`
html`<button @click=${() => count(count() + 1)}>+1</button>`

// ❌ THANE420 — string value, handler is never attached
html`<button @click="handleClick">Click</button>`
```

---

### THANE421 — no-unknown-event-modifier

| | |
|---|---|
| **Severity** | warning |
| **Status** | ○ Proposed |
| **Why** | Unknown event modifiers are silently ignored. A typo like `.pervent` instead of `.prevent` means the modifier has no effect and the developer won't notice. |

**Known modifiers:** `prevent`, `stop`, `self`, `enter`, `tab`, `delete`, `esc`, `escape`, `space`, `up`, `down`, `left`, `right`

```ts
// ✅ Valid modifiers
html`<form @submit.prevent=${handler}>...</form>`
html`<input @keydown.enter=${handler}>`
html`<div @click.stop.self=${handler}>...</div>`

// ❌ THANE421 — "pervent" is a typo, silently ignored
html`<button @click.pervent=${handler}>Submit</button>`

// ❌ THANE421 — "once" is not a supported modifier
html`<button @click.once=${handler}>Click</button>`
```

---

### THANE422 — key-modifier-on-non-keyboard-event

| | |
|---|---|
| **Severity** | warning |
| **Status** | ○ Proposed |
| **Why** | Key modifiers (`enter`, `tab`, `space`, etc.) check `event.key`. On non-keyboard events (`click`, `mouseenter`, `submit`), `event.key` is `undefined`, so the modifier condition always fails and the handler never fires. |

```ts
// ✅ Key modifier on keyboard event
html`<input @keydown.enter=${submitForm}>`

// ❌ THANE422 — .enter on click, handler never fires
html`<button @click.enter=${submitForm}>Submit</button>`

// ❌ THANE422 — .space on mouseenter
html`<div @mouseenter.space=${handler}>Hover</div>`
```

---

## 4 · Conditional Directives

### ~~THANE430 — no-when-on-void-element~~ (REMOVED)

| | |
|---|---|
| **Status** | ✘ Removed — `when()` now works on void elements |
| **Why removed** | The `VoidElement` type was updated to allow `whenDirective`. The runtime's `bindConditional` already handled single-node replacement in a tag-agnostic way — the restriction was purely in the TypeScript type system. Void elements (`img`, `input`, `br`, etc.) can now use `when()` directly without wrapper elements. |

```ts
// ✅ All of these now work:
html`<img "${when(hasImage())}" src="photo.jpg">`
html`<input "${when(showInput())}" type="text">`
html`<br "${when(showBreak())}">`

// ✅ Wrapper no longer needed (but still works)
html`<div "${when(hasImage())}"><img src="photo.jpg"></div>`
```

---

### THANE431 — when-else-argument-count

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | `whenElse()` requires exactly 3 arguments: condition, then-template, else-template. The wrong count causes the compiler to return `null` and the directive is silently ignored — nothing renders. |

```ts
// ✅ Exactly 3 arguments
${whenElse(isLoggedIn(), html`<span>Welcome</span>`, html`<span>Login</span>`)}

// ❌ THANE431 — only 2 arguments
${whenElse(isLoggedIn(), html`<span>Welcome</span>`)}

// ❌ THANE431 — 4 arguments
${whenElse(isLoggedIn(), html`<span>A</span>`, html`<span>B</span>`, html`<span>C</span>`)}
```

---

### THANE432 — when-else-inline-templates

| | |
|---|---|
| **Severity** | error |
| **Status** | ◈ Under discussion |
| **Why** | The compiler extracts `whenElse()` template arguments at compile time via text-based regex matching. Only inline template literals (`` html`...` `` or `` `...` ``) are detected. Variable references like `yesTemplate` fall through and are treated as raw HTML strings — they render the variable name literally. |

```ts
// ✅ Inline template literals — compiler extracts content
${whenElse(show(), html`<div>Yes</div>`, html`<div>No</div>`)}

// ❌ THANE432 — variable references, compiler can't extract
const yesTemplate = html`<div>Yes</div>`;
const noTemplate = html`<div>No</div>`;
${whenElse(show(), yesTemplate, noTemplate)}
// ^ Renders the string "yesTemplate" literally
```

> **Note:** This rule is under discussion. An AST pre-pass may be added to resolve
> `const` variable references to their template literal values before HTML processing.
> See [Discussion: THANE432](#discussion-thane432) below.

---

### THANE433 — when-directive-placement

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | `when()` must be a standalone attribute on an element. When placed inside another attribute value (e.g., `class="${when(...)}"`) it's treated as a string interpolation and has no conditional rendering effect. |

```ts
// ✅ Standalone attribute
html`<div "${when(isVisible())}">Content</div>`

// ❌ THANE433 — inside class attribute value
html`<div class="${when(isVisible())}">Content</div>`

// ❌ THANE433 — inside data attribute
html`<div data-show="${when(isVisible())}">Content</div>`
```

---

## 5 · Repeat Directive

### THANE440 — repeat-template-arrow-function

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | The compiler statically analyzes `repeat()` and extracts the template from the 2nd argument. It only handles arrow function expressions. A regular `function` expression, variable reference, or method reference causes the compiler to return `null` — the repeat is silently ignored and nothing renders. |

```ts
// ✅ Arrow function — compiler can extract template
${repeat(items(), (item) => html`<li>${item.name}</li>`)}

// ❌ THANE440 — function expression, silently ignored
${repeat(items(), function(item) { return html`<li>${item.name}</li>` })}

// ❌ THANE440 — variable reference, silently ignored
const renderItem = (item) => html`<li>${item.name}</li>`;
${repeat(items(), renderItem)}
```

---

### THANE441 — repeat-single-root-element

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | Repeat item templates **must have exactly one root element**. Multiple roots trigger a compiler error and fall back to unoptimized string-based rendering. The reconciler also assumes a single root node per item for efficient DOM diffing. |

```ts
// ✅ Single root element
${repeat(items(), (item) => html`
  <div class="item">
    <span>${item.id}</span>
    <span>${item.name}</span>
  </div>
`)}

// ❌ THANE441 — multiple root elements
${repeat(items(), (item) => html`
  <span>${item.id}</span>
  <span>${item.name}</span>
`)}
```

---

### THANE442 — repeat-argument-count

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | `repeat()` accepts 2–4 arguments. Fewer or more is always a mistake. |

**Arguments:**
1. `items` — the signal/array to iterate
2. `template` — arrow function returning the item template
3. `emptyTemplate` (optional) — template to show when items is empty
4. `trackBy` (optional) — key function for efficient reconciliation

```ts
// ✅ 2 args
${repeat(items(), (item) => html`<li>${item.name}</li>`)}

// ✅ 3 args (with empty template)
${repeat(items(), (item) => html`<li>${item.name}</li>`, html`<p>No items</p>`)}

// ✅ 4 args (with trackBy)
${repeat(items(), (item) => html`<li>${item.name}</li>`, null, (item) => item.id)}

// ❌ THANE442 — only 1 argument
${repeat(items())}

// ❌ THANE442 — 5 arguments
${repeat(items(), fn, null, keyFn, extraArg)}
```

---

### THANE443 — repeat-track-by-arrow-function

| | |
|---|---|
| **Severity** | warning |
| **Status** | ○ Proposed |
| **Why** | The `trackBy` function (4th argument) must be an arrow function for the compiler to statically analyze it. A variable reference or regular function triggers a fallback to index-based tracking. |

```ts
// ✅ Arrow function
${repeat(items(), (item) => html`<li>${item.name}</li>`, null, (item) => item.id)}

// ❌ THANE443 — variable reference, falls back to index tracking
${repeat(items(), (item) => html`<li>${item.name}</li>`, null, getItemId)}
```

---

## 6 · Signal Usage

### THANE450 — signal-static-initial-value

| | |
|---|---|
| **Severity** | info |
| **Status** | ○ Proposed |
| **Why** | When a signal's initial value is a static literal (`0`, `'hello'`, `true`), the compiler can render the initial template at compile time — the user sees content immediately without waiting for JavaScript. Dynamic initializers (arrays, objects, function calls) prevent this optimization, causing a flash of empty content. |

```ts
// ✅ Static literal — compile-time rendering
const count = signal(0);
const name = signal('World');
const visible = signal(true);

// ⚠ THANE450 — prevents compile-time rendering
const items = signal([]);
const config = signal({ theme: 'dark' });
const value = signal(getInitialValue());
```

> This is informational. The code works correctly — performance is just suboptimal.

---

## 7 · HTML Template Structure

### THANE460 — no-conflicting-bind-ids

| | |
|---|---|
| **Severity** | warning |
| **Status** | ◈ Under discussion |
| **Why** | The compiler generates `id` attributes for binding targets using patterns like `b0`, `b1` (bindings), `e0`, `e1` (events), `i0`, `i1` (item bindings). User-authored IDs matching these patterns cause complex and context-dependent failures. |

**Conflict behavior by context:**

| Context | What happens |
|---------|-------------|
| Normal text/style bindings | Compiler skips ID injection → `getElementById` finds nothing → binding silently fails |
| Event bindings | Compiler reuses user ID → events attach correctly |
| `when()` conditional root | Compiler injects its own ID first → user ID is ignored |
| `repeat()` items | Compiler uses `data-bind-id` fallback → dual-lookup works correctly |

```ts
// ✅ User IDs that don't conflict
html`<div id="counter-display">${count()}</div>`
html`<button id="submit-btn" @click=${handler}>Go</button>`

// ❌ THANE460 — matches compiler binding ID pattern
html`<div id="b0">${count()}</div>`
html`<span id="i1">${item.name}</span>`
html`<button id="e0" @click=${handler}>Click</button>`
```

> **Note:** This rule is under discussion. The compiler's ID handling may be
> unified to use the `data-bind-id` fallback pattern universally, which would
> eliminate all conflicts. See [Discussion: THANE460](#discussion-thane460) below.

---

### THANE461 — void-element-no-children

| | |
|---|---|
| **Severity** | warning |
| **Status** | ○ Proposed |
| **Why** | Void elements (`br`, `img`, `input`, `hr`, etc.) cannot have children per the HTML spec. The parser handles this but content placed after a void element's opening tag (before an attempted closing tag) is silently dropped or misparented. |

```html
<!-- ✅ Correct void element usage -->
<img src="photo.jpg">
<br>
<input type="text">

<!-- ❌ THANE461 — content is silently dropped -->
<img src="photo.jpg">Text after img</img>
<br>Content after br</br>
```

---

## 8 · Route Definitions

### THANE470 — route-component-module-format

| | |
|---|---|
| **Severity** | error |
| **Status** | ○ Proposed |
| **Why** | The routes precompiler expects `componentModule` to be an arrow function wrapping a dynamic `import()`. This pattern is required for: (1) lazy loading (code splitting), and (2) automatic component selector injection. Any other pattern prevents the precompiler from finding and injecting the selector. |

```ts
// ✅ Arrow function with dynamic import
{
  path: '/dashboard',
  componentModule: () => import('./pages/Dashboard.js'),
}

// ❌ THANE470 — eager import, no lazy loading
{
  path: '/dashboard',
  componentModule: import('./pages/Dashboard.js'),
}

// ❌ THANE470 — variable reference, precompiler can't analyze
{
  path: '/dashboard',
  componentModule: loadDashboard,
}
```

---

## 9 · Performance & Optimization

### THANE480 — prefer-optimized-repeat

| | |
|---|---|
| **Severity** | info |
| **Status** | ○ Proposed |
| **Why** | The `repeat()` directive has two rendering paths: an optimized template-based path (efficient DOM cloning + targeted binding updates) and a slower string-based fallback. Certain patterns force the fallback. This rule warns when the optimized path cannot be used and explains why. |

**Fallback triggers:**

| Pattern | Why it falls back | Suggested fix |
|---------|-------------------|---------------|
| Component signals in item bindings | Can't be batch-updated per item | Move data into the item object |
| Nested `repeat()` inside items | Inner repeat requires independent lifecycle | Accept fallback (info only) |
| `when()`/`whenElse()` inside items | Conditional nodes can't be template-cloned | Move conditional outside, or accept fallback |
| Multiple root elements | Reconciler assumes single root per item | Wrap in a container element |

```ts
// ✅ Optimized path — only item data in bindings
${repeat(items(), (item) => html`
  <div class="item">
    <span>${item.name}</span>
    <span>${item.price}</span>
  </div>
`)}

// ⚠ THANE480 — component signal forces fallback
const currency = signal('USD');
${repeat(items(), (item) => html`
  <div class="item">
    <span>${item.price} ${currency()}</span>
  </div>
`)}
// Fix: include currency in item data instead
```

---

## Discussion Notes

These rules are marked ◈ and are under active investigation. The discussions below
summarize the research findings and possible compiler changes.

### Discussion: THANE411

**Status: RESOLVED** — Compiler updated to support complex text expressions natively.
The multi-subscribe codegen pattern was implemented. THANE411 lint rule removed.

### Discussion: THANE430

**Status: RESOLVED** — `VoidElement` type restriction removed. `when()` works on all elements.
THANE430 lint rule removed.

### Discussion: THANE432

**Topic:** Can `whenElse()` accept variable references for templates?

See the dedicated discussion. Key finding: an AST pre-pass (~50-80 lines) before HTML
processing could resolve `const` declarations to their literal template values. Works for
same-scope `const` declarations with template literal initializers.

### Discussion: THANE460

**Topic:** How do user-set IDs interact with compiler-generated binding IDs?

See the dedicated discussion. Key finding: behavior varies by context (some silently break,
some work fine). The `data-bind-id` fallback pattern used by repeat items is the proven fix
and could be extended universally.
