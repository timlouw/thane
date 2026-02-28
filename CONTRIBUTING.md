# Contributing to Thane

Thanks for your interest in contributing to Thane! This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [Node.js](https://nodejs.org/) >= 18 (for Playwright E2E tests)
- Git

## Getting Started

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/<your-username>/thane.git
   cd thane
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Build the compiler and runtime:

   ```bash
   bun run build
   ```

## Running Tests

### Unit Tests

```bash
bun run test
```

Runs all unit tests under `src/` using Bun's built-in test runner.

### E2E Browser Tests

E2E tests use Playwright and run across Chromium, Firefox, and WebKit:

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

### Formatting

```bash
# Check formatting
bun run format:check

# Auto-fix formatting
bun run format
```

## Project Structure

```
src/
  compiler/          # Build-time compiler (esbuild plugins, CLI)
    cli/             # CLI entry point and argument parsing
    plugins/         # Compiler plugins (reactive bindings, minification, etc.)
    utils/           # Shared compiler utilities (HTML parser, AST helpers)
  runtime/           # Browser runtime (signals, components, DOM binding)
e2e/                 # End-to-end browser tests (Playwright)
benchmark/           # Performance benchmark app
```

## Development Workflow

1. Create a feature branch from `main`.
2. Make your changes.
3. Ensure all tests pass (`bun run test` and `bun run e2e:test`).
4. Ensure code is formatted (`bun run format:check`).
5. Open a pull request against `main`.

## Internal Contracts Policy

When a change touches compiler/runtime coupling, follow contracts-first rules:

- Add or update values in `src/contracts/**` first.
- Import contract constants/types into compiler/runtime; avoid new ad-hoc string literals for contract-bound values.
- Keep compiler-generated helper names aligned with `src/contracts/runtime/internal-helpers.ts`.
- Ensure contract-sensitive checks pass (`bun run test`, `bun run e2e:test`).

## Reporting Issues

Please use the [GitHub issue tracker](https://github.com/timlouw/thane/issues) to report bugs or request features. Include reproduction steps and the Thane version when filing bugs.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
