# Architecture

## Project Structure

```
src/
  compiler/                    # Build-time compiler (runs in Bun)
    cli/                       # CLI entry point, argument parsing, config resolution, runBuild
    plugins/                   # esbuild plugin pipeline
      component-precompiler/   # Resolves what a file can call and use, runs the binding compiler, mount-call optimiser
      global-css-bundler/      # Bundles .css file imports as string exports
      minification/            # Selector rename plan; HTML and CSS transforms and minifiers the compiler calls
      post-build-processor/    # Final output processing (assets, index.html, gzip, size report, dev server)
      reactive-binding-compiler/ # Core: compiles html`` templates → DOM bindings (+ its tests)
      router-typegen/          # Generates .thane/types (route types, .css declarations)
      thane-linter/            # 13 compile-time lint rules (THANE400–THANE413) (+ its tests)
      tsc-type-checker/        # Type sync and TypeScript type checking at build start
    testing/                   # Shared helpers for build-through tests (not published)
    utils/                     # Shared compiler utilities (HTML parser, AST helpers, file scan, logger)
    errors.ts                  # Diagnostic codes (THANE006–THANE013, THANE200, THANE202, THANE400–THANE413)
  contracts/                   # Names shared by the compiler and the runtime's compiled-output contract
    compiler/                  # Binding kinds, parser states, the code generator's result type
    runtime/                   # Runtime helper names, package entry specifiers
    syntax/                    # Framework function names the compiler and linter recognise
  runtime/                     # Browser runtime (~3 KB gzip)
    signal.ts                  # signal(), computed(), effect(), batch(), untrack()
    component.ts               # defineComponent(), mount(), unmount(), registration factories, style scoping
    dom-binding.ts             # when() conditionals, keyed repeat reconciler
    router.ts                  # defineRoutes(), navigate(), route matching, scroll restoration
    types.ts                   # Signal<T>, ReadonlySignal<T>, ComponentRoot
    index.ts                   # 'thane': the public API barrel, global type declarations
    router-exports.ts          # 'thane/router': defineRoutes, navigate, navigateBack
    internal.ts                # 'thane/runtime': the helpers compiled code imports

e2e/                           # End-to-end Playwright browser tests
  contract-app/                # Test components exercising the compiler ↔ runtime contract
  router-app/                  # Router-specific test app
  cart-app/                    # Cart functionality test app
  browser-error-app/           # Dev-server error relay test app
  hardening-app/               # One probe component per fixed defect, and the shapes around it
  tests/                       # Playwright spec files
  .build/, test-results/       # Generated: app builds and Playwright output (ignored)

example-apps/
  benchmark/                   # js-framework-benchmark implementation (keyed reconciler stress test)
  store/thane/                 # E-commerce example app built with Thane (uses the checkout through `bun link`)
  store/react/                 # The same app built with React, for comparison

bench/                         # In-repo benchmark harness (bench/README.md)

docs/                          # Developer documentation
  contributing/                # This guide: setup, testing, architecture, contracts
  assets/                      # Logo and images used by the README

scripts/                       # Repo maintenance scripts: app type checks, package surface check,
                               # size report, compiled-output snapshots
```

Unit tests sit next to the code they cover (`*.test.ts`); they are excluded from the published build.

## Compiler Pipeline

`runBuild()` (`cli/build.ts`) first resolves the project root (the nearest folder above the entry with a `tsconfig.json` or `package.json`) and scans the working directory, and the project root when it lies outside it, for exported `defineComponent()` calls (`createBuildContext`, `utils/file-utils.ts`). That map of components by name is how child component calls are recognised. A watch rebuild scans again in the component compiler's `onStart` (`refreshBuildContext`), updating the context every plugin holds; the source cache checks modification times, so only changed files are parsed again.

The build is then an **esbuild plugin pipeline**, registered in this order. esbuild runs the `onStart` callbacks concurrently and waits for all of them before it loads a file, and for each file the first `onLoad` callback that returns contents wins.

1. **TSC Type Checker** (`onStart`) — syncs `.thane/types` (`syncProjectTypes`: the `.css` declaration file and one route-type file per `defineRoutes()` table), then type-checks the project with `ts.createProgram`. Its compiler host serves each source with its template values typed (`template-types.ts`, for the checker only: content as `(value) satisfies ThaneContent`, a value in a tag as `ThaneAttribute`, a handler as `(handler) satisfies ThaneEventListener<'click'>`, any other event expression as `__thaneEventCall(expression)`), and the diagnostics are mapped back to the source as written; the declaration of those types is its own, and its diagnostics are not reported. esbuild waits for it. A failed sync fails the build under the `types-sync` label
2. **Thane Linter** (`onLoad` `.ts`) — runs the rules on component files (THANE411 on files that call `mount()`); returns errors, otherwise nothing, so the next plugin loads the file
3. **Component Precompiler** (`onLoad` `.ts`, label `component-compiler`) — the mount-call optimiser for files without templates; `css`-only modules; for files with `html` templates: replaces `${Child(…)}` calls with anchor comments, calls the reactive binding compiler (`transformDefineComponentSource`), compiles `css` templates and strips the `html` tags. An exception becomes the file's build error
4. **Global CSS Bundler** (`onLoad` `.css`) — `transformCss` on the file (`:host-context`, statement at-rules, planned renames, minify in prod or strip comments in dev), exported as a string
5. **Minification** (`onStart`, prod only) — reads the project's sources and plans selector renames into `buildContext.selectorMap`. Templates and stylesheets are minified by the compiler where it emits them; emitted JavaScript is minified by esbuild and never edited
6. **Post-Build Processor** (`onStart`, `onEnd`, `onDispose`) — `onStart` empties the output directory (unless `emptyOutDir` is off; `thane dev` empties it before its first build only); `onEnd` copies assets, writes `index.html` with the entry `<script>` tags from the metafile, compresses, prints the size report and starts the dev server, or, on a rebuild, sends the open pages a hot update or a reload

### Hot Updates

`thane dev` swaps a changed component file in the open pages (`plugins/component-precompiler/hot-modules.ts`, `cli/hot-updates.ts`, `runtime/hot.ts`). In a `thane dev` build, the precompiler appends to every project module the lines that register its namespace (a self-import) and the namespaces of the packages it imports in `globalThis.__thaneModules`, and records which inputs changed. When every changed file is a component file that exports only components, each is bundled on its own as CommonJS, with every other import left to the page (`require('__thane_module__:src/store.ts')`), and sent over the page's socket; the page runs it, and each component registers again: the runtime (only while the page script's `__thaneHot` flag is set) mounts every live instance again with the new factory and replaces its stylesheet. Anything else reloads the page.

### One Component File

Inside the precompiler's `onLoad`, `transformDefineComponentSource` (`reactive-binding-compiler/index.ts`) compiles a component file from one parse of it. Each `const X = defineComponent(…)` in it is compiled on its own (steps 1 to 5), and so is each exported fragment (`` export const X = html`…` ``, into its `{ t, b }` value), with ids counted across the file; step 6 is the file's:

1. Find the component's selector (explicit, or derived from the name it is declared under), and the initial values of the `const x = signal(literal)` declarations of its setup and of the module.
2. Collect the templates of the setup's return objects, read from the parse: local `html` fragments are inlined, and each child component call and imported fragment gets its placeholder comment (`<!--b0.-->`) as the text is read, from the components and fragments the precompiler resolved for the file. A setup has one return object; THANE412 reports more.
3. Process each template (`template-processing.ts`, `repeat-analysis.ts`): parse it, find text, attribute, style and event bindings, and compile `when()`, `when()` and `repeat()` content as sub-templates, at any depth, including directives inside list rows.
4. Build the DOM model of each template as emitted (`dom-model.ts`, the browser's tree construction) and compute, for every bound node, the shortest path of DOM properties from its scope's starting nodes: the component template's elements, a branch's first node, a row element.
5. Generate the code (`codegen.ts`): the `__b` binding function, branch initializers and row factories. Lists at every level are emitted by one generator, `emitRepeat`.
6. Apply every change to the source as one list of edits: each component's registration call, static templates (`__tpl`, `__tpl1`…) and `__b`, and one import of exactly the runtime helpers the file's code uses, from `thane/runtime`.

## Runtime Architecture

The runtime is intentionally minimal:

- **Signals** — reactive primitives with push-based notification, deferred cascades and batching
- **Components** — `defineComponent` wrapper, registration factories, scoped styles via `adoptedStyleSheets`
- **DOM Binding** — conditional rendering (`when`) between comment anchors and keyed list reconciliation (`repeat`)
- **Router** — single-instance client-side router with History API, lazy loading, scroll restoration

The compiler generates a `__b(ctx, elements)` function inside each component's return object that initializes all reactive bindings when the component mounts. The registration factory clones the template, lists the clone's elements before inserting it, and passes that list: compiled code reaches every node it binds by a compile-time path from one of those elements, never by id or by searching the DOM. The compiled-output contract is described in [Contracts](contracts.md).

---

← [Back to Contributing](README.md)
