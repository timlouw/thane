import { describe, expect, test } from 'bun:test';
import { RUNTIME_HELPER, type RuntimeHelperName } from '../contracts/index.js';
import {
  __bindIf,
  __bindIfExpr,
  __dc,
  __enableComponentStyles,
  __registerComponent,
  __registerComponentLean,
  createKeyedReconciler,
} from './internal.js';

describe('runtime internal contract', () => {
  const expected: Record<RuntimeHelperName, unknown> = {
    [RUNTIME_HELPER.IF]: __bindIf,
    [RUNTIME_HELPER.IF_EXPR]: __bindIfExpr,
    [RUNTIME_HELPER.KEYED_RECONCILER]: createKeyedReconciler,
    [RUNTIME_HELPER.ENABLE_STYLES]: __enableComponentStyles,
    [RUNTIME_HELPER.REGISTER_COMPONENT]: __registerComponent,
    [RUNTIME_HELPER.REGISTER_COMPONENT_LEAN]: __registerComponentLean,
    [RUNTIME_HELPER.DESTROY_CHILD]: __dc,
  };

  test('expected map covers all runtime helper names', () => {
    const helperNames = Object.values(RUNTIME_HELPER);
    const abiKeys = Object.keys(expected);
    expect(new Set(abiKeys)).toEqual(new Set(helperNames));
  });

  test('runtime exports satisfy ABI map shape', () => {
    expect(expected[RUNTIME_HELPER.IF]).toBe(__bindIf);
    expect(expected[RUNTIME_HELPER.IF_EXPR]).toBe(__bindIfExpr);
    expect(expected[RUNTIME_HELPER.KEYED_RECONCILER]).toBe(createKeyedReconciler);
    expect(expected[RUNTIME_HELPER.ENABLE_STYLES]).toBe(__enableComponentStyles);
    expect(expected[RUNTIME_HELPER.REGISTER_COMPONENT]).toBe(__registerComponent);
    expect(expected[RUNTIME_HELPER.REGISTER_COMPONENT_LEAN]).toBe(__registerComponentLean);
    expect(expected[RUNTIME_HELPER.DESTROY_CHILD]).toBe(__dc);
  });
});
