# Thane Lint Rules Proposal

> Candidate rules that enforce patterns the TypeScript type system **cannot** catch.
> Each rule includes the error code, what it catches, and ✅ / ❌ examples.
> Existing rules (already implemented) are marked with ✔ IMPLEMENTED.

---

## 1. Component Structure

### THANE400 — no-default-export-component ✔ IMPLEMENTED

`defineComponent()` must use a named `export const` — the compiler auto-derives the CSS selector from the export name.

```ts
// ✅
export const MyCounter = defineComponent(() => { ... });

// ❌ THANE400 — cannot derive selector
export default defineComponent(() => { ... });
```

---

### THANE401 — component-property-order ✔ IMPLEMENTED

The return object must follow the canonical order: `template → styles → onMount → onDestroy`.

```ts
// ✅
return { template, styles, onMount: () => {}, onDestroy: () => {} };

// ❌ THANE401 — onMount must be declared before onDestroy
return { template, onDestroy: () => {}, onMount: () => {} };
```

---

### THANE402 — lifecycle-arrow-function ✔ IMPLEMENTED

`onMount` and `onDestroy` must be arrow functions — not method shorthand or `function()` expressions.

```ts
// ✅
return { template, onMount: () => { ... } };

// ❌ THANE402 — method shorthand
return { template, onMount() { ... } };

// ❌ THANE402 — function expression
return { template, onMount: function() { ... } };
```

---

### THANE403 — require-template-property

The `defineComponent` return object **must** include a `template` property. Without it the component renders nothing and there's no type error because `template` is just a `string`.

```ts
// ✅
return { template: html`<div>Hello</div>` };

// ❌ THANE403 — no template property
return { styles: css`.foo { color: red }` };
```

---

### THANE404 — return-object-literal

The setup function must return an **object literal** directly (not a variable or function call). The compiler injects `__bindings` into the return object at compile time — if it's not a literal, injection fails silently and no reactive bindings work.

```ts
// ✅
return { template, styles };

// ❌ THANE404 — compiler cannot inject __bindings
const result = { template, styles };
return result;

// ❌ THANE404
return buildComponent();
```

---

### THANE405 — valid-component-selector

Auto-derived or explicit component selectors must be valid custom element names (lowercase, must contain a hyphen). A PascalCase export name like `MyCounter` correctly derives `my-counter`, but a single-word name like `Counter` would derive `counter` (no hyphen — invalid).

```ts
// ✅ derives "my-counter"
export const MyCounter = defineComponent(() => { ... });

// ❌ THANE405 — derives "counter" (no hyphen)
export const Counter = defineComponent(() => { ... });

// ✅ explicit selector is valid
export const Counter = defineComponent('my-counter', () => { ... });
```

---

### THANE406 — setup-arrow-function

The setup function passed to `defineComponent()` should be an arrow function for consistency and to avoid `this` binding issues.

```ts
// ✅
export const MyComp = defineComponent(() => { return { template }; });

// ❌ THANE406 — function expression
export const MyComp = defineComponent(function() { return { template }; });
```

---

## 2. Template Bindings

### THANE410 — signal-call-in-template

Signal references in templates **must** include `()` to create a reactive binding. Without the call, the function object itself is rendered (shows `function signal() { ... }` in the DOM), and no reactivity is established.

```ts
const count = signal(0);

// ✅ reactive text binding
html`<span>${count()}</span>`

// ❌ THANE410 — renders function object, not reactive
html`<span>${count}</span>`
```

---

### THANE411 — no-complex-text-binding

Text bindings (in non-repeat contexts) only support bare `signalName()` calls. Complex expressions like ternaries or arithmetic in text position are **not detected** as reactive bindings — they render once and never update.

```ts
// ✅ bare signal call — reactive
html`<span>${count()}</span>`

// ❌ THANE411 — not reactive, renders once
html`<span>${count() + 1}</span>`
html`<span>${isActive() ? 'Yes' : 'No'}</span>`

// ✅ use a computed signal instead
const display = signal('');
// update display when count changes
html`<span>${display()}</span>`
```

---

### THANE412 — no-this-in-template-binding

Signal calls in templates must not use `this.` prefix — the binding detection regex uses a negative lookbehind that explicitly excludes `this.signalName()` patterns. Using `this.` makes the binding invisible to the compiler.

```ts
// ✅
html`<span>${count()}</span>`

// ❌ THANE412 — invisible to binding compiler
html`<span>${this.count()}</span>`
```

---

### THANE413 — no-nested-html-template

Nested `html` tagged templates (an `html\`...\`` inside another `html\`...\``) are **skipped** by the compiler. The inner template is not processed for bindings and not precompiled. This is almost always a mistake — use `${...}` interpolation for dynamic content instead.

```ts
// ❌ THANE413 — inner html`` is skipped by compiler
html`<div>${html`<span>${count()}</span>`}</div>`

// ✅ use repeat/whenElse for dynamic content
html`<div>${whenElse(show(), html`<span>Yes</span>`, html`<span>No</span>`)}</div>`
```

---

## 3. Event Bindings

### THANE420 — event-handler-expression-required

Event handlers **must** use `${}` interpolation syntax. A bare string handler like `@click="handleClick"` is silently ignored — the handler is never attached.

```ts
// ✅
html`<button @click=${handleClick}>Click</button>`
html`<button @click=${() => count(count() + 1)}>+1</button>`

// ❌ THANE420 — silently ignored, no handler attached
html`<button @click="handleClick">Click</button>`
```

---

### THANE421 — no-unknown-event-modifier

Event modifiers must be one of the known set. Unknown modifiers are **silently ignored**, which can mask typos.

**Known modifiers:** `prevent`, `stop`, `self`, `enter`, `tab`, `delete`, `esc`, `escape`, `space`, `up`, `down`, `left`, `right`

```ts
// ✅
html`<button @click.prevent=${handler}>Submit</button>`
html`<input @keydown.enter=${handler}>`

// ❌ THANE421 — "pervent" is silently ignored (typo)
html`<button @click.pervent=${handler}>Submit</button>`

// ❌ THANE421 — "once" is not a supported modifier
html`<button @click.once=${handler}>Click</button>`
```

---

### THANE422 — key-modifier-on-non-keyboard-event

Key modifiers (`enter`, `tab`, `space`, `esc`, `up`, `down`, `left`, `right`, `delete`) on non-keyboard events (`click`, `mouseenter`, `submit`, etc.) do nothing — the condition `e.key !== 'Enter'` always passes because mouse/pointer events don't have a `key` property.

```ts
// ✅ key modifier on keyboard event
html`<input @keydown.enter=${submitForm}>`

// ❌ THANE422 — enter modifier on click event does nothing
html`<button @click.enter=${submitForm}>Submit</button>`
```

---

## 4. Conditional Directives

### THANE430 — no-when-on-void-element

The `when()` directive hides/shows an element by swapping it with a comment placeholder. This requires the element to have a closing tag. Void elements (`br`, `img`, `input`, `hr`, `meta`, `link`, `area`, `base`, `col`, `embed`, `param`, `source`, `track`, `wbr`) cannot use `when()` — it silently breaks because the compiler can't determine the element's content range.

```ts
// ✅ when on a container element
html`<div "${when(isVisible())}">Content</div>`

// ❌ THANE430 — void element, breaks silently
html`<img "${when(hasImage())}" src="photo.jpg">`
html`<input "${when(showInput())}" type="text">`

// ✅ wrap in a container instead
html`<div "${when(hasImage())}"><img src="photo.jpg"></div>`
```

---

### THANE431 — when-else-argument-count

`whenElse()` requires **exactly 3 arguments**: condition, then-template, else-template. If the count is wrong, the compiler returns `null` and the directive is silently ignored.

```ts
// ✅ exactly 3 arguments
${whenElse(isLoggedIn(), html`<span>Welcome</span>`, html`<span>Login</span>`)}

// ❌ THANE431 — only 2 arguments
${whenElse(isLoggedIn(), html`<span>Welcome</span>`)}

// ❌ THANE431 — 4 arguments
${whenElse(isLoggedIn(), html`<span>A</span>`, html`<span>B</span>`, html`<span>C</span>`)}
```

---

### THANE432 — when-else-inline-templates

`whenElse()` template arguments must be **inline template literals** (`` html`...` `` or plain `` `...` ``). Variable references are not supported — the compiler needs to extract and process the template content at compile time.

```ts
// ✅ inline templates
${whenElse(show(), html`<div>Yes</div>`, html`<div>No</div>`)}

// ❌ THANE432 — variable references, compiler can't extract templates
const yesTemplate = html`<div>Yes</div>`;
${whenElse(show(), yesTemplate, noTemplate)}
```

---

### THANE433 — when-directive-placement

`when()` must be a **standalone attribute** on an element, not inside another attribute value. When placed inside an attribute value, it's treated as a string expression and has no conditional rendering effect.

```ts
// ✅ standalone attribute
html`<div "${when(isVisible())}">Content</div>`

// ❌ THANE433 — inside class attribute, no conditional effect
html`<div class="${when(isVisible())}">Content</div>`
```

---

## 5. Repeat Directive

### THANE440 — repeat-template-arrow-function

The `repeat()` template argument (2nd arg) **must** be an arrow function. If it's a regular function or a variable reference, the compiler returns `null` and the repeat is silently ignored.

```ts
// ✅ arrow function
${repeat(items(), (item) => html`<div>${item.name}</div>`)}

// ❌ THANE440 — function expression, silently ignored
${repeat(items(), function(item) { return html`<div>${item.name}</div>` })}

// ❌ THANE440 — variable reference, silently ignored
${repeat(items(), renderItem)}
```

---

### THANE441 — repeat-single-root-element

Repeat item templates **must have exactly one root element**. Multiple root elements cause an error from the compiler and fall back to unoptimized rendering.

```ts
// ✅ single root
${repeat(items(), (item) => html`
  <div>
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

`repeat()` accepts 2 to 4 arguments. Fewer or more is always a mistake.

```ts
// ✅ 2 args (items, template)
${repeat(items(), (item) => html`<li>${item.name}</li>`)}

// ✅ 3 args (items, template, emptyTemplate)
${repeat(items(), (item) => html`<li>${item.name}</li>`, html`<p>No items</p>`)}

// ✅ 4 args (items, template, emptyTemplate, trackBy)
${repeat(items(), (item) => html`<li>${item.name}</li>`, null, (item) => item.id)}

// ❌ THANE442 — only 1 argument
${repeat(items())}

// ❌ THANE442 — 5 arguments
${repeat(items(), (item) => html`...`, null, (item) => item.id, extraArg)}
```

---

### THANE443 — repeat-track-by-arrow-function

The `trackBy` function (4th argument to `repeat()`) must be an arrow function. A regular function or variable reference causes a fallback warning.

```ts
// ✅ arrow function
${repeat(items(), (item) => html`<li>${item.name}</li>`, null, (item) => item.id)}

// ❌ THANE443 — not an arrow function
${repeat(items(), (item) => html`<li>${item.name}</li>`, null, getItemId)}
```

---

## 6. Signal Usage

### THANE450 — signal-static-initial-value

`signal()` initializers used in templates benefit from compile-time rendering when the initial value is a **static literal** (string, number, boolean). Dynamic values (arrays, objects, function calls) cause the initial template render to use `undefined`/empty — the user sees a flash of empty content before the first signal update.

```ts
// ✅ static literal — compile-time rendering works
const count = signal(0);
const name = signal('World');
const visible = signal(true);

// ⚠ THANE450 — initial template render will show empty/undefined
const items = signal([]);
const config = signal({ theme: 'dark' });
const value = signal(getInitialValue());
```

> **Severity:** Warning (info). Not an error — the code works, but DX/perf could be better.

---

## 7. HTML Template Structure

### THANE460 — no-conflicting-bind-ids

The compiler generates `id` attributes with patterns like `b0`, `b1`, `i0`, `e0` for binding targets. User-authored `id` attributes matching these patterns may conflict and cause bindings to target wrong elements.

```ts
// ✅ user IDs that don't conflict
html`<div id="counter">...</div>`

// ❌ THANE460 — conflicts with compiler-generated binding IDs
html`<div id="b0">...</div>`
html`<span id="i1">...</span>`
html`<button id="e0">Click</button>`
```

---

### THANE461 — void-element-no-children

Void elements (`br`, `img`, `input`, etc.) cannot have children in HTML. The Thane parser handles this but content inside void elements is silently dropped.

```html
<!-- ✅ -->
<img src="photo.jpg">
<br>
<input type="text">

<!-- ❌ THANE461 — content silently dropped -->
<img src="photo.jpg">Some text</img>
<br>Line break content</br>
```

---

## 8. Route Definitions

### THANE470 — route-component-module-format

Route `componentModule` must be an arrow function containing a dynamic `import()`. Other patterns prevent the routes precompiler from auto-injecting the component selector.

```ts
// ✅
{
  path: '/dashboard',
  componentModule: () => import('./pages/Dashboard.js'),
}

// ❌ THANE470 — not a dynamic import arrow function
{
  path: '/dashboard',
  componentModule: import('./pages/Dashboard.js'), // eager, not lazy
}

// ❌ THANE470
{
  path: '/dashboard',
  componentModule: loadDashboard, // variable reference
}
```

---

## 9. Performance & Optimization Hints

> These are **warnings/info** level — the code works but performance is suboptimal.

### THANE480 — prefer-optimized-repeat

Warn when a `repeat()` block would fall back from the optimized template-based path to the slower string-based path, with a specific reason.

| Fallback Reason | User Action |
|----------------|-------------|
| Component signals used in item bindings | Move data to item object |
| Nested `repeat()` inside repeat items | Accepted, info only |
| `when()`/`whenElse()` inside repeat items | Move conditional outside or accept fallback |
| Multiple root elements in item template | Wrap in a single root container |

---

### THANE481 — key-modifier-on-mouse-event

(Same as THANE422 — listed here as it's also a performance/correctness hint.)

---

## Summary Table

| Code | Name | Severity | Category |
|------|------|----------|----------|
| **THANE400** | no-default-export-component | error | Component ✔ |
| **THANE401** | component-property-order | error | Component ✔ |
| **THANE402** | lifecycle-arrow-function | error | Component ✔ |
| **THANE403** | require-template-property | error | Component |
| **THANE404** | return-object-literal | error | Component |
| **THANE405** | valid-component-selector | error | Component |
| **THANE406** | setup-arrow-function | warning | Component |
| **THANE410** | signal-call-in-template | error | Bindings |
| **THANE411** | no-complex-text-binding | warning | Bindings |
| **THANE412** | no-this-in-template-binding | error | Bindings |
| **THANE413** | no-nested-html-template | warning | Bindings |
| **THANE420** | event-handler-expression-required | error | Events |
| **THANE421** | no-unknown-event-modifier | warning | Events |
| **THANE422** | key-modifier-on-non-keyboard-event | warning | Events |
| **THANE430** | no-when-on-void-element | error | Conditionals |
| **THANE431** | when-else-argument-count | error | Conditionals |
| **THANE432** | when-else-inline-templates | error | Conditionals |
| **THANE433** | when-directive-placement | error | Conditionals |
| **THANE440** | repeat-template-arrow-function | error | Repeat |
| **THANE441** | repeat-single-root-element | error | Repeat |
| **THANE442** | repeat-argument-count | error | Repeat |
| **THANE443** | repeat-track-by-arrow-function | warning | Repeat |
| **THANE450** | signal-static-initial-value | info | Signals |
| **THANE460** | no-conflicting-bind-ids | warning | HTML |
| **THANE461** | void-element-no-children | warning | HTML |
| **THANE470** | route-component-module-format | error | Routes |
| **THANE480** | prefer-optimized-repeat | info | Performance |
