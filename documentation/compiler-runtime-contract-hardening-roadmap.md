# Compiler–Runtime Contract Hardening Roadmap

## Purpose

Establish a **single typed source of truth** for framework syntax, compiler IR/codegen contracts, and runtime internal ABI so that changes fail fast at compile time across:

- `src/compiler`
- `src/runtime`
- generated output emitted by the compiler

This roadmap follows a production-grade framework pattern used by large compiler/runtime systems (typed internal contracts + strict layer boundaries + conformance tests).

---

## Success Criteria

By the end of this plan:

1. No compiler/runtime coupling relies on ad-hoc string literals.
2. All emitted helper names and syntax tokens come from shared contracts.
3. Adding/removing syntax or helper APIs causes deterministic TypeScript compile errors in all affected layers.
4. Compiler output and runtime ABI compatibility is continuously validated by tests.
5. Architectural boundaries are documented and enforced.

---

## Current State (Observed)

### Strengths already present

- Clear split between `src/compiler` and `src/runtime`.
- Existing constants in `src/compiler/utils/constants.ts` (`FN`, `BIND_FN`, etc.).
- Existing internal runtime export surface in `src/runtime/internal.ts`.
- Existing test structure (unit and e2e) for compiler/runtime behavior.

### Gaps to close

- Constants are currently compiler-local, not a truly shared contract layer.
- Runtime internal helper names are exported, but contract ownership is not centralized.
- Some string unions and directive metadata still use local literal values.
- No explicit shared contract policy between codegen output and runtime internal ABI.

---

## Target Architecture (Industry Standard for this Scale)

Keep current top-level shape and introduce a shared internal contract layer.

```text
src/
  contracts/
    syntax/
      directives.ts
      tags.ts
      events.ts
      selectors.ts
    compiler/
      ast-kinds.ts
      ir-opcodes.ts
      template-edits.ts
      diagnostics.ts
    runtime/
      internal-helpers.ts
      dom-markers.ts
      hydration.ts          (if needed later)
    generated/
      artifact-schema.ts
      source-map-schema.ts  (if needed later)
    index.ts

  compiler/
    ...existing...

  runtime/
    ...existing...
```

### Why this structure

- `contracts/` is dependency-safe: both compiler and runtime may import from it.
- Domain-sliced files prevent a single monolithic constants file.
- Enables future extraction into a separate package without structural churn.

---

## Contract Design Standards

1. Use `as const` objects as canonical values.
2. Derive union types from values (`typeof X[keyof typeof X]`).
3. Use `satisfies` and mapped records for exhaustive coverage.
4. Prefer branded/string-literal types only where identity matters.
5. Keep contracts **internal** unless intentionally exposed in public API.
6. Prohibit raw literals for contract-bound values via lint + code review.

### Recommended pattern

```ts
export const RUNTIME_HELPER = {
  REGISTER_COMPONENT: '__registerComponent',
  REGISTER_COMPONENT_LEAN: '__registerComponentLean',
  ENABLE_STYLES: '__enableComponentStyles',
  DESTROY_CHILD: '__dc',
  BIND_IF: '__bindIf',
  BIND_IF_EXPR: '__bindIfExpr',
  KEYED_RECONCILER: 'createKeyedReconciler',
} as const;

export type RuntimeHelperName = typeof RUNTIME_HELPER[keyof typeof RUNTIME_HELPER];
```

---

## Implementation Plan (Phased)

## Phase 0 — Baseline and Inventory

### Goals

- Build a complete inventory of contract-like values across compiler/runtime.
- Establish migration order with low risk and high leverage.

### Tasks

- Inventory literals and union types in:
  - `src/compiler/utils/constants.ts`
  - `src/compiler/types.ts`
  - `src/compiler/plugins/**`
  - `src/runtime/internal.ts`
  - `src/runtime/index.ts`
- Classify each item into one of:
  - syntax token
  - compiler internal kind
  - runtime ABI helper
  - generated artifact key
- Define “must-be-shared” list (first-class contracts).

### Deliverables

- Inventory matrix document in `documentation/`.
- Approved migration order.

### Exit criteria

- No unknown contract-like literals left unclassified.

---

## Phase 1 — Introduce Shared Contract Layer

### Goals

- Create `src/contracts/**` with initial canonical modules.
- Wire exports from `src/contracts/index.ts`.

### Tasks

- Add modules:
  - `syntax/directives.ts` (`when`, `whenElse`, `repeat`)
  - `syntax/tags.ts` (`html`, `css`)
  - `runtime/internal-helpers.ts` (all `__*` helpers and reconciler name)
  - `compiler/template-edits.ts` (`remove`, `replace`, `insertId`)
- Move type unions from local files into these modules (or derive from constants).
- Replace compiler-local constants with imports from `src/contracts`.

### Deliverables

- New shared contracts folder committed.
- Existing compiler constants file slimmed or converted into a compatibility re-export wrapper.

### Exit criteria

- Compiler builds with all migrated values imported from `src/contracts`.

---

## Phase 2 — Runtime ABI Hardening

### Goals

- Make runtime internal ABI explicit and typed against shared contracts.

### Tasks

- In `src/runtime/internal.ts`, align exports with `RUNTIME_HELPER` contract names.
- Add compile-time verification map:
  - contract helper name -> actual export binding
- Ensure codegen imports helper names from contract constants only.

### Deliverables

- Runtime ABI contract file.
- Runtime internal exports validated by TS types.

### Exit criteria

- Renaming/removing helper names triggers compile errors in both runtime and compiler.

---

## Phase 3 — Compiler Pipeline Typing (AST/IR/Codegen)

### Goals

- Introduce typed intermediate representation and exhaustive transforms.

### Tasks

- Define AST/IR kind constants and unions in `src/contracts/compiler/*`.
- Refactor transform/codegen switches to exhaustive `never` checks.
- Replace free-form string node kinds/opcodes with derived unions.
- Ensure emitted artifact shape references `contracts/generated/artifact-schema.ts`.

### Deliverables

- Strongly typed AST/IR contracts used in transform and codegen paths.

### Exit criteria

- Adding an IR opcode without updating all handlers fails `tsc`.

---

## Phase 4 — Generated Code Contract Conformance

### Goals

- Lock codegen output shape and runtime expectations together.

### Tasks

- Add generated output schema types (helpers used, markers, metadata keys).
- Add golden/snapshot tests to validate emitted helper/token usage.
- Add runtime conformance tests that execute representative generated outputs.

### Deliverables

- Contract conformance test suite (compiler output + runtime execution).

### Exit criteria

- Contract mismatch between generated output and runtime fails CI.

---

## Phase 5 — Enforcement and Governance

### Goals

- Prevent regressions and stringly-typed backsliding.

### Tasks

- Add lint rule(s) or checks to disallow known raw literals outside contract modules.
- Add architecture rule doc: allowed dependency directions.
- Add PR checklist item: “new syntax/helper must be added to contracts first.”
- Add a changelog section for internal contract changes.

### Deliverables

- Enforced architectural policy in docs and CI.

### Exit criteria

- New PRs cannot introduce contract-bound literals ad hoc.

---

## Detailed Migration Mapping for Existing Files

## 1) Compiler constants and types

- `src/compiler/utils/constants.ts`
  - Keep temporary compatibility re-exports from `src/contracts` during transition.
  - Remove duplicated ownership after migration.

- `src/compiler/types.ts`
  - Migrate `TemplateEdit.type` union into `contracts/compiler/template-edits.ts`.
  - Re-export type alias for backward compatibility if needed.

## 2) Compiler plugin codegen paths

- `src/compiler/plugins/reactive-binding-compiler/index.ts`
- `src/compiler/plugins/reactive-binding-compiler/codegen.ts`
  - Replace any direct helper/directive/tag strings with contract imports.
  - Add exhaustive mappings for any helper selection logic.

## 3) Runtime internals

- `src/runtime/internal.ts`
  - Define contract-aligned export map and compile-time checks.

- `src/runtime/index.ts`
  - Align global declarations (`html`, `css`, `when`, `whenElse`, `repeat`) with shared syntax contracts.

---

## Compatibility Strategy

Assume compiler, runtime, and generated output are always updated together in lockstep.

- No explicit contract versioning constant is used.
- Compatibility is enforced through shared constants/types plus compile-time and test-time checks.

---

## Testing Strategy

## A. Compile-time checks

- `tsc` must fail for contract drift by design.
- Exhaustiveness checks required for AST/IR/opcode handling.

## B. Unit tests

- Contract modules: value + type-level tests.
- Compiler transforms/codegen: helper/token usage verification.
- Runtime ABI: helper map consistency tests.

## C. Integration / e2e

- Existing e2e suite extended with contract-sensitive scenarios:
  - directives (`when`, `whenElse`, `repeat`)
  - keyed reconciliation
  - component registration flow

## D. Snapshot policy

- Snapshot emitted code where useful, but prioritize semantic assertions to reduce brittleness.

---

## CI and Quality Gates

Add/adjust CI gates:

1. Type check (`tsc`) across compiler + runtime + contracts.
2. Unit tests for compiler/runtime/contracts.
3. e2e smoke for contract-sensitive paths.
4. Optional guard script scanning for banned raw literals (outside contracts modules).

No phase is considered complete unless all gates pass.

---

## Rollout Sequence (Low-Risk Order)

1. Shared syntax and helper constants
2. Template edit/type unions
3. Runtime ABI export typing
4. AST/IR/opcode contracts and exhaustive transforms
5. Generated artifact schema
6. Lint/CI enforcement hardening

This order minimizes breakage while increasing confidence early.

---

## Risks and Mitigations

- **Risk:** Over-centralized “god constants file”.
  - **Mitigation:** Domain-sliced contracts as shown above.

- **Risk:** Large migration PRs become unreviewable.
  - **Mitigation:** Ship phase-by-phase PRs with strict scope.

- **Risk:** Snapshot churn from codegen refactors.
  - **Mitigation:** Keep semantic assertions primary; snapshots secondary.

- **Risk:** Temporary duplicate constants during migration.
  - **Mitigation:** Time-box compatibility wrappers and remove after each phase.

---

## Definition of Done (Program Level)

The hardening program is complete when:

- Contract-bound values are defined once in `src/contracts/**`.
- Compiler, runtime, and generated output are coupled through typed contracts.
- Breaking contract changes are caught by TypeScript + CI before merge.
- Architectural boundaries and contributor rules are documented and enforced.

---

## Suggested Immediate Next Steps

1. Approve this roadmap.
2. Execute Phase 0 inventory and publish the matrix.
3. Implement Phase 1 in a focused PR introducing `src/contracts/**` and migrating helper/syntax constants first.
4. Land CI checks for contract drift immediately after Phase 1.
