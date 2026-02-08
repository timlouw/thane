# Thane v0.0.7 — Robustness & Cleanup

> **Constraint:** No changes to compiled output or runtime behavior. Performance is locked in at 1.09×.  
> Everything here is dead code removal, naming corrections, type safety, error handling, and code hygiene.

---

## Group A — Dead Code Removal

### A1. Remove `globalStyleManager` from runtime
- `component.ts` L82-85: no-op stub with empty `register()` method
- `index.ts` L65: re-exported but never imported by any consumer
- **Action:** Delete the export from both files

### A2. Remove `generateComponentHTML` from runtime
- `component.ts` L259-265: delegates to `createComponentHTMLSelector` internally (we made this change in v0.0.6)
- `index.ts` L69: re-exported but never imported — the compiler uses its own version from `ast-utils.ts`
- **Action:** Delete the function and its re-export

### A3. Remove `getSelectorMap` from minification
- `minification.ts` L93: exported but zero importers in the codebase
- The `activeSelectorMap` module-level variable it exposes is a cross-plugin side channel — removing the accessor tightens encapsulation
- **Action:** Delete the export

### A4. Remove dead `SelectorMap` methods and reverse map
- `selector-minifier.ts`: `getMinified()` and `getOriginal()` are never called
- The `minifiedToOriginal` Map backing `getOriginal()` is maintained for nothing
- **Action:** Delete both methods and the reverse map. Keep `register()`, `entries()`, `size`, `clear()`

### A5. Remove dead source-editor exports
- `source-editor.ts`: `insertAt`, `replaceRange`, `getLineAndColumn`, `getPosition` are exported but never imported by any consumer outside the barrel
- Only `applyEdits` (used by reactive-binding-compiler) and `removeCode` (used by register-component-stripper) have real consumers
- **Action:** Remove the 4 dead functions. Update the barrel export in `utils/index.ts`

### A6. Remove `processFileWithAST` from plugin-helper
- `plugin-helper.ts` L20-51: exported and re-exported from the barrel, but zero call sites in the entire codebase
- **Action:** Delete the function, its `ProcessResult` and `ProcessOptions` interfaces, and the barrel re-export

### A7. Remove `hasHtmlTemplates` from plugin-helper
- `plugin-helper.ts` L66-68: exported but never imported anywhere
- **Action:** Delete the function

---

## Group B — Naming & Structural Honesty

### B1. Rename dead-code-eliminator → post-build-compressor
- Directory: `dead-code-eliminator/` → `post-build-compressor/`
- File: `dead-code-eliminator.ts` → `post-build-compressor.ts`
- Export: `DeadCodeEliminatorPlugin` → `PostBuildCompressorPlugin`
- The plugin's own `NAME` constant already says `'post-build-compressor'`
- Update all import sites (`plugins/index.ts`, `cli/build.ts`)

### B2. Fix misleading comment in minification.ts
- L10: Comment says "Instance-scoped SelectorMap — avoids module-level mutable state" — but `activeSelectorMap` **is** module-level mutable state. The local `selectorMap` inside `setup()` is instance-scoped, but the module-level `let` is the problem
- **Action:** Rewrite comment to honestly document the pattern: `activeSelectorMap` is module-level state set per-build in `onStart`. Safe because esbuild serializes builds, but not safe for hypothetical concurrent builds

---

## Group C — Error Handling & Robustness

### C1. Add logging to silent catch blocks in file-copy.ts
- L24: empty `catch {}` after `recursivelyCopyAssetsIntoDist` — if the source dir is missing or permissions fail, zero diagnostic info
- L76: empty `catch {}` in watcher handler — comment says "race conditions" but logs nothing
- **Action:** Add `logger.debug` with the error so issues are at least traceable. Keep the non-throwing behavior

### C2. Replace `console.warn` with logger in binding-detection.ts
- L174: `console.warn` for invalid trackBy function — bypasses the framework's logger which respects log levels and formatting
- **Action:** Replace with `logger.warn`

### C3. Replace `console.error` with logger in dev-server.ts
- L31: `console.error` in `promptForPort` for invalid port
- L138: `console.error` for port in use
- **Action:** Replace with `logger.error` for consistency. Note: `console.info` at L143-147 is fine — it's user-facing server output

### C4. Harden `mountComponent` regex
- `component.ts` L219: `/<([^>]+)>/` would match attributes in edge cases like `<my-page class="foo">`
- **Action:** Replace with `/<([a-z][a-z0-9-]*)/i` — only captures the tag name, stops at whitespace or `>`

---

## Group D — Type Safety

### D1. Eliminate `as any` casts in parser-core.ts
- 5 occurrences where the parser constructs an `HtmlElement` as a mutable object, then sets discriminant fields (`isSelfClosing`, `whenDirective*`)
- Root cause: `createEmptyElement()` returns a fixed type but the parser needs to mutate it
- **Action:** Change `createEmptyElement()` to return a mutable builder type, then freeze into the discriminated union at `pushElement` time. Or use type assertion helpers like `markSelfClosing(el)` that narrow correctly

### D2. Make exported `/g` regexes safe in html-parser/types.ts
- 6 regexes exported with `/g` flag: `WHEN_ELSE_REGEX`, `REPEAT_REGEX`, `SIGNAL_EXPR_REGEX`, `SIGNAL_CALL_REGEX`, `STYLE_EXPR_REGEX`, `ATTR_EXPR_REGEX`
- All callers currently reset `lastIndex` before use — but any new caller that forgets will get stale-match bugs
- **Action:** Either (a) export factory functions that return fresh instances, or (b) export the patterns as strings and let callers construct their own, or (c) move to non-global regexes with `matchAll()` where applicable

---

## Group E — Dev Server Robustness

### E1. Replace sync file ops in HTTP handler
- `dev-server.ts` L127: `fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()` — blocks the event loop on every HTTP request
- **Action:** Replace with `await fs.promises.stat()` wrapped in try/catch

---

## Group F — Compiler Hygiene

### F1. Deduplicate fallback code in component-precompiler
- `component-precompiler.ts`: Three near-identical code paths doing `transformExpression → stripThisAccess → replace html\`/css\` → createLoaderResult`
- **Action:** Extract a `buildTransformedResult(source, expressions)` helper

---

## Validation Checklist

After all changes:
- [ ] `bun test` — all 49 signal tests pass
- [ ] `tsc --noEmit` — clean build
- [ ] `npm run build` — tsc compiles successfully
- [ ] Benchmark dev build — succeeds, output unchanged
- [ ] Benchmark prod build — succeeds, output unchanged  
- [ ] Prod bundle size — still ~10.47 KB (may decrease slightly from dead code removal)
- [ ] `npm pack` — produces valid tarball

