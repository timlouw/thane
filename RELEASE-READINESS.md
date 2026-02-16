# Thane — Release Readiness Audit

> Generated: February 2026 · Updated: February 2026 · Covers: full `src/`, `e2e/`, `benchmark/`, `extensions/`, CLI, and project infrastructure

---

## Executive Summary

Thane is architecturally sound, with a clean compile-time component model, minimal runtime (~3 KB), strong signal primitives, and a well-designed esbuild plugin pipeline. Recent hardening addressed many critical issues: dev server path traversal, signal subscriber resilience, async compilation bottlenecks, CLI test coverage, and added `computed()`, `batch()`, and `effect()` primitives.

The remaining items below are what's left to address before a production v1.0 release.

---

## ✅ Recently Completed

| # | Item | Resolution |
|---|------|------------|
| 2 | Empty CLI test file | Comprehensive tests added for `parseArgs`, `createBuildConfig`, `resolveCLIOptions`, `printHelp`, `printVersion` |
| 3 | Dev server path traversal | `path.resolve()` + `startsWith()` guard added; returns 403 for breakout attempts |
| 4 | XSS in analyzer HTML | Analyzer removed entirely (not needed for v1.0) |
| 9 | Sync type checker blocks build | Type checking now runs asynchronously via `Promise` |
| 10 | Sync Brotli compression | Replaced `brotliCompressSync` with async `brotliCompress` in compression.ts and dev-server.ts |
| 12 | No extension automated tests | Added `extension.test.ts` with grammar generation, mapping, and autocomplete pattern tests |
| 13 | Signal subscriber throws | Try/catch added around each subscriber call; errors reported via `queueMicrotask` |
| 17 | Hardcoded browser targets | Extracted to `BROWSER_TARGETS` in `constants.ts`, referenced from `build.ts` |
| 18 | Source cache unbounded | LRU eviction added with configurable max size (default 500) |
| 19 | Source editor overlapping edits | Validation pass rejects overlapping ranges with descriptive error |
| 21 | Key guard logic bug | Changed `\|\|` to `&&` — multi-key modifiers now work correctly |
| 22 | No `--verbose`/`--quiet` CLI flags | Added `--verbose`/`-V` and `--quiet`/`-q` flags, wired to logger |
| 23 | ANSI colors not disabled for non-TTY | `colors.ts` now detects `isTTY`, `NO_COLOR`, and `FORCE_COLOR` |
| 44 | Stale README test counts | Updated to reflect current counts |
| 46 | Prettier `printWidth: 180` | Changed to 120 |
| 47 | No `computed()` primitive | Added tree-shakable `computed()` with auto-tracking |
| 48 | No `batch()` API | Added tree-shakable `batch()` with nested batch support |
| 49 | No `effect()` API | Added tree-shakable `effect()` with auto-tracking and dispose |
| 53 | `as any` casts | Added `ComponentRef` and `SetupWithSelector` interfaces; eliminated `as any` from component.ts |
| — | Analyzer removal | Entire `cli/analyzer/` folder deleted; all imports, types, CLI commands, and README references cleaned up |
| — | Extension autocomplete | Added `HtmlTemplateCompletionProvider` for HTML element, attribute, and Thane directive completion inside `html\`\`` tags |

---

## 🔴 P0 — Must Fix Before Release

### 1. Zero Unit Tests for Core Runtime APIs (component, dom-binding, mount)

`defineComponent`, `__registerComponent`, `mount`, `__bindIf`, `__bindIfExpr`, and `createKeyedReconciler` have **zero** unit tests.

### 5. Version String is `0.0.66` — No Semantic Versioning Strategy

Establish a versioning strategy, add a `CHANGELOG.md`, consider a release script.

### 6. No CHANGELOG

There is no `CHANGELOG.md` anywhere in the repo.

---

## 🟠 P1 — Strongly Recommended Before Release

### 7. Bun-Only Runtime — No Node.js Fallback

Document Bun as a hard requirement or add Node.js fallback paths.

### 8. `new Function()` / `vm.runInContext` Used for CTFE

Document the trust assumption explicitly if templates come only from developer source code.

### 11. Giant Monolithic Functions — Maintainability Risk

`codegen.ts` (~1,400 lines), `template-processing.ts` (~890 lines). Break into sub-functions.

### 14. Module-Level Mutable Singleton State

`component-precompiler.ts` uses module-level `selectorMap`. Multiple concurrent builds could clobber each other.

---

## 🟡 P2 — Should Fix

### 16. `process.exit()` in Argument Parser

`--help`/`--version` call `process.exit(0)` deep inside the parse function.

### 20. Selector Minification Could Collide

Generated short names like `a`, `b` could collide with user CSS.

### 24. Missing MIME Types in Dev/E2E Servers

Missing `.woff`, `.woff2`, `.gif`, `.webp`, `.ico`, `.wasm`.

### 25. Duplicated Fallback Repeat Renderer

Near-identical 30-line blocks in `codegen.ts`.

### 27. String-Based Placeholder Pattern is Fragile

`__REGISTER_PLACEHOLDER__` could collide with user code.

### 28. File Watcher Handles Never Disposed

Resource leak on long-running dev sessions.

### 29. `process.cwd()` as Implicit Workspace Root

Breaks if CLI is invoked from a different directory.

### 30. Routes Precompiler Uses Fragile Path Check

Simple `.includes('router')` check may false-match.

---

## 🟢 P3 — Nice to Have / Polish

- Code coverage tooling (`bun test --coverage`)
- Snapshot tests for compiler output
- E2E tests: use `Page` type, decompose monolithic tests
- E2E: `onDestroy` for child components, error boundaries, routing
- Benchmark reproducibility and warm-up runs
- VS Code extension: `publisher` field, async file APIs
- Accessibility tests (ARIA, keyboard nav, focus management)
- Playwright retry on CI, HTML reporter
- `registerGlobalStyles` spec-compliant `adoptedStyleSheets` assignment
- Top-level `unmount()` convenience API

---

## ✅ What's Already Good

| Area | Assessment |
|------|------------|
| **Signal implementation** | Clean, performant, shared-subscribe, try/catch resilience, `batch()`, `computed()`, `effect()` |
| **Compile-time architecture** | Static template cloning, comment-marker bindings, TreeWalker navigation |
| **Lint rules** | 12 rules with comprehensive documentation |
| **esbuild plugin pipeline** | Clean ordering, proper `onLoad`/`onEnd` separation |
| **CSS scoping** | Class-based with `adoptedStyleSheets`, no Shadow DOM overhead |
| **Keyed reconciler** | Multiple fast paths (swap, single-remove, bulk-create) |
| **E2E contract tests** | 18 tests across 3 browser engines |
| **TypeScript strictness** | Maximum strictness enabled |
| **Bundle size** | ~3 KB gzipped runtime |
| **CLI** | Full flag set with `--verbose`/`--quiet`, config file support, TTY-aware colors |
| **Tree-shaking** | `batch()`, `computed()`, `effect()` are fully tree-shakable |
| **Documentation** | Comprehensive README with examples and architecture explanation |
| **Security** | Dev server path traversal hardened, async compression |

---

## Summary Scorecard

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 P0 — Must Fix | 3 | Remaining |
| 🟠 P1 — Strongly Recommended | 4 | Remaining |
| 🟡 P2 — Should Fix | 8 | Remaining |
| 🟢 P3 — Nice to Have | ~10 | Polish |
| ✅ Completed | **21** | Done |
