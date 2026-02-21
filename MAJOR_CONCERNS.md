# Thane — Pre-Release Audit: Major Concerns

> **Audit date:** February 20, 2026
> **Scope:** Full codebase review — compiler, runtime, CLI, extensions, e2e, docs, website, packaging
> **Goal:** Identify all blockers and embarrassment risks before the first public production release

---

## Table of Contents

- [🔴 Section 1 — Release Blockers (Must Fix)](#-section-1--release-blockers-must-fix)
- [🟠 Section 2 — High Priority (Should Fix Before Release)](#-section-2--high-priority-should-fix-before-release)
- [🟡 Section 3 — Embarrassment Risks (Will Look Bad Under Review)](#-section-3--embarrassment-risks-will-look-bad-under-review)
- [🟢 Section 4 — Non-Blockers (Should Do Eventually)](#-section-4--non-blockers-should-do-eventually)

---

## 🔴 Section 1 — Release Blockers (Must Fix)

These are correctness bugs in the runtime that will cause real user-facing issues in production apps.

---

### 1.1 — `_notifyComputedSubs` has broken notification-depth tracking

**File:** `src/runtime/signal.ts` — `_notifyComputedSubs()` function (~line 198)

The `notifyCount` parameter is captured **by value** (it's a number), but the function increments/decrements it as if it were by reference. Trace through a call where the closure's `notifyCount` starts at `0`:

```
setNotifyCount(notifyCount + 1);  // parameter is 0, sets outer to 1 ✓
// ... notification loop ...
setNotifyCount(notifyCount - 1);  // parameter is STILL 0, sets outer to -1 ✗
if (notifyCount - 1 === 0)        // 0 - 1 === 0 → false ✗
```

**Consequences:**
- `notifyCount` drifts to -1, -2, -3… after each notification cycle
- **Null-slot compaction never fires** — subscriber arrays accumulate nulls (memory leak)
- On the 2nd+ notification, `notifyCount` is negative. Mid-notification unsubscribes will use `splice` instead of null-slotting → **corrupts iteration** (elements shift, subscribers are skipped)

**Fix:** Use the `setNotifyCount` return value or a local variable for the incremented value:
```ts
const nc = notifyCount + 1;
setNotifyCount(nc);
// ... loop ...
setNotifyCount(nc - 1);
if (nc - 1 === 0) { /* compact */ }
```

Compare with `_notifySubscribers` which works correctly because it operates on the mutable `fn._nc` property directly.

---

### 1.2 — Module-scoped `_keySet` causes reentrancy corruption in reconciler

**File:** `src/runtime/dom-binding.ts` — line 20

```ts
const _keySet = new Set<string | number>(); // single shared instance
```

In the general keyed reconciliation path (~line 368): the code populates `_keySet`, iterates old items checking membership, then calls `_keySet.clear()`. However, `removeItem()` runs cleanup callbacks during the iteration. If a cleanup triggers a signal update → subscriber notification → another `reconcile` call, the inner reconcile **populates and then clears the same `_keySet`**. When control returns to the outer reconcile, `_keySet` is empty — all remaining items fail the `has()` check and are **incorrectly removed** (data loss).

**Fix:** Use a function-local `Set` instead of the module-scoped singleton.

---

### 1.3 — `effect()` permanently dies after user function throws

**File:** `src/runtime/signal.ts` — `effect()` → `run()` inner function (~line 539)

```ts
const run = () => {
  // unsubscribe old deps...
  deps.clear();
  _activeTracker = tracker;
  try {
    fn();             // ← if this throws...
  } finally {
    _activeTracker = prev;
  }
  // ...these lines NEVER execute:
  for (const dep of deps) {
    unsubs.push(dep.subscribe(run, true));
  }
};
```

If the user's effect function throws, the `finally` block restores the tracker but the re-subscription loop never executes. The error is caught and deferred by the signal's notification loop, but the effect is **silently dead** with no recovery path. Future signal changes won't trigger it.

**Fix:** Move the subscription loop into the `finally` block, or wrap `fn()` in its own try/catch that doesn't abort the function:
```ts
try {
  fn();
} catch (err) {
  queueMicrotask(() => { throw err; });
} finally {
  _activeTracker = prev;
}
// subscription loop continues even after error
for (const dep of deps) {
  unsubs.push(dep.subscribe(run, true));
}
```

---

## 🟠 Section 2 — High Priority (Should Fix Before Release)

### 2.1 — No infinite-loop protection for circular signal dependencies

**File:** `src/runtime/signal.ts` — `_notifySubscribers()` pending flush (~line 180)

When `_notificationDepth` drops to 0, pending signals are flushed recursively. If signal A's subscriber writes signal B, and B's subscriber writes A, this creates unbounded recursion → **stack overflow** with no helpful error message. There's no depth limit or cycle detection.

**Fix:** Add a max recursion depth (e.g., 100) with a clear error: `"Circular signal dependency detected"`.

---

### 2.2 — `mount()` silently returns `null` on invalid component

**File:** `src/runtime/component.ts` — `mount()` (~line 420)

```ts
const factory = (component as unknown as ComponentRef).__f;
if (!factory) return null;
```

If someone passes an invalid component to `mount()`, they get `null` with no error, no warning, nothing. This is the most common user-facing API — it should fail loudly.

**Fix:** `throw new Error("mount(): invalid component — did you pass the return value of defineComponent()?")`.

---

### 2.3 — `new Function()` used for JS syntax validation in compiler

**File:** `src/compiler/utils/ast-utils.ts`

While the comment says "parses but does not execute", `new Function()` **does** compile the code into an executable function. If CSP (Content Security Policy) is enforced in the build environment (e.g., Electron-based tooling, locked-down CI), this will throw. Additionally, `new Function()` accepts top-level `return` that real module code wouldn't — it's not a perfect parse check.

**Fix:** Use `esbuild.transform()` for syntax checking — same tool already in the dependency tree.

---

### 2.4 — Hard Bun runtime dependency with no graceful error

**Files:** `src/compiler/cli/build.ts`, `src/compiler/cli/thane.ts`, `src/compiler/utils/file-utils.ts`

Multiple files use Bun-specific APIs (`Bun.file`, `Bun.serve`, `Bun.build`) without any runtime guard or fallback. If anyone tries to run the CLI with Node.js, they get cryptic `ReferenceError: Bun is not defined`.

**Fix:** At minimum, add a startup check in the CLI entry point:
```ts
if (typeof Bun === 'undefined') {
  console.error('Thane CLI requires the Bun runtime (https://bun.sh). Install it with: curl -fsSL https://bun.sh/install | bash');
  process.exit(1);
}
```

---

### 2.5 — E2E server has path traversal vulnerability

**File:** `e2e/server.ts`

The pathname from the request URL is joined directly to the root directory without sanitization. A request like `GET /../../../etc/passwd` could resolve outside the serve root via `path.resolve()` normalization. The `known-limitations.md` doc says the CLI dev server had this fixed — but this e2e test server has the exact same unfixed pattern.

**Fix:** `if (!filePath.startsWith(root)) return new Response('Forbidden', { status: 403 });`

---

### 2.6 — Command injection in CLI browser auto-open

**File:** `src/compiler/cli/build.ts`

The dev server's browser auto-open constructs a shell command via string concatenation: `` exec(`${cmd} ${url}`) ``. If the server URL somehow contains shell metacharacters, this is exploitable.

**Fix:** Use `execFile` or `spawn` with argument arrays instead of `exec()`.

---

### 2.7 — Silent empty catch blocks swallow actionable errors

**Files:** Multiple compiler files

- `file-utils.ts`: `catch {}` when calling `stat()` — if stat fails for reasons other than "file doesn't exist" (permissions, disk error), the build silently reports wrong file sizes.
- Build/CTFE evaluation: silently returns `undefined` on any error including OOM or stack overflow.

**Fix:** At minimum, log caught errors at verbose level via the existing logger utility.

---

### 2.8 — Regex-based JS transforms in `js-output-optimizer` are fragile

**File:** `src/compiler/plugins/js-output-optimizer/`

The comment at the top of the file honestly admits these transforms are **"FRAGILE"** and depend on esbuild's specific minified output format. The `,+]` → `]` replacement could incorrectly remove intentional trailing commas in array destructuring. The `;+$` replacement could break sourcemaps.

**Risk:** Silent code corruption after esbuild version upgrades.

---

### 2.9 — XSS vulnerability in uncompiled `html` shim path

**File:** `src/runtime/index.ts` + `src/runtime/component.ts`

The runtime `html` shim does raw string concatenation:
```ts
export const html = (strings: TemplateStringsArray, ...values: unknown[]): string =>
  String.raw({ raw: strings }, ...values);
```

Any interpolated user input passes through unescaped — a direct XSS vector. The compiled path uses proper bindings, so this only affects the uncompiled shim (tests, SSR, REPL). But those are explicitly listed as use-cases in the code comments.

**Fix:** At minimum, escape HTML entities in interpolated values in the shim, or add prominent JSDoc warnings.

---

### 2.10 — Computed `.subscribe()` silently drops errors

**File:** `src/runtime/signal.ts` — computed subscribe (~line 453)

```ts
if (hasError) {
  // Don't call subscriber with stale value if there's an error
} else {
  cb(value);
}
```

If a computed's derivation threw, subscribing gives the caller **nothing** — no value, no error, no indication. The subscriber is simply never called.

---

## 🟡 Section 3 — Embarrassment Risks (Will Look Bad Under Review)

These won't break user apps but will draw negative attention from framework reviewers and OSS contributors.

---

### 3.1 — Global namespace pollution via `declare global`

**File:** `src/runtime/index.ts`

The module declares `html`, `css`, `when`, `whenElse`, `repeat`, `navigate`, `navigateBack`, `getRouteParam` as **global functions**. This means every TypeScript file in a project that depends on thane gets these globals in scope, potentially shadowing or conflicting with other libraries. Framework globals should use a namespace prefix or be opt-in (e.g., via a `/// <reference types="thane/globals" />` directive).

---

### 3.2 — Inconsistent logging — raw `console.log` vs. structured logger

**Files:** `src/compiler/cli/build.ts`, `src/compiler/plugins/` (multiple)

~20 direct `console.log` calls bypass the existing structured logger utility (`src/compiler/utils/logger.ts`). This means the `--silent` flag and log-level controls are bypassed for significant portions of build output.

---

### 3.3 — Hardcoded ANSI escape codes bypass `NO_COLOR` support

**File:** `src/compiler/cli/build.ts`

Hardcoded `'\x1b[32m'`, `'\x1b[33m'`, etc. are used instead of the existing `colors.ts` utility which respects `NO_COLOR` and TTY detection. This violates the [NO_COLOR standard](https://no-color.org/) — color output appears even when piped to a file or when `NO_COLOR=1` is set.

---

### 3.4 — Test count contradictions across surfaces

| Surface | Claim |
|---------|-------|
| Website homepage | "158+ unit tests" |
| README.md | "204 unit tests" |
| `CONTRACT_GAPS.md` | "10/10 browser contract tests" (actual: 36) |

Contradictory numbers across surfaces destroy credibility. Either automate the count from CI output or use relative claims ("comprehensive test suite").

---

### 3.5 — Website releases page shows stale version

**File:** `website/src/releases-page.ts`

Labels **v0.0.101** as "Latest" but the package version is **0.0.112+** (many releases behind). Only two releases are listed. External visitors will think the project is stale.

---

### 3.6 — No `CHANGELOG.md`, `CONTRIBUTING.md`, or `CODE_OF_CONDUCT.md`

Standard OSS files expected for a published npm package. Their absence signals the project isn't community-ready.

---

### 3.7 — Author name inconsistency

- `package.json`: "Tim Louw"
- `LICENSE`: "Timothy Louw"
- Website: "Timothy Louw"

Pick one and use it everywhere.

---

### 3.8 — E2E test results committed to source

**Directory:** `e2e/test-results/` (contains screenshot directories from failed test runs)

Test result artifacts (screenshots, traces) appear to be committed to the repository. These are CI artifacts that balloon repo size and create noisy diffs. Should be in `.gitignore`.

---

### 3.9 — Duplicated whitespace-collapsing regex chains (7+ copies)

The pattern for collapsing whitespace in HTML templates appears **at least 7 times** across various compiler plugin files. Some variants include comment-preservation and others don't — **inconsistent behavior**. Should be a single shared utility function.

---

### 3.10 — Duplicated template escape sequences applied manually everywhere

The pattern for escaping backticks and `${` in template literals appears dozens of times across `codegen.ts` instead of being a single `escapeTemplateLiteral()` utility. Easy to forget one of the replacements and introduce a template injection bug.

---

### 3.11 — `codegen.ts` is a 1684-line God file

**File:** `src/compiler/plugins/reactive-binding-compiler/codegen.ts`

A single file generates all binding code. The main function spans ~1000 lines with deeply nested logic for conditionals, whenElse, and repeat blocks. Extremely difficult to review, test, or maintain. High bug density zone.

---

### 3.12 — No runtime tests for DOM binding or component system

**File:** `src/runtime/signal.test.ts`

The test file only covers `signal`, `computed`, `batch`, `effect`, and `untrack`. **Zero tests** for:
- `dom-binding.ts` — `bindConditional`, `createKeyedReconciler`
- `component.ts` — `defineComponent`, `mount`, `unmount`, lifecycle hooks
- Error recovery scenarios (effect throwing, computed error caching)
- Mid-notification unsubscribe on computed (would catch blocker 1.1)
- Reentrant reconciler (would catch blocker 1.2)

---

### 3.13 — `mount()` target parameter has non-null assertion that will crash

**File:** `src/runtime/component.ts` — factory function (~line 244)

```ts
const factory = (target?: HTMLElement, props?: P): ComponentInstance => {
  target!.classList.add(selector);  // TypeError if target is undefined
```

The `target` parameter is typed as optional, but the first line uses a non-null assertion. If called without a target, users get `TypeError: Cannot read properties of undefined (reading 'classList')` — deeply unhelpful.

---

### 3.14 — VS Code extension missing `publisher` field

**File:** `extensions/tagged-templates/package.json`

Missing `publisher` field, which is **required** to publish to the VS Code Marketplace. Even if not publishing yet, it signals the extension isn't marketplace-ready.

---

### 3.15 — Empty source file committed

**File:** `src/compiler/plugins/routes-precompiler/` (or similar — empty file in the plugin directory)

An empty or placeholder file was found in the compiler plugins. Empty files in the source tree signal abandoned work. Delete or add content.

---

### 3.16 — `declare global` shims missing for `whenElse`, `repeat`, `navigate`, etc.

**File:** `src/runtime/index.ts`

`html` and `css` have runtime shim implementations, but the other global declarations (`when`, `whenElse`, `repeat`, `navigate`, `navigateBack`, `getRouteParam`) are **declare-only** with no fallback. Users in uncompiled environments (tests, REPL — the stated use-cases for shims) will get `ReferenceError: whenElse is not defined`.

---

### 3.17 — Adopted stylesheets only grow, never shrink

**Files:** `src/runtime/component.ts` — `registerGlobalStyles()` and `__enableComponentStyles()`

Both functions append to `document.adoptedStyleSheets` but never remove sheets. In long-lived SPAs with dynamic component loading/unloading, stylesheets accumulate forever. Worth documenting as intentional or adding cleanup.

---

### 3.18 — Benchmark `package.json` depends on a hardcoded `.tgz` file

**File:** `benchmark/package.json`

```json
"thane": "file:../thane-0.0.113.tgz"
```

Depends on a specific packed tarball existing at the parent directory. Anyone cloning the repo fresh will fail on `bun install`. Should use a workspace reference like the website does, or document the pack step.

---

### 3.19 — `as any` casts in codegen indicate type model gap

**File:** `src/compiler/plugins/reactive-binding-compiler/codegen.ts`

Multiple `as any` casts bridge between binding types, indicating the discriminated union type doesn't properly model all variants. This silently opts out of type checking in critical code generation paths.

---

## 🟢 Section 4 — Non-Blockers (Should Do Eventually)

These are quality-of-life improvements that don't affect correctness or public perception.

1. **Computed re-subscribes to all dependencies on every change** — `evaluate()` calls unsubscribe + resubscribe for all deps every time. O(n²) per change for computed signals with many dependencies. Consider a version-number approach.

2. **No npm publish/release automation in CI** — `.github/workflows/ci.yml` exists for testing but there's no release workflow.

3. **Cache size is hardcoded** — `src/compiler/utils/cache.ts` has a hardcoded 500-entry limit. Large projects will thrash the cache. Make it configurable.

4. **File watcher debounce timers not cleaned on process exit** — Minor resource leak on process shutdown in watch mode.

5. **`process.exit(0)` in CLI help/version** — Prevents registered cleanup handlers from running.

6. **Duplicate `Range` interface definitions** across compiler utility files — should be in shared types.

7. **Extension and main package version drift** — Extension at `0.1.0`, main package at `0.0.112`. Consider whether they should be in sync.

8. **No `.gitignore` in benchmark directory** — Risk of accidentally committing build artifacts.

9. **Extension linter imports compiler via deep relative path** — `'../../../src/compiler/plugins/thane-linter/rules/index.js'` is fragile.

10. **Website `#app` div is unused** — `mount()` is called with no target (defaults to `document.body`), but the HTML has `<div id="app"></div>`. Inconsistent with the framework's own patterns.

11. **Generous Playwright timeouts** — 60s test + 180s webServer timeouts could mask hung builds in CI.

12. **Deprecated `container` field in `RepeatBinding` type** — Marked as deprecated and "no longer used" but still present. Remove it.

---

## Summary

| Severity | Count | Action Required |
|----------|-------|----------------|
| 🔴 **Release Blockers** | 3 | Must fix — correctness bugs in signal/effect/reconciler |
| 🟠 **High Priority** | 10 | Should fix — security, error handling, DX issues |
| 🟡 **Embarrassment Risks** | 19 | Polish before external review — code quality, docs, consistency |
| 🟢 **Non-Blockers** | 12 | Track for post-release |

### Top 5 Actions for Fastest Path to Release

1. **Fix `_notifyComputedSubs` notify count bug** (Blocker 1.1) — ~15 min fix
2. **Make `_keySet` function-local** (Blocker 1.2) — ~5 min fix
3. **Move effect subscription into finally/post-catch** (Blocker 1.3) — ~10 min fix
4. **Add circular dependency protection** (High 2.1) — ~30 min
5. **Make `mount()` throw on invalid component** (High 2.2) — ~5 min

These 5 fixes address all 3 blockers and the 2 most impactful DX issues, and should take under 2 hours total.
