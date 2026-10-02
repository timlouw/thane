# Lint Rules

Thane includes 12 compile-time lint rules (THANE400–THANE416; THANE401, THANE402, THANE406, THANE407 and THANE410 are retired) that catch patterns the compiler cannot process correctly. These rules run during `thane dev` and `thane build` — errors prevent the build from completing, warnings are displayed but don't block.

The compiler reports a few more problems itself, while it compiles a template: see [Template Errors](#template-errors).

A project sets the severity of any rule, or turns it off, with `lint` in `thane.config.json`:
`"lint": { "THANE405": "off" }` ([Lint Severities](cli.md#lint-severities)).

## Summary

| Code     | Rule                                                                        | Severity |
| :------- | :-------------------------------------------------------------------------- | :------- |
| THANE400 | [no-default-export-component](#thane400--no-default-export-component)       | Error    |
| THANE403 | [require-const-tagged-templates](#thane403--require-const-tagged-templates) | Error    |
| THANE404 | [no-nested-html-tags](#thane404--no-nested-html-tags)                       | Error    |
| THANE405 | [no-conditional-template-init](#thane405--no-conditional-template-init)     | Warning  |
| THANE408 | [component-const-declaration](#thane408--component-const-declaration)       | Error    |
| THANE409 | [no-aliased-component-export](#thane409--no-aliased-component-export)       | Error    |
| THANE411 | [duplicate-mount-target](#thane411--duplicate-mount-target)                 | Warning  |
| THANE412 | [single-return-object](#thane412--single-return-object)                     | Error    |
| THANE413 | [no-aliased-thane-import](#thane413--no-aliased-thane-import)               | Error    |
| THANE414 | [no-uncalled-signal](#thane414--no-uncalled-signal)                         | Error    |
| THANE415 | [no-unknown-component-key](#thane415--no-unknown-component-key)             | Error    |
| THANE416 | [no-signal-snapshot-prop](#thane416--no-signal-snapshot-prop)               | Warning  |

---

## THANE400 — no-default-export-component

**Severity:** Error

Components must use **named exports**, not default exports. The compiler auto-derives the CSS selector from the export name.

```typescript
// ❌ BAD — default export, no name for the compiler
export default defineComponent(() => ({
  template: html`<div>Hello</div>`,
}));

// ✅ GOOD — named export, selector derived as "my-counter"
export const MyCounter = defineComponent(() => ({
  template: html`<div>Hello</div>`,
}));
```

---

## THANE401 — retired

THANE401 (component-property-order) required the return object's properties in the order template, styles,
onMount, onDestroy. The compiler reads them by name, so their order never mattered. The code is not reused.

---

## THANE402 — retired

THANE402 (lifecycle-arrow-function) required hooks written as arrow functions. Nothing in a hook uses `this`,
so a hook may be a method (`onMount() {…}`), a function expression, an arrow function or a reference to a
function (`onMount: start`, `{ onDestroy }`). The code is not reused.

---

## THANE403 — require-const-tagged-templates

**Severity:** Error

`html` and `css` tagged templates must use `const` declarations. Using `let`/`var` makes values opaque to the compiler's template processing pipeline.

```typescript
// ❌ BAD
let header = html`<header>Title</header>`;
var styles = css`
  :host {
    color: red;
  }
`;

// ✅ GOOD
const header = html`<header>Title</header>`;
const styles = css`
  :host {
    color: red;
  }
`;
```

---

## THANE404 — no-nested-html-tags

**Severity:** Error

An `html` template inside another is compiled where it is the whole `${…}` (it is inlined), an argument of a
directive (a `when()` branch, a `repeat()` row or its `empty` template), or a branch of a ternary, an `&&` or a
`.map()` row in content (each is compiled as the directive it means; see
[JavaScript Control Flow](templates.md#javascript-control-flow)). Anywhere else, such as an argument of your own
function or an attribute's value, it would be a plain value, and it is reported. The compiler also stops at a
ternary in content with a template on one side and text on the other.

```typescript
// ❌ BAD — a template passed to a function, and a ternary of a template and text
template: html`<div>${wrap(html`<p>Open</p>`)}</div>`;
template: html`<div>${open() ? html`<p>Open</p>` : 'closed'}</div>`;

// ✅ GOOD — control flow or a directive chooses, or repeats
template: html`<div>${open() ? html`<p>Open</p>` : html`<p>Closed</p>`}</div>`;
template: html`<ul>${items().map((i) => html`<li>${i}</li>`)}</ul>`;
template: html`<div>${when(open(), html`<p>Open</p>`)}</div>`;

// ✅ GOOD — a whole ${…} is inlined, like a const fragment
template: html`<div>${html`<span>nested</span>`}</div>`;
```

---

## THANE405 — no-conditional-template-init

**Severity:** Warning

Variables holding `html`/`css` templates must not use conditional or logical initializers. The compiler cannot determine which branch is taken at build time.

```typescript
// ❌ BAD — ternary
const tpl = isAdmin ? html`<div>Admin</div>` : html`<div>User</div>`;

// ❌ BAD — logical AND
const tpl = show && html`<div>Content</div>`;

// ✅ GOOD — when() in the template chooses
template: html`<div>${when(isAdmin(), html`<p>Admin</p>`, html`<p>User</p>`)}</div>`;
```

---

## THANE406 — retired

THANE406 (no-element-id) reported element ids of the form `b` followed by digits, which could collide
with the ids the compiler generated. Compiled code no longer uses ids to find anything, so any id is
the developer's own. The code is not reused.

---

## THANE407 — retired

THANE407 (single-component-per-file) allowed one `defineComponent()` call per file, because the compiler
compiled only the first. Each component of a file is now compiled on its own (see
[Components](components.md#several-components-in-one-file)). The code is not reused.

---

## THANE408 — component-const-declaration

**Severity:** Error

Components must be declared with `const`. Using `let` or `var` allows reassignment, which breaks the compiler's static analysis and can cause selector collisions.

```typescript
// ❌ BAD
export let MyCounter = defineComponent(() => { ... });
export var MyCounter = defineComponent(() => { ... });

// ✅ GOOD
export const MyCounter = defineComponent(() => { ... });
```

---

## THANE409 — no-aliased-component-export

**Severity:** Error

A component is exported where it is declared, under the name it is declared under. The compiler derives the
selector from that name, so an export under another name, or a separate `export { … }` of a local component,
would name it differently from its selector.

```typescript
// ❌ BAD — aliased export
const _Internal = defineComponent(() => { ... });
export { _Internal as MyCounter };

// ✅ GOOD — direct named export
export const MyCounter = defineComponent(() => { ... });

// ✅ GOOD — a re-export of a component declared in another file (a barrel)
export { MyCounter } from './counter.js';
```

---

## THANE410 — retired

THANE410 (no-cross-file-html-template) warned about an imported variable used in an `html` template, because
the compiler could not see an imported template. A template can now use a fragment another module exports
(see [Templates](templates.md#fragments)). The code is not reused.

---

## THANE411 — duplicate-mount-target

**Severity:** Warning

Detects multiple `mount()` calls targeting the same element or using the same default target (`document.body`). Duplicate mounts cause binding collisions.

```typescript
// ❌ BAD — two default mounts (both target document.body)
mount({ component: App });
mount({ component: Other });

// ❌ BAD — same explicit target
const el = document.getElementById('root')!;
mount({ component: App, target: el });
mount({ component: Other, target: el });

// ✅ GOOD — different targets
mount({ component: App, target: document.getElementById('app')! });
mount({ component: Nav, target: document.getElementById('nav')! });
```

---

## THANE412 — single-return-object

**Severity:** Error

A component's setup function returns **one object**. The compiler builds one static template per component, from the last object returned, so an earlier `return` would render the same template and lose its own hooks and styles. Returns inside nested functions (callbacks, helpers) are not counted.

```typescript
// ❌ BAD — an early return with its own template
export const Card = defineComponent(() => {
  const ready = signal(false);
  if (!ready()) return { template: html`<p>Loading…</p>` };
  return { template: html`<p>Ready</p>` };
});

// ✅ GOOD — one return object; the template chooses
export const Card = defineComponent(() => {
  const ready = signal(false);
  return {
    template: html`${when(ready(), html`<p>Ready</p>`, html`<p>Loading…</p>`)}`,
  };
});
```

---

## THANE413 — no-aliased-thane-import

**Severity:** Error

The compiler finds the template markers (`html`, `css`, `when`, `repeat`) and `defineComponent` by their names. Import them from `thane` under those names: a renamed import, or one read through a namespace import, is never compiled.

```typescript
// ❌ BAD — renamed: h`…` is not compiled
import { defineComponent, html as h } from 'thane';

// ❌ BAD — read through a namespace import
import * as thane from 'thane';
export const App = thane.defineComponent(() => ({ template: thane.html`<p>Hi</p>` }));

// ✅ GOOD — imported under their own names
import { defineComponent, html } from 'thane';
export const App = defineComponent(() => ({ template: html`<p>Hi</p>` }));
```

---

## THANE414 — no-uncalled-signal

**Severity:** Error

A signal in a template is read by calling it. Without the call the template gets the signal function itself: in
content and attributes that shows the function's source code, in an event slot the signal is called with the
event and set to it, and `when()` and `repeat()` would get a function, which is always truthy and lists nothing.

```typescript
// ❌ BAD
template: html`<p class=${theme}>${count}</p>`;
template: html`<input @input=${query} />`;
template: html`<p ${when(open)}>…</p>`;

// ✅ GOOD
template: html`<p class=${theme()}>${count()}</p>`;
template: html`<input @input=${(e) => query(e.currentTarget.value)} />`;
template: html`<p ${when(open())}>…</p>`;
```

It reports a name the file declares as `signal(…)` or `computed(…)`, in the scope the template reads it from: a row's
parameter or a local of the same name is not the signal. A signal imported from another module is not visible to
it; the type check reports that one, since a function is not a value a template shows.

---

## THANE415 — no-unknown-component-key

**Severity:** Error

A setup function returns `template`, `styles`, `onMount` and `onDestroy`, and nothing reads any other key. TypeScript
does not report one (an object literal returned from a callback gets no excess-property check), so a misspelled
hook would never run. The message names the key it is close to.

```typescript
// ❌ BAD — 'onMoun' is not a key of a component, and nothing reads it: did you mean 'onMount'?
return { template: html`<canvas></canvas>`, onMoun: () => start() };

// ✅ GOOD
return { template: html`<canvas></canvas>`, onMount: () => start() };
```

---

## THANE416 — no-signal-snapshot-prop

**Severity:** Warning

A component reads its props once, when it mounts. A prop whose value reads a signal passes the value the signal
has then, and the child never sees it change. Pass the signal itself, typed `ReadonlySignal` in the child's props,
and read it in the child's template.

```typescript
// ⚠ the count when Badge mounts
template: html`${Badge({ count: count() })}`;

// ✅ Badge reads the signal: ${props.count()}
template: html`${Badge({ count })}`;
export const Badge = defineComponent<{ count: ReadonlySignal<number> }>(({ props }) => ({
  template: html`<b>${props.count()}</b>`,
}));
```

A read inside a function (`onPick: () => select(count())`) is not reported: the function reads the signal when it
runs. A value read from a list row's item is not a snapshot either: when the row's item changes, a child whose props
changed is mounted again with them (see [Child Components in Repeat](directives/repeat.md#child-components-in-repeat)).
When a snapshot is what you want, turn the rule off with `lint` in `thane.config.json`.

---

## Template Errors

These are reported by the compiler while it compiles a template, as build errors. THANE013 is a warning.

| Code     | What it reports                                                                                                                                                                                                                               |
| :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| THANE006 | An attribute written with a `:` prefix (`:src=${url()}`). Write `src=${url()}` instead                                                                                                                                                        |
| THANE007 | A `repeat()` row template without exactly one root element, including a row that is only a directive                                                                                                                                          |
| THANE008 | A `when()` on the root element of a `repeat()` row. Filter the list, or put `when()` on an inner element                                                                                                                                      |
| THANE009 | A template the compiler cannot bind reliably: markup the browser rebuilds (text directly in a table, an `<a>` inside an `<a>`, non-option content in a `<select>`), or a comment written like one of the compiler's own markers (`<!--b0-->`) |
| THANE010 | `repeat()` options that the compiler cannot read: a third argument that is not an object literal `{ key, empty }`, an option `repeat()` does not have, a key that is neither a property name nor a function, or a fourth argument |
| THANE011 | A `repeat()` empty template that is not one static element: two roots, text outside an element, or a `${…}` in it. It is inserted as one element while the list is empty                                                                      |
| THANE012 | A template reads a name that starts with `_`, the prefix of every variable the compiled bindings declare for themselves, so it could read the compiler's value. Rename the variable                                                            |
| THANE013 | Two components of the build with one selector (declared under one name, each with a derived selector). They share their host class, and the styles of the one registered first apply to both. Rename one, or give it an explicit selector     |
| THANE014 | A content `when()` that is not a conditional: a condition alone (`when(cond)` goes in an element's tag), more than three arguments, or a branch that is not a template |
| THANE015 | An event modifier the compiler does not know (`@click.prevnet`), or `.passive` with `.prevent` |

### THANE007 — one root element per row

```typescript
// ❌ BAD — two roots
${repeat(terms(), (t) => html`<dt>${t.term}</dt><dd>${t.def}</dd>`)}

// ✅ GOOD — one element that holds both
${repeat(terms(), (t) => html`<div><dt>${t.term}</dt><dd>${t.def}</dd></div>`)}
```

### THANE008 — no `when()` on a row's root

```typescript
// ❌ BAD
${repeat(items(), (item) => html`<li ${when(item.visible)}>${item.name}</li>`)}

// ✅ GOOD — filter the list
${repeat(items().filter((item) => item.visible), (item) => html`<li>${item.name}</li>`)}
```

### THANE010 — repeat()'s options are an object

```typescript
// ❌ BAD — a key function as the third argument, and options in a variable
${repeat(items(), (item) => html`<li>${item.name}</li>`, { empty: (item) => item.id })}
${repeat(items(), (item) => html`<li>${item.name}</li>`, { empty: options })}

// ✅ GOOD — the options, written in the call
${repeat(items(), (item) => html`<li>${item.name}</li>`, { key: 'id' })}
${repeat(items(), (item) => html`<li>${item.name}</li>`, { key: (item) => item.id, empty: html`<li>None</li>` })}
```

### THANE011 — the empty template is one static element

```typescript
// ❌ BAD — text alone, two roots, a binding
${repeat(items(), (item) => html`<li>${item.name}</li>`, { empty: html`No items` })}
${repeat(items(), (item) => html`<li>${item.name}</li>`, { empty: html`<li>No</li><li>items</li>` })}
${repeat(items(), (item) => html`<li>${item.name}</li>`, { empty: html`<li>No ${noun()}</li>` })}

// ✅ GOOD
${repeat(items(), (item) => html`<li>${item.name}</li>`, { empty: html`<li class="empty">No items</li>` })}
```

### THANE012 — names the compiled bindings keep for themselves

The binding code the compiler writes into each component declares variables of its own, and every one of their names starts with `_` (`_subs`, a bound element's `_b3`, a row's `_el`, a listener's event `_e`). Any other name is yours: a template may read a setup variable named `e`, `item` or `b3`. A template that reads a setup variable, import or global whose name is one of the compiler's would read the compiler's variable, so the build stops instead:

```typescript
// ❌ BAD — `_subs` is a name of the compiled bindings
const _subs = signal(0);
return { template: html`<p>${_subs()}</p>` };

// ✅ GOOD
const subscribers = signal(0);
return { template: html`<p>${subscribers()}</p>` };
```

### THANE014 — a conditional in content has a template

```typescript
// ❌ BAD — a condition alone in content, and a branch that is not a template
${when(open())}
${when(open(), props.label)}

// ✅ GOOD
<p ${when(open())}>Open</p>
${when(open(), html`<p>Open</p>`)}
${when(open(), html`<p>${props.label}</p>`)}
```

### THANE015 — an event modifier the compiler knows

```typescript
// ❌ BAD — 'prevnet' is not an event modifier: did you mean 'prevent'?
template: html`<form @submit.prevnet=${save}>…</form>`;
// ❌ BAD — a passive listener cannot prevent the default
template: html`<div @wheel.passive.prevent=${zoom}>…</div>`;

// ✅ GOOD
template: html`<form @submit.prevent=${save}>…</form>`;
```

The modifiers are listed in [Event Handling](event-handling.md#modifiers). An unknown one used to be ignored, so the
handler ran without the `preventDefault()` it asked for.

← [Back to Docs](README.md)
