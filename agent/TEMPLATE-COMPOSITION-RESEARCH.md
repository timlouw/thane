# Template Composition Research — Thane v0.0.26+

## Executive Summary

This document explores how the Thane compiler could support **template composition** — using `html` tagged template variables inside other templates and directives (`whenElse`, `repeat`, `when`, plain interpolation). Two primary approaches are analyzed: a **Simple AST Pre-Pass** (compile-time inlining) and **True Template Composition** (sub-component-like runtime mounting). The recommended approach is a **phased strategy**: start with the constrained AST pre-pass for quick wins, with a clear upgrade path to full composition.

---

## 1. Root Cause Analysis: Why Variables Don't Work Today

### The failure point

The failure is in `binding-detection.ts` → `extractHtmlTemplateContent()`:

```ts
function extractHtmlTemplateContent(arg: string): string {
  const htmlMatch = arg.match(/^html`([\s\S]*)`$/);   // ← only matches literal html`...`
  if (htmlMatch) return htmlMatch[1];
  const plainMatch = arg.match(/^`([\s\S]*)`$/);       // ← or bare `...`
  if (plainMatch) return plainMatch[1];
  return arg;  // ← variable name like "yesTemplate" returned as raw text
}
```

When `parseWhenElseExpression()` calls this with `yesTemplate`, it gets back the string `"yesTemplate"` as literal text content. This means:
- The HTML parser sees `yesTemplate` as raw text, not HTML
- No bindings are discovered inside it
- No IDs are injected
- No subscription code is generated
- The compiled output embeds the literal string "yesTemplate" where HTML should be

### The cascade

The compiler pipeline is inherently **single-pass over template literals**:

1. `findHtmlTemplates()` in `index.ts` walks the TS AST and only collects `TaggedTemplateExpression` nodes where the tag is `html`
2. It specifically **skips nested** html templates (`insideHtmlTemplate` flag prevents double-processing)
3. Template content is extracted directly from the literal syntax — there's no concept of "resolving" an identifier to its template content

A standalone `const header = html\`<header>...</header>\`` IS found by `findHtmlTemplates()` and processed — but its **compiled output** is just an empty backtick string (`\`\``), having been stripped of its template tag. The variable then holds a meaningless empty string at runtime.

---

## 2. Approach A: Simple AST Pre-Pass (Const Resolution)

### Concept

Before HTML template processing, add a TypeScript AST pass that:
1. Finds all `const x = html\`...\`` declarations in the component scope
2. Builds a map of `identifier → raw template content`
3. When processing `whenElse(cond, identifier, ...)` or `${identifier}`, resolves the identifier to its template content and inlines it

### Implementation sketch

```
New file: src/compiler/plugins/reactive-binding-compiler/template-resolution.ts

1. Walk TS AST in the defineComponent setup function
2. Find: const <name> = html`<content>`  →  templateVarMap.set(name, content)
3. In parseDirectiveArgs / extractHtmlTemplateContent:
   - If arg is an identifier (not a template literal), look up in templateVarMap
   - If found, return the template content as if it were inline
4. In the main template's ${identifier} positions:
   - Replace with the resolved template content before HTML parsing
```

### What works

| Scenario | Supported? | Notes |
|---|---|---|
| `const x = html\`<div>${signal()}</div>\`` then `${x}` in template | ✅ | Inlined, bindings discovered normally |
| `whenElse(cond(), x, y)` with const templates | ✅ | Templates inlined into whenElse args |
| `repeat(items(), (item) => x)` with const template | ⚠️ | Only if template doesn't reference `item` — see below |
| Template reuse (same var in multiple places) | ✅ | Inlined at each usage site (duplicated) |
| Templates in separate files / imports | ❌ | Can't resolve cross-module |
| `let` or reassigned variables | ❌ | Only `const` with literal initializer |
| Templates computed from functions | ❌ | Only direct literal assignment |
| Conditional template selection (`const x = cond ? a : b`) | ❌ | Not a literal initializer |

### Binding ID conflicts

**Critical issue**: If the same template variable is used in two places, each usage would generate bindings with the same content but needs **different IDs**. 

```ts
const status = html`<span class="${statusClass()}">${statusText()}</span>`;
// Usage 1: ${status}   → needs IDs b0, b1
// Usage 2: ${status}   → needs IDs b2, b3 (different!)
```

**Solution**: Inline at each call site. The `idCounter` is already monotonically increasing, so each inlined copy gets unique IDs. The template content is duplicated in the static HTML, but bindings are distinct. This is the correct behavior — it's the same as if the user had copy-pasted the template.

### Interaction with signals inside composed templates

```ts
const header = html`<h1 class="${headerClass()}">${title()}</h1>`;
const template = html`<div>${header}<main>${content()}</main></div>`;
```

After inlining, the main template becomes:
```html
<div><h1 class="${headerClass()}">${title()}</h1><main>${content()}</main></div>
```

This is **exactly** what the user would have written inline. The existing pipeline handles it natively:
- `headerClass()` → detected as attr binding, gets ID injected
- `title()` → detected as text binding, gets `<span id="bN">` wrapper
- `content()` → same treatment
- All signals get subscriptions in `initializeBindings`

**This is the key insight**: inlining makes the problem disappear for the existing pipeline.

### Interaction with whenElse

```ts
const loggedIn = html`<div>Welcome, ${name()}</div>`;
const loggedOut = html`<div><button @click=${login}>Login</button></div>`;
${whenElse(isAuth(), loggedIn, loggedOut)}
```

After resolution, `parseWhenElseExpression` would see:
```
args[1] = '<div>Welcome, ${name()}</div>'    // resolved from loggedIn
args[2] = '<div><button @click=${login}>Login</button></div>'  // resolved from loggedOut
```

This feeds into `collectWhenElseBlocks` → `processSubTemplateWithNesting` exactly as if the templates were inline. The then/else branches each get:
- Their own binding IDs (`thenId`, `elseId`)
- Their own nested binding discovery
- Their own subscription lifecycle (bindings initialized when shown, cleaned up... **wait** — currently cleanups are NOT run when whenElse hides a branch)

**Lifecycle gap**: Looking at the runtime `bindConditional()`:
```ts
const hide = () => {
  if (!currentlyShowing) return;
  currentlyShowing = false;
  const current = root.getElementById(id);
  if (current) {
    const p = document.createElement('template');
    p.id = id;
    current.replaceWith(p);  // DOM removed, but subscriptions NOT cleaned up
  }
};
```

Bindings inside conditional branches are initialized once (`bindingsInitialized` flag) and **never cleaned up on hide**. The subscriptions remain alive even when the DOM is removed. This is an existing issue, not specific to template composition, but composition makes it more visible because composed templates are more likely to have complex bindings inside conditionals.

### Interaction with repeat

```ts
const itemTemplate = html`<li class="${itemClass()}">${item.name}</li>`;
${repeat(items(), (item) => itemTemplate)}
```

**This is problematic**. After inlining:
```
(item) => <li class="${itemClass()}">${item.name}</li>
```

The template references `item.name` — but `item` comes from the arrow function parameter, not from a signal. The existing `processItemTemplate()` in `repeat-analysis.ts` handles this by:
1. Detecting `item.xxx` patterns as item bindings (not signal bindings)
2. Renaming `item` → standardized variable in codegen

After inlining, the `itemVar` is still `item` (from the arrow params), and `item.name` in the template body would be detected normally. **This actually works** — as long as the arrow function parameter name matches the variable references in the inlined template.

**But**: `itemClass()` is a component signal, detected as a `signalBinding` inside the repeat. This prevents the optimized `__bindRepeatTpl` path (falls back to `__bindRepeat`). This is correct behavior — the same would happen with inline templates.

**Edge case that breaks**: 
```ts
const itemTemplate = html`<li>${name}</li>`;  // "name" is ambiguous
${repeat(items(), (item) => itemTemplate)}     // item var is "item", not "name"
```

After inlining, the template references `name` but the item var is `item`. The variable `name` would be treated as a component-level reference, not an item property. **The user must write the template with the correct item variable**, which is unintuitive when the template is defined separately from the repeat call.

### Implementation estimate

| Metric | Estimate |
|---|---|
| New file | `template-resolution.ts` (~150 lines) |
| Modified files | `index.ts` (add pre-pass call, ~20 lines), `binding-detection.ts` (pass resolution map, ~15 lines) |
| Total new code | ~185 lines |
| Risk | Low — additive; existing inline templates unchanged |
| Testing | Medium — need to verify ID uniqueness, nested composition, directive interaction |

---

## 3. Approach B: True Template Composition (Sub-Components)

### Concept

Each `html\`...\`` template literal is treated as a **mini-component** with:
- Its own binding processing pipeline
- Its own compiled static template
- Its own `initializeBindings` function
- A runtime mount/unmount lifecycle

At composition points, the parent template creates a placeholder, and the composed template is "mounted" into it at runtime — similar to how child components work.

### How it would work

```ts
const header = html`<header class="${headerClass()}">${title()}</header>`;
const footer = html`<footer>${copyright()}</footer>`;
const template = html`
  <div>
    ${header}
    <main>${content()}</main>
    ${footer}
  </div>
`;
```

**Compile-time**:
1. Each `html\`\`` literal is compiled independently:
   ```ts
   // header becomes:
   const __header_tpl = (() => { const t = document.createElement('template'); t.innerHTML = `<header id="b0"> </header>`; return t; })();
   const __header_bindings = (root) => {
     const b0 = root.getElementById('b0');
     b0.setAttribute('class', headerClass());
     headerClass.subscribe(v => { b0.setAttribute('class', v); }, true);
     b0.firstChild.nodeValue = title();
     title.subscribe(v => { b0.firstChild.nodeValue = v; }, true);
   };
   ```
2. The parent template gets composition points:
   ```html
   <div>
     <template id="__comp_0"></template>  <!-- header mount point -->
     <main id="b2"><span id="b3"> </span></main>
     <template id="__comp_1"></template>  <!-- footer mount point -->
   </div>
   ```
3. The parent's `initializeBindings` mounts composed templates:
   ```ts
   // Mount header
   const headerFragment = __header_tpl.content.cloneNode(true);
   root.getElementById('__comp_0').replaceWith(headerFragment);
   const headerCleanups = __header_bindings(root);  // ← problem: shared root
   ```

### The shared root problem

**Critical architectural issue**: Composed templates need to find their elements by ID. But if they share the parent's `root` (the component's host element), **ID collisions** become a serious concern:

- Parent has `b0`, `b1`, `b2`
- Header template has `b0`, `b1` (independent counter!)
- `root.getElementById('b0')` returns the wrong element

**Solutions**:

#### Option B1: Global ID namespace with compiler coordination
- The compiler processes all templates in a component together, using a single monotonically increasing ID counter
- Header gets `b0-b1`, footer gets `b2`, main content gets `b3-b4`
- Pro: Simple, works with `root.getElementById`
- Con: Requires multi-pass compilation or dependency ordering; template IDs depend on composition order

#### Option B2: Scoped roots via wrapper elements
- Each composed template is mounted inside a scoped container div
- Bindings use the container as root: `container.getElementById('b0')`
- Pro: True isolation
- Con: Extra DOM nodes, style implications, breaks CSS selectors

#### Option B3: Prefixed IDs
- Each template gets an ID prefix: `h_b0`, `f_b0`, `m_b0`
- Pro: No extra DOM, no collisions
- Con: Complex codegen, ID strings become longer, harder to debug

**Recommendation for Approach B**: Option B1 (coordinated namespace). The compiler already has a global `idCounter` — if templates are processed in a known order, IDs are unique by construction.

### Lifecycle management

Each composed template needs:
- **Mount**: Clone template, insert into DOM, run bindings
- **Unmount**: Remove from DOM, unsubscribe all bindings
- **The parent component's `onDestroy` must cascade** to composed templates

This requires a new runtime primitive:

```ts
interface ComposedTemplate {
  mount(parent: ComponentRoot, anchorId: string): void;
  unmount(): void;
}
```

The `initializeBindings` function would return cleanup functions for each composed template, added to the component's cleanup list.

### Interaction with whenElse

```ts
const loggedIn = html`<div>Welcome, ${name()}</div>`;
const loggedOut = html`<div><button @click=${login}>Login</button></div>`;
${whenElse(isAuth(), loggedIn, loggedOut)}
```

This is where true composition **shines over inlining**:

- `whenElse` shows/hides by swapping DOM
- When showing: mount the composed template, initialize its bindings
- When hiding: unmount, **clean up subscriptions** (unlike current behavior!)
- When re-showing: re-mount and re-initialize (or restore from cache)

The current `bindConditional` runtime already has the `initNested` callback pattern — composed templates would plug into this naturally:

```ts
__bindIfExpr(r, [isAuth], () => isAuth(), 'comp_0',
  loggedIn_template_html,
  () => loggedIn_initBindings(r)  // returns cleanup functions
);
```

**This is actually identical to what already happens** with inline templates containing bindings — `initNested` returns an array of unsubscribe functions. The only difference is that the template and its bindings are defined separately.

### Interaction with repeat

```ts
const itemRow = html`<tr><td>${item.name}</td><td>${item.value}</td></tr>`;
${repeat(items(), (item) => itemRow)}
```

**Fundamental problem**: In true composition, `itemRow` is compiled with its own bindings. But `item` is a **loop variable** — it doesn't exist at the `itemRow` definition site. The template can't have `item.name` bindings because `item` isn't a signal.

Possible solutions:
1. **Template functions**: `const itemRow = (item) => html\`<tr><td>${item.name}</td></tr>\``
   - This is just a function returning a template — not a template variable
   - Each call creates a new template, defeating reuse
   
2. **Slot-like injection**: The repeat directive "injects" the item into the template's scope
   - Would require a new binding type: "external variable binding"
   - The template declares slots: `html\`<tr><td>${$.name}</td></tr>\``
   - The repeat fills them: `repeat(items(), itemRow.with(item => ({ name: item.name })))`
   - Massive complexity increase
   
3. **Don't support it**: Template composition inside repeat requires inline templates
   - This is the pragmatic answer
   - Repeat already has its own template system with `processItemTemplate()`

**Recommendation**: Don't attempt template composition inside repeat. The repeat directive's optimized path (`__bindRepeatTpl`) already has template cloning + path-based navigation. Adding composition on top would conflict with these optimizations.

### Implementation estimate

| Metric | Estimate |
|---|---|
| New files | `template-resolution.ts` (~300 lines), `composed-template.ts` runtime (~200 lines) |
| Modified files | `index.ts` (~80 lines), `codegen.ts` (~150 lines), `template-processing.ts` (~60 lines), `dom-binding.ts` (~100 lines), `component.ts` (~30 lines) |
| Total new code | ~920 lines |
| Risk | **High** — touches runtime lifecycle, binding system, codegen pipeline |
| Testing | Heavy — lifecycle edge cases, cleanup verification, nested composition |

---

## 4. What Other Frameworks Do

### Lit (Runtime Composition)

Lit handles this entirely at **runtime**. A `TemplateResult` is a first-class value:

```ts
const header = html`<h1>${title}</h1>`;
const page = html`<div>${header}</div>`;  // Just works
```

How it works:
- `html\`\`` returns a `TemplateResult` object (not a string)
- Child expressions accept `TemplateResult` values natively
- The template is processed into a `<template>` element with markers (comment nodes `<!--?lit$...-->`)
- Each `TemplateResult` tracks its own "parts" (dynamic binding points)
- When composed, the child `TemplateResult` is rendered into the parent's child part
- Each rendered template has its own `Part` instances that manage updates independently

**Key insight**: Lit's runtime manages each template's bindings independently. There's no compile-time flattening. The `when()` directive returns `TemplateResult` values, and the runtime knows how to mount/unmount them.

**Relevance to Thane**: Thane could adopt a similar model, but it would require:
- Changing `html\`\`` from a tag that's stripped at compile time to one that produces a runtime object
- Adding a runtime template system with part management
- This is essentially rewriting the framework around runtime templates instead of compile-time processing

### Svelte (Compile-Time Components + Slots)

Svelte has no template variables. Composition is through **components** and **slots**:

```svelte
<!-- Header.svelte -->
<header class={headerClass}>{title}</header>

<!-- Page.svelte -->
<div>
  <Header />
  <main>{content}</main>
</div>
```

- Each `.svelte` file is a component with its own compiled output
- The compiler generates create/update/destroy functions per component
- Slots allow parent→child content projection
- `{#if}` and `{#each}` manage block lifecycle (create + destroy on toggle)

**Key insight**: Svelte's answer is "use components." There's no template variable — every reusable piece is a file-level component with its own compilation unit.

**Relevance to Thane**: The "sub-component" approach (Approach B) mirrors Svelte's model — each template gets its own lifecycle. But Thane would need to support this within a single file, which Svelte explicitly avoids.

### SolidJS (JSX Fragments + Compile-Time Transforms)

SolidJS uses JSX compiled to direct DOM operations:

```tsx
const Header = () => <header class={headerClass()}>{title()}</header>;
const Page = () => (
  <div>
    <Header />
    <main>{content()}</main>
  </div>
);
```

- Components are plain functions returning DOM nodes
- The compiler transforms JSX into `createComponent()` calls
- `<Show>` (equivalent to `whenElse`) manages mounting/unmounting
- Signals auto-track — no explicit subscriptions needed

**Key insight**: SolidJS components are just functions. Template composition = function composition. Each function call creates its own reactive scope.

**Relevance to Thane**: The closest analog would be treating each `html\`\`` variable as a factory function. At the usage site, the compiler calls the factory, gets DOM + bindings, and mounts them.

### Vue (SFC Components + Slots + Template Refs)

Vue's composition model:
```vue
<template>
  <div>
    <HeaderComponent />
    <main>{{ content }}</main>
  </div>
</template>
```

- Components are the composition unit (like Svelte)
- The compiler transforms `<template>` into render functions
- `v-if` creates/destroys component instances (full lifecycle)
- Slots for content projection

**Relevance to Thane**: Confirms the pattern — in compiled frameworks, the component is the composition boundary.

### Summary Table

| Framework | Composition Unit | Template Variables? | Compile vs Runtime | Directive Integration |
|---|---|---|---|---|
| **Lit** | `TemplateResult` | ✅ First-class | Runtime | Directives return TemplateResults |
| **Svelte** | `.svelte` file | ❌ | Compile | `{#if}` creates/destroys blocks |
| **SolidJS** | Function component | ✅ (as functions) | Compile | `<Show>`/`<For>` mount/unmount |
| **Vue** | `.vue` SFC | ❌ | Compile | `v-if` creates/destroys instances |
| **Thane (current)** | `defineComponent` | ❌ | Compile | `when`/`whenElse`/`repeat` inline only |

---

## 5. Recommended Approach: Phased Strategy

### Phase 1: AST Pre-Pass with Inlining (Low risk, high value)

**Implement Approach A** — resolve `const` template variables to their literal content at compile time.

#### Scope
- Only `const` declarations with `html\`...\`` literal initializers
- Only within the same `defineComponent` setup function scope
- The resolved template content is inlined at each usage site
- Each inlined copy gets its own IDs and bindings (no sharing)

#### Where resolution applies

| Context | Resolution | How |
|---|---|---|
| `${templateVar}` in parent template | Inline the HTML content | Replace the `${identifier}` expression with the template HTML |
| `whenElse(cond, templateVar, ...)` | Inline as directive arg | Resolve before `parseWhenElseExpression` |
| `when(cond)` on element (attribute directive) | N/A | `when` is an element attribute, doesn't take template args |
| `repeat(items, (item) => templateVar)` | Inline with caveat | Only if template uses the correct item variable name |
| `repeat(items, (item) => html\`...${templateVar}...\`)` | Inline within nested template | Template inlined into the repeat item template |

#### Implementation plan

**New file**: `src/compiler/plugins/reactive-binding-compiler/template-resolution.ts`

```ts
interface TemplateVarMap {
  /** Map of const identifier → raw html`` template content */
  variables: Map<string, string>;
}

/**
 * Pre-pass: Find all `const X = html`...`` declarations in the 
 * defineComponent setup function and build a resolution map.
 */
function buildTemplateVarMap(sourceFile: ts.SourceFile): TemplateVarMap;

/**
 * Resolve a string that might be an identifier reference to a template variable.
 * Returns the template content if found, or the original string if not.
 */  
function resolveTemplateArg(arg: string, varMap: TemplateVarMap): string;
```

**Modifications**:

1. **`index.ts` → `transformDefineComponentSource()`**: After parsing the source file, call `buildTemplateVarMap()` to collect template variables. Pass the map down to template processing.

2. **`binding-detection.ts` → `extractHtmlTemplateContent()`**: Accept an optional `TemplateVarMap` parameter. Before returning the raw arg string, check if it's an identifier in the map:
   ```ts
   function extractHtmlTemplateContent(arg: string, varMap?: TemplateVarMap): string {
     // existing html`...` and `...` matching
     // NEW: check if arg is a known template variable
     const trimmed = arg.trim();
     if (varMap && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
       const resolved = varMap.variables.get(trimmed);
       if (resolved !== undefined) return resolved;
     }
     return arg;
   }
   ```

3. **Main template interpolation**: In the main template, `${identifier}` where `identifier` is a template variable needs special handling. The HTML parser currently sees this as a signal expression (`${something()}`-like). For non-signal identifiers in `${}`, the pre-pass would need to:
   - Find `${identifier}` in the template string where `identifier` matches a template var
   - Replace the expression with the inline template content **before** HTML parsing
   - This is a text substitution on the template string, before `parseHtmlTemplate`

#### What about the original `html\`\`` declaration?

Currently, `findHtmlTemplates()` collects ALL `html\`\`` expressions in the file. The template variable's declaration (`const header = html\`...\``) would also be found and processed. The compiler currently replaces it with empty backticks: `\`\``.

With the pre-pass, we have two options:
1. **Keep processing it** — the declaration's template is compiled normally AND inlined at usage sites. Double processing, wasted work, but harmless.
2. **Skip template var declarations** — mark them as "resolution-only" templates. The compiler strips the `html` tag but doesn't process the template. The variable holds an empty string at runtime (never used because it's inlined everywhere).

**Option 2 is cleaner**. The `findHtmlTemplates()` function can skip tagged templates that are the initializer of a const declaration found in the var map.

#### Edge case: Template variables referencing other template variables

```ts
const icon = html`<svg>...</svg>`;
const button = html`<button>${icon} Click</button>`;
const template = html`<div>${button}</div>`;
```

This requires **recursive resolution**: `button` references `icon`, and `template` references `button`. The pre-pass must resolve in dependency order.

**Implementation**: Build a dependency graph. For each template var, scan its content for `${identifier}` references to other template vars. Topological sort. Resolve leaves first. Cycle detection → error.

This adds ~50 lines but is essential for practical use.

#### Edge case: Template var inside template expression

```ts
const badge = html`<span class="badge">${count()}</span>`;
const template = html`<div>Items: ${badge} found</div>`;
```

After inlining:
```html
<div>Items: <span class="badge">${count()}</span> found</div>
```

This is valid HTML with a signal expression inside an inline element. The HTML parser handles this natively. **Works correctly.**

### Phase 2: Improved Conditional Lifecycle (Medium risk, enables Phase 3)

Before or alongside composition work, fix the **conditional subscription leak**:

When `whenElse` hides a branch, subscriptions created by `initNested()` should be cleaned up. When the branch is re-shown, bindings should be re-initialized.

**Current behavior** (in `bindConditional`):
```ts
let bindingsInitialized = false;
// ...
const show = () => {
  if (!bindingsInitialized) {
    bindingsInitialized = true;
    cleanups = initNested();  // Only called ONCE
  }
};
// hide() doesn't clean up
```

**Fixed behavior**:
```ts
const show = () => {
  if (!currentlyShowing) {
    currentlyShowing = true;
    // ...replaceWith contentEl...
    cleanups = initNested();  // Re-initialize every show
  }
};
const hide = () => {
  if (currentlyShowing) {
    currentlyShowing = false;
    // Clean up subscriptions
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    // ...replaceWith template placeholder...
  }
};
```

This is **required** for true composition (Phase 3) but also fixes a memory leak in the current system.

**Estimate**: ~30 lines changed in `dom-binding.ts`, but needs careful testing of all conditional paths.

### Phase 3: True Composition (Future — if needed)

Only pursue if Phase 1's limitations become blocking. The full composition model would:

1. Compile each template var into a `{ template: HTMLTemplateElement, bindings: (root) => cleanup[] }` pair
2. At composition points, emit runtime `mountTemplate()` calls
3. Add cleanup cascading to `onDestroy`

**The key question is whether this is ever needed if Phase 1 works.** For most use cases — extracting repeated markup into named variables for readability — inlining is sufficient and invisible to the user.

True composition becomes necessary only for:
- **Cross-file template sharing** (import a template from another module)
- **Dynamic template selection** (`const tpl = condition ? tplA : tplB`)
- **Template caching** (avoid re-creating DOM when toggling, like Lit's `cache` directive)

---

## 6. Detailed Directive Interaction Matrix

| Directive | Phase 1 (Inlining) | Phase 3 (True Composition) | Notes |
|---|---|---|---|
| **Plain `${var}`** | ✅ Replace with template HTML inline | ✅ Mount at placeholder | Both work; inlining is simpler |
| **`whenElse(cond, var, var)`** | ✅ Resolve args before parsing | ✅ Mount/unmount on toggle | Phase 1 inherits current lifecycle (no cleanup on hide) |
| **`when(cond)` attribute** | N/A — takes no template args | N/A | Not affected |
| **`repeat(items, (item) => var)`** | ⚠️ Works if item var matches | ❌ Template can't capture loop item | Phase 1 works by accident; Phase 3 can't solve this |
| **`repeat(items, (item) => html\`...${var}...\`)`** | ✅ Var inlined into item template | ⚠️ Nested mount inside repeat items | Phase 1 is straightforward; Phase 3 adds lifecycle complexity |
| **Nested: `whenElse` inside `repeat`** | ✅ Inlined then processed normally | ✅ But lifecycle management is complex | Both work; Phase 1 is simpler |
| **Template var inside template var** | ✅ Recursive resolution | ✅ Nested mounting | Phase 1 needs dependency ordering |

---

## 7. Risk Assessment

### Phase 1 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| ID collision from double-processing | Medium | Skip template var declarations in `findHtmlTemplates()` |
| Recursive resolution cycles | Low | Cycle detection in dependency graph → compile error |
| User confusion: template vars must use `const` | Low | Lint rule + clear error message |
| Template var content has `${}` that isn't a signal | Low | Existing parser handles static text, events, directives |
| Performance: duplicate HTML for reused templates | Low | Only affects compiled output size, not runtime perf |
| Repeat interaction: wrong item variable name | Medium | Lint warning: "template var inside repeat may not reference loop variable" |

### Phase 3 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Runtime overhead from mount/unmount | Medium | Template caching, lazy initialization |
| Subscription leak on unmount | High | Must implement proper cleanup (Phase 2 prerequisite) |
| Binding namespace collisions | High | Coordinated ID namespace or prefixing |
| Breaking change to template compilation | High | Feature flag, opt-in syntax |
| Complexity budget exceeded | High | Only implement if Phase 1 is insufficient |

---

## 8. Recommendation

**Implement Phase 1 (AST Pre-Pass with Inlining)** as the immediate solution. It provides:

1. **Template variables in whenElse** — the primary requested use case
2. **Template variables in plain interpolation** — template DRY
3. **Correct binding behavior** — signals inside composed templates work as if inline
4. **Zero runtime changes** — purely compile-time, no new runtime primitives
5. **Low risk** — additive change, doesn't alter existing behavior

Phase 2 (conditional lifecycle fix) should be done independently as a bug fix.

Phase 3 should be deferred until cross-file template sharing or dynamic template selection becomes a user requirement.

### Final architecture for Phase 1

```
         Source Code
              │
    ┌─────────▼──────────┐
    │ buildTemplateVarMap │  NEW — find const html`` declarations
    └─────────┬──────────┘
              │ templateVarMap
    ┌─────────▼──────────┐
    │ resolveTemplateRefs │  NEW — inline template vars in main template
    └─────────┬──────────┘
              │ resolved source (template vars inlined)
    ┌─────────▼──────────┐
    │ findHtmlTemplates   │  MODIFIED — skip template var declarations
    └─────────┬──────────┘
              │
    ┌─────────▼──────────┐
    │ processHtmlTemplate │  UNCHANGED — sees inlined content natively
    │ WithConditionals    │
    └─────────┬──────────┘
              │
    ┌─────────▼──────────┐
    │ generateInitBindings│  UNCHANGED — generates subscriptions normally
    │ Function            │
    └─────────┬──────────┘
              │
         Compiled Output
```
