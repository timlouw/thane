# Contributing to Thane

Thanks for your interest in contributing. This guide consolidates the content that previously lived under the contributing folder into a single reference.

## Contents

- [Setup](#setup)
- [Testing](#testing)
- [Architecture](#architecture)
- [Contracts](#contracts)
- [Development Workflow](#development-workflow)
- [Reporting Issues](#reporting-issues)
- [License](#license)

## Setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [Node.js](https://nodejs.org/) >= 18 (for Playwright E2E tests only)
- Git

### Clone and Install

```bash
git clone https://github.com/timlouw/thane.git
cd thane
bun install
```

### Build

```bash
bun run build
```

This compiles the compiler and runtime into `dist/`.

## Testing

### Unit Tests

Run all unit tests under `src/` using Bun's built-in test runner:

```bash
bun run test
```

### E2E Browser Tests

E2E tests use [Playwright](https://playwright.dev/) and run across Chromium, Firefox, and WebKit.

```bash
# Install Playwright browsers (first time only)
bunx playwright install

# Run E2E tests
bun run e2e:test

# Run headed (visible browser)
bun run e2e:test:headed

# Run with Playwright UI
bun run e2e:ui
```

E2E tests live in `e2e/tests/` and cover rendering, directives, routing, component lifecycle, and the cart example app.

### Formatting

```bash
# Check formatting
bun run format:check

# Auto-fix formatting
bun run format
```

## Architecture

### Project Structure

```text
src/
	compiler/                    # Build-time compiler (runs in Bun)
		cli/                       # CLI entry point, argument parsing, config resolution
		plugins/                   # esbuild plugin pipeline
			component-precompiler/   # CTFE: evaluates component setup at build time
			global-css-bundler/      # Bundles .css file imports as string exports
			html-bootstrap-injector/ # Injects mount() call into the root HTML file
			js-output-optimizer/     # Post-build JS optimizations
			minification/            # Selector & template whitespace minification
			post-build-processor/    # Final output processing (gzip, metafile)
			reactive-binding-compiler/ # Core: compiles html`` templates into DOM bindings
			router-typegen/          # Generates .d.ts files for type-safe routing
			routes-precompiler/      # Pre-processes defineRoutes() calls
			thane-linter/            # 12 compile-time lint rules (THANE400-411)
			tsc-type-checker/        # TypeScript type checking integration
		utils/                     # Shared compiler utilities (HTML parser, AST helpers)
	contracts/                   # Compiler to runtime shared constants
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
	contract-app/                # Test components exercising the compiler to runtime contract
	router-app/                  # Router-specific test app
	cart-app/                    # Cart functionality test app
	tests/                       # Playwright spec files

benchmark/                     # Performance benchmark app (keyed reconciler stress test)
example-apps/thane-app/        # Full e-commerce example app
```

### Compiler Pipeline

The build process is an esbuild plugin pipeline. Each plugin handles a specific transformation:

1. Thane Linter - scans source for patterns that would fail silently (THANE400-411)
2. Component Precompiler - evaluates `defineComponent` setup with CTFE (Compile-Time Function Evaluation)
3. Reactive Binding Compiler - transforms `html`` templates into static `<template>` elements plus `__b()` binding initializers
4. Routes Precompiler - processes `defineRoutes()` calls
5. Router Typegen - generates `.thane/types/router/` type definitions
6. Global CSS Bundler - converts `.css` imports to string exports
7. Minification - minifies selectors and whitespace in production
8. TSC Type Checker - runs TypeScript checking (errors and warnings)
9. HTML Bootstrap Injector - injects the compiled entry point into `index.html`
10. JS Output Optimizer - post-build JavaScript optimization
11. Post-Build Processor - gzip and brotli compression, metafile output

### Runtime Architecture

The runtime is intentionally minimal:

- Signals - reactive primitives with push-based notification and batching
- Components - `defineComponent` wrapper, factory pattern, scoped styles via `adoptedStyleSheets`
- DOM Binding - conditional rendering (`when` and `whenElse`) and keyed list reconciliation (`repeat`)
- Router - single-instance client-side router with History API, lazy loading, scroll restoration

The compiler generates a `__b(ctx)` function inside each component's return object that initializes all reactive bindings when the component mounts. This function uses `TreeWalker` to find comment markers placed during template compilation.

## Contracts

The `src/contracts/` directory defines shared constants and types that both the compiler and the runtime depend on. This prevents stringly-typed coupling. If either side drifts, import errors or test failures catch it immediately.

### Structure

```text
src/contracts/
	index.ts                    # Barrel re-exports
	compiler/
		kinds.ts                  # Binding kind enums (text, attribute, style, event, etc.)
		bind-functions.ts         # Binding function name constants
		generated-artifacts.ts    # Compiler output artifact constants
		template-edits.ts         # Template edit and transform type constants
	runtime/
		internal-helpers.ts       # __b, __dc, __registerComponent - names the compiler emits
		router.ts                 # Router internal constant names
	syntax/
		directives.ts             # when(), whenElse(), repeat() function name constants
		framework-functions.ts    # html, css, signal, computed, etc. - names the linter checks
		tags.ts                   # Tagged template literal name constants (html, css)
```

### Policy

When a change touches compiler to runtime coupling:

1. Add or update values in `src/contracts/` first.
2. Import contract constants and types into compiler and runtime code. Do not duplicate string literals.
3. Keep compiler-generated helper names aligned with `src/contracts/runtime/internal-helpers.ts`.
4. Run both test suites to confirm the contract holds:

	 ```bash
	 bun run test
	 bun run e2e:test
	 ```

If you add a new directive, binding kind, or internal helper:

1. Add the constant to the appropriate contracts file.
2. Update the compiler plugin that emits it.
3. Update the runtime function that handles it.
4. Add unit tests and E2E tests confirming the round-trip.

## Development Workflow

1. Create a feature branch from `master`.
2. Make your changes.
3. Ensure all tests pass (`bun run test` and `bun run e2e:test`).
4. Ensure code is formatted (`bun run format:check`).
5. Open a pull request against `master`.

## Reporting Issues

Use the [GitHub issue tracker](https://github.com/timlouw/thane/issues) to report bugs or request features. Include reproduction steps and the Thane version when filing bugs.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
