# Architecture

## Project Structure

```
src/
  compiler/                    # Build-time compiler (runs in Bun)
    cli/                       # CLI entry point, argument parsing, config resolution
    plugins/                   # esbuild plugin pipeline
      component-precompiler/   # CTFE: evaluates component setup at build time
      global-css-bundler/      # Bundles .css file imports as string exports
      html-bootstrap-injector/ # Injects mount() call into the root HTML file
      js-output-optimizer/     # Post-build JS optimizations
      minification/            # Selector & template whitespace minification
      post-build-processor/    # Final output processing (gzip, metafile, dev server)
      reactive-binding-compiler/ # Core: compiles html`` templates → DOM bindings (+ its tests)
      router-typegen/          # Generates .thane/types for type-safe routing
      routes-precompiler/      # Pre-processes defineRoutes() calls
      thane-linter/            # 12 compile-time lint rules (THANE400-411) (+ its tests)
      tsc-type-checker/        # TypeScript type checking integration
    testing/                   # Shared helpers for build-through tests (not published)
    utils/                     # Shared compiler utilities (HTML parser, AST helpers)
  contracts/                   # Compiler ↔ runtime shared constants
    compiler/                  # Binding kind enums, template edit types
    runtime/                   # Internal helper names, marker conventions
    syntax/                    # Directive and framework function name constants
  runtime/                     # Browser runtime (~3 KB gzip)
    signal.ts                  # signal(), computed(), effect(), batch(), untrack()
    component.ts               # defineComponent(), mount(), unmount(), style scoping
    dom-binding.ts             # when/whenElse conditionals, keyed repeat reconciler
    router.ts                  # defineRoutes(), navigate(), route matching, scroll restoration
    types.ts                   # Signal<T>, ReadonlySignal<T>, ComponentRoot
    index.ts                   # Public API barrel, global type declarations

e2e/                           # End-to-end Playwright browser tests
  contract-app/                # Test components exercising the compiler ↔ runtime contract
  router-app/                  # Router-specific test app
  cart-app/                    # Cart functionality test app
  browser-error-app/           # Dev-server error relay test app
  tests/                       # Playwright spec files
  .build/, test-results/       # Generated: app builds and Playwright output (ignored)

example-apps/
  benchmark/                   # js-framework-benchmark implementation (keyed reconciler stress test)
  store/thane/                 # E-commerce example app built with Thane (bun workspace member)
  store/react/                 # The same app built with React, for comparison

docs/                          # Developer documentation
  contributing/                # This guide: setup, testing, architecture, contracts
  assets/                      # Logo and images used by the README

scripts/                       # Repo maintenance scripts (bun scripts/apps.ts <types|typecheck>)
```

Unit tests sit next to the code they cover (`*.test.ts`); they are excluded from the published build.

## Compiler Pipeline

The build process is an **esbuild plugin pipeline**. Each plugin handles a specific transformation:

1. **Thane Linter** — scans source for patterns that would fail silently (THANE400-411)
2. **Component Precompiler** — evaluates `defineComponent` setup with CTFE (Compile-Time Function Evaluation)
3. **Reactive Binding Compiler** — transforms `html``\`\`` templates into static `<template>` elements plus `__b()` binding initializers
4. **Routes Precompiler** — processes `defineRoutes()` calls
5. **Router Typegen** — generates `.thane/types/router/` type definitions
6. **Global CSS Bundler** — converts `.css` imports to string exports
7. **Minification** — minifies selectors and whitespace in production
8. **TSC Type Checker** — runs TypeScript checking (errors/warnings)
9. **HTML Bootstrap Injector** — injects the compiled entry point into `index.html`
10. **JS Output Optimizer** — post-build JavaScript optimization
11. **Post-Build Processor** — gzip/brotli compression, metafile output

## Runtime Architecture

The runtime is intentionally minimal:

- **Signals** — reactive primitives with push-based notification and batching
- **Components** — `defineComponent` wrapper, factory pattern, scoped styles via `adoptedStyleSheets`
- **DOM Binding** — conditional rendering (`when`/`whenElse`) and keyed list reconciliation (`repeat`)
- **Router** — single-instance client-side router with History API, lazy loading, scroll restoration

The compiler generates a `__b(ctx)` function inside each component's return object that initializes all reactive bindings when the component mounts. This function uses `TreeWalker` to find comment markers placed during template compilation.

---

← [Back to Contributing](README.md)
