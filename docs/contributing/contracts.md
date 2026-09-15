# Contracts

The `src/contracts/` directory defines shared constants and types that both the compiler and the runtime depend on. This prevents stringly-typed coupling — if either side drifts, import errors or test failures catch it immediately.

## Structure

```
src/contracts/
  index.ts                    # Barrel re-exports
  compiler/
    kinds.ts                  # Binding kind enums (text, attribute, style, event, etc.)
    bind-functions.ts         # Binding function name constants
    generated-artifacts.ts    # Compiler output artifact constants
    template-edits.ts         # Template edit / transform type constants
  runtime/
    internal-helpers.ts       # __b, __dc, __registerComponent — names the compiler emits
    router.ts                 # Router internal constant names
  syntax/
    directives.ts             # when(), whenElse(), repeat() function name constants
    framework-functions.ts    # html, css, signal, computed, etc. — names the linter checks
    tags.ts                   # Tagged template literal name constants (html, css)
```

## Policy

When a change touches compiler ↔ runtime coupling:

1. **Add or update values** in `src/contracts/` first.
2. **Import contract constants/types** into compiler and runtime code — never duplicate string literals.
3. **Keep compiler-generated helper names** aligned with `src/contracts/runtime/internal-helpers.ts`.
4. **Run both test suites** to confirm the contract holds:
   ```bash
   bun run test
   bun run e2e:test
   ```

If you add a new directive, binding kind, or internal helper:

1. Add the constant to the appropriate contracts file.
2. Update the compiler plugin that emits it.
3. Update the runtime function that handles it.
4. Add unit tests and E2E tests confirming the round-trip.

---

← [Back to Contributing](README.md)
