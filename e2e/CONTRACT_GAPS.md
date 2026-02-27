# Contract test gap triage

This file tracks **known user-visible contract behaviors** validated by automated tests.

## Current status summary

- ✅ Browser contract suite is green (`40/40`) under `bun run e2e:test`.
- ✅ Runtime unit suite is green (`191/191`) under `bun run test`.

## Validated behaviors

- basic render + click-driven updates
- `when` branch switching (including initial visibility check)
- `whenElse` branch exclusivity
- `repeat` add/remove/reorder + keyed identity stability + add-to-empty transition
- nested directives (`repeat` + nested `when`/`whenElse` + nested `repeat`) with cross-signal bindings
- signal bindings inside optimized repeat items (initial value + reactive subscription)
- expression-body arrow syntax in `defineComponent` (compiled to `__registerComponent`)
- child-to-parent callback interaction (with child rendered state verification)
- nullish and rapid-update edge flows
- expression text bindings (order, mixed text, ternary, duplicate signal reads)
- expression attribute and style bindings (class, inline style)
- whitespace preservation between adjacent bindings (`${a()} ${b()}` → exact space, no-gap, multi-space, surrounding text)
- variable-assigned `html` template fragment injection
- CSS scoping: component `:host` styles applied, child styles don't leak to parent/siblings, parent styles cascade into child (light DOM behavior)
- signal props: reactive signal references passed between parent → child → grandchild propagate updates at every level; fine-grained DOM identity verified (surgical text updates, no element re-creation); independent signals update only their own bindings

## Confirmed current limitations

### 1) Direct nested `html`` inside another `html`` expression is disallowed

- Enforced by THANE404 lint rule.
- Functional coverage: `src/compiler/template-nesting.test.ts`.

### 2) Direct nested `html`` remains intentionally disallowed

- Variable-assigned fragment injection is now supported (`const piece = html\`...\`; ...${piece}...`).
- Direct nested `html\`\`` inside another `html\`\`` interpolation is still blocked by THANE404.

### 3) Repeat unsupported optimized shapes use safe fallback renderer

- Unsupported optimized repeat analysis now falls back to safe re-rendering codegen.
- Fallback code is emitted only when needed by the app's repeat shapes.

### 4) Attr/style complex expression detection is AST-backed

- Complex `${...}` expressions in attributes/styles with signal calls are now detected and subscribed.
- Mixed static+expression attribute composition still applies expression to the whole attribute value.

### 5) Conditional mixed-text content: static text is overwritten

- `when-visible-${count()}` inside a `when()` conditional renders as just the signal value.
- The binding init sets `firstChild.nodeValue` to the signal value, overwriting any static text prefix.
- Workaround: wrap the signal in a dedicated element (e.g., `<span>${count()}</span>`).

### 6) CSS scoping is class-based (no Shadow DOM)

- Component styles are automatically scoped via CSS nesting + `adoptedStyleSheets`.
- Child component styles cannot leak to siblings/parent elements (`.foo` → `.styled-child .foo`).
- Parent component styles DO cascade into child components (standard CSS inheritance, no shadow barrier).
- This is a deliberate tradeoff for smaller runtime and better interoperability with global CSS.

### 7) ~~Expression-body arrow functions in defineComponent are not compiled~~ — RESOLVED

- **Fixed**: `findHtmlTemplates` now unwraps `ParenthesizedExpression` bodies from arrow functions.
- Both `() => ({ template: html\`...\` })` and `() => { return { template: html\`...\` }; }` are compiled.
- Validated by `StyledChild` e2e component using expression-body syntax.

### 8) ~~Signal bindings inside optimized repeat item templates are not initialized~~ — RESOLVED

- **Fixed**: Two root causes addressed:
  1. `repeat-analysis.ts`: regex for span injection only matched `this.signal()` form, not bare `signal()` (closure-based components). Fixed to match both.
  2. `codegen.ts`: nested repeat `generateStaticRepeatTemplate` call omitted `signalBindings` argument. Fixed to pass `nr.signalBindings`. Inner repeat `createItem` now generates signal nav, fill, and subscribe code.
- Signal bindings inside repeat items now receive initial values and reactive subscriptions.
- Validated by `nested-parent-a` assertion in nested repeat test.

## Guardrails for future fixes

- Keep e2e assertions output-shape agnostic (behavior-first).
- For compiler changes, require minimal repro + contract assertion.
- Protect repeat reconciliation hot paths from perf regressions.
