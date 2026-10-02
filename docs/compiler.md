# Compiler

Thane's compiler is an esbuild-based plugin pipeline that transforms your TypeScript components into optimized vanilla JavaScript at build time. This page explains how the compilation process works.

## Build Pipeline

Before esbuild starts, the build finds the project (the nearest folder above the entry file with a `tsconfig.json` or `package.json`) and scans the working directory, and the project folder when it lies outside it, for every exported `defineComponent()`. That list is how the compiler recognises a child component call such as `${Card({ … })}` in a template. Under `thane dev` every rebuild scans again, so a component file added while it runs is recognised on the next rebuild; files that did not change are not parsed again.

A folder without its own `tsconfig.json` or `package.json` therefore builds as part of the enclosing project, whose type check and generated types then cover it; the build warns when that project lies above the folder `thane` runs in (a scratch app inside a repository, for example). Add a `package.json` to build such a folder on its own.

esbuild then runs these plugins, in this order:

```
Source (.ts, .css)
  │
  ├─ 1. Type Checker       → (build start) writes .thane/types, then runs the TypeScript check
  ├─ 2. Thane Linter       → 12 lint rules (THANE400–THANE416) on each component and entry file
  ├─ 3. Component Compiler → html`` → static template + __b() binding function; css`` compiled
  ├─ 4. Global CSS Bundler → .css imports → string exports
  ├─ 5. Minification       → (build start, prod only) plans selector renames from the sources
  └─ 6. Post-Build         → assets, index.html with the entry script, gzip/brotli, size report, dev server
  │
  ▼
Output (dist/)
```

- **Type Checker.** At the start of every build it generates the hidden type files in `.thane/types` (the `.css` declarations and the route types) and then type-checks the project with its own `tsconfig.json`, with each template event handler typed for its event ([Event Handling](event-handling.md#event-object)). esbuild waits for it. Type errors are warnings, or fail the build with `--strict-type-check`.
- **Thane Linter.** Runs the lint rules on each `.ts` file that defines a component or calls `mount()`. An error stops that file; warnings are printed.
- **Component Compiler** (log tag `component-compiler`). For each `.ts` file that holds an `html` template it replaces child component calls with anchors, compiles the component (see [Template Compilation](#template-compilation)), compiles its `css` templates and removes the `html` tags. A module that holds only `css` templates has them compiled too. In a file without templates that calls `mount(App)` once (usually the entry file), with a component it can name and no routes, it rewrites the call to a direct mount that leaves the router out of the bundle. A component it cannot compile fails the build with the error, once.
- **Global CSS Bundler.** Loads every imported `.css` file, applies the same stylesheet transforms as `css` templates, and exports the result as a string.
- **Minification.** In production builds, decides before anything is compiled which component selectors can be shortened (see [Selector minification](#selector-minification)).
- **Post-Build.** At the start it empties the output directory (unless `--no-empty-out-dir`). At the end it copies the assets, writes `index.html` with a `<script>` for each entry, compresses the output with `--gzip`, prints the size report and starts the server for `dev` and `serve`.

esbuild itself compiles the TypeScript, bundles, tree-shakes and, in production builds, minifies the JavaScript.

## Template Compilation

The core transformation is converting `html` tagged templates into static DOM templates plus direct binding code.

### Input

```typescript
export const Counter = defineComponent(() => {
  const count = signal(0);
  const inc = () => count(count() + 1);

  return {
    template: html` <button @click=${inc}> Clicks: ${count()} </button> `,
  };
});
```

### Output (conceptual)

```javascript
// 1. Static template — parsed once, cloned for each instance
const __tpl = __T(`<button> Clicks: <!---->0<!----></button>`);

// 2. Component registration with binding function
export const Counter = __registerComponentLean(
  'counter',
  (ctx) => {
    const count = signal(0);
    const inc = () => count(count() + 1);

    return {
      // _ns: the clone's elements in document order, listed before it is inserted
      __b: (ctx, _ns) => {
        // Each bound node is reached by a path computed at build time
        const text = _ns[0].lastChild.previousSibling;

        // Direct event binding
        _ns[0].addEventListener('click', inc);

        // Signal subscription — updates only the text node
        const unsub = count.subscribe((v) => {
          text.data = v;
        }, true);

        return () => {
          unsub();
        };
      },
    };
  },
  __tpl,
);
```

Key points:

- The HTML string becomes a static `<template>` that is cloned (not parsed) for each component instance. The signal's initial value (`0`) is already in it.
- An empty comment on each side of a text binding marks where it goes; the binding writes the text node between them.
- The compiler knows the shape of the DOM the browser builds from the template, so every bound element, text node and directive anchor is reached by a short path of DOM properties (`firstElementChild`, `nextSibling`, …) from the elements of the clone. Nothing is looked up by id or searched for at runtime, and compiled templates carry no generated ids.
- Each signal gets a direct subscription to the exact DOM node it affects — no diffing.

A template whose markup the browser would rebuild differently from how it is written (text directly in a `<table>`, an `<a>` inside another `<a>`, non-option content in a `<select>`) is reported as THANE009 when a binding needs a position inside it.

## Binding Kinds

The compiler detects and generates different binding types from the contracts:

| Kind        | Source syntax       | Generated code                                                   |
| :---------- | :------------------ | :--------------------------------------------------------------- |
| Text        | `${signal()}`       | `signal.subscribe(v => textNode.data = v)`                       |
| Attribute   | `attr=${value}`     | `signal.subscribe(v => el.setAttribute(attr, v))`                |
| Style       | `style=${expr}`     | `signal.subscribe(v => el.style.cssText = v)`                    |
| Event       | `@click=${handler}` | `el.addEventListener('click', handler)`                          |
| Conditional | `${when(cond())}`   | `__bindIf(start, end, signal, template, initNested)`             |
| IfElse      | `${when(...)}`  | `__bindIfExpr(start, end, signals, evalExpr, …)`, once per branch |
| Repeat      | `${repeat(...)}`    | `createKeyedReconciler(container, anchor, ...)`                  |

A `when()` or `when()` branch sits between two empty comments, `start` and `end`; the two branches of a `when()` share the comment between them. A list's rows go before its anchor comment.

## Component Registration

The compiler emits one of two registration functions depending on what the component uses:

| Function                  | When emitted                                    |
| :------------------------ | :---------------------------------------------- |
| `__registerComponent`     | Component has styles or lifecycle hooks         |
| `__registerComponentLean` | No styles, no lifecycle hooks — minimal overhead |

The lean variant (`__registerComponentLean`) tree-shakes the entire style subsystem when no component in the app uses `styles`. The runtime `defineComponent` is only used by code that was not compiled, such as the runtime's own unit tests.

Compiled components import these helpers from `thane/runtime`, the compiler's own entry. Applications never import it.

## Child Components

A call to a known component inside a template, `${Card({ title })}`, is replaced at build time by the child's host element (`<card>`), and the parent's binding function mounts the child into it. Where the browser's parser would not keep an element in that place (directly in a table row, inside `<svg>`), a comment stands there instead and the child's host replaces it at mount.

A call is matched to the component the file declares under that name, or imports under it (following re-exports and the tsconfig's `paths`). A file can declare several components; each is compiled on its own.

## Fragments

An `html` const used in a template of the same file is inlined where it is used. A fragment another module exports (`` export const Badge = html`…` ``) is resolved through the imports like a component: one without `${…}` is written out in place, and one with expressions is compiled in its own module into `{ t, b }`, its static template and a binding function closed over that module, which the importing template mounts before a comment placeholder (`__mf`). Its static templates are marked pure, so esbuild drops a fragment no template uses.

## CSS Processing

### Scoped Styles

The `styles` property is processed by `scopeCssRules()` at runtime. Every selector is prefixed with the component's class selector:

```css
/* Input */
.card {
  padding: 1rem;
}
.card h1 {
  color: blue;
}

/* Output (for component selector 'my-card') */
.my-card .card {
  padding: 1rem;
}
.my-card .card h1 {
  color: blue;
}
```

Before that, at build time, every stylesheet (`css` templates and imported `.css` files) is prepared so the runtime scoper can read it: `:host-context(X)` is rewritten to `X &`, `@layer a, b;` becomes one empty `@layer` block per name, `@charset` is removed, `@import` is removed with a warning, and comments are removed. See [Styling](styling.md).

### CSS File Imports

The **Global CSS Bundler** plugin transforms `.css` file imports into string exports:

```typescript
// Input
import styles from './Card.module.css';

// Output
const styles = '/* contents of Card.module.css */';
```

## Production Minification

A production build minifies three kinds of text, each by the tool that knows its language:

| What                                          | Minified by  | Where                                   |
| --------------------------------------------- | ------------ | --------------------------------------- |
| JavaScript, yours and every library's         | esbuild      | while bundling                          |
| HTML templates                                | the compiler | where it emits a compiled template      |
| Stylesheets (`css` templates, `.css` imports) | the compiler | where it reads the template or the file |

**Thane never edits emitted JavaScript.** The output files are not read back, searched or patched, so nothing Thane does can change a library, whatever the library contains and however the bundle is split. A template or stylesheet is minified at the one point where the compiler holds it as HTML or CSS, not recognised afterwards by what a string looks like.

In a `css` template the substitutions are located by the TypeScript parser and carried over untouched, and the literal text keeps its escape sequences exactly as written (`content: "\\201C"`). In a template, `<pre>`, `<textarea>`, `<script>` and `<style>` content is carried through as written, in development and production builds; the same holds for inline `<script>`, `<style>`, `<pre>` and `<textarea>` in `index.html`. Whitespace elsewhere in a template is collapsed the same way in both builds (see [Templates](templates.md#whitespace)).

### Selector minification

Component selectors are replaced with shorter names (e.g., `product-card` → `a-b`). The **Minification** plugin decides which before anything is compiled: it reads the project's own TypeScript, stylesheets and `index.html` and renames a selector only when every appearance of its text is a place the compiler writes itself (see [Styling](styling.md#selector-minification)). The compiler then writes the short name where it writes a selector: the registration, the host element of a child component, the root tag in `index.html`, and `.product-card` class selectors in component stylesheets.

## index.html

The **Post-Build** plugin writes your `index.html` into the output directory with a `<script type="module">` for each entry file, under its hashed name. You don't need to add `<script>` tags yourself. In production builds the file is minified; a served development build (`thane dev`, or `thane serve` without `--prod`) also gets the small script that sends browser errors to the terminal.

## Route Type Generation

At the start of every build, and with `thane types`:

1. Scans the project for `defineRoutes()` calls to extract route patterns
2. Generates `.d.ts` files in `.thane/types/router/`
3. These types make `navigate()` autocomplete valid paths and `route.params` type-safe per page

Run `thane types` to regenerate types manually, or they update automatically during `thane dev` and `thane build`.

## Tree-Shaking

The compiler is designed for aggressive tree-shaking:

- Router code is eliminated if nothing imports from `thane/router`
- The style subsystem is eliminated if no component uses `styles`
- `registerGlobalStyles` is eliminated if never imported
- Lifecycle hooks are optimized away when absent
- Each component imports exactly the runtime helpers its compiled code calls

This is why the runtime stays at ~3 KB gzip for minimal applications.

← [Back to Docs](README.md)
