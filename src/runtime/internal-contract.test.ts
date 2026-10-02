import { describe, expect, test } from 'bun:test';
import { RUNTIME_HELPER, type RuntimeHelperName } from '../contracts/index.js';
import {
  __batchRows,
  __T,
  __nc,
  __bindIf,
  __bindIfExpr,
  __dc,
  __rc,
  __mf,
  __enableComponentStyles,
  __enableKeyframeScoping,
  __registerComponent,
  __registerComponentLean,
  createKeyedReconciler,
  __sig,
  mountComponent,
  __hotSignal,
} from './internal.js';

describe('runtime internal contract', () => {
  const expected: Record<RuntimeHelperName, unknown> = {
    [RUNTIME_HELPER.IF]: __bindIf,
    [RUNTIME_HELPER.IF_EXPR]: __bindIfExpr,
    [RUNTIME_HELPER.KEYED_RECONCILER]: createKeyedReconciler,
    [RUNTIME_HELPER.BATCH_ROWS]: __batchRows,
    [RUNTIME_HELPER.TEMPLATE]: __T,
    [RUNTIME_HELPER.NO_CLEANUPS]: __nc,
    [RUNTIME_HELPER.ENABLE_STYLES]: __enableComponentStyles,
    [RUNTIME_HELPER.ENABLE_KEYFRAMES]: __enableKeyframeScoping,
    [RUNTIME_HELPER.REGISTER_COMPONENT]: __registerComponent,
    [RUNTIME_HELPER.REGISTER_COMPONENT_LEAN]: __registerComponentLean,
    [RUNTIME_HELPER.DESTROY_CHILD]: __dc,
    [RUNTIME_HELPER.ROW_CHILD]: __rc,
    [RUNTIME_HELPER.MOUNT_FRAGMENT]: __mf,
    [RUNTIME_HELPER.SIGNAL]: __sig,
    [RUNTIME_HELPER.MOUNT_COMPONENT]: mountComponent,
    [RUNTIME_HELPER.HOT_SIGNAL]: __hotSignal,
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
    expect(expected[RUNTIME_HELPER.BATCH_ROWS]).toBe(__batchRows);
    expect(expected[RUNTIME_HELPER.TEMPLATE]).toBe(__T);
    expect(expected[RUNTIME_HELPER.NO_CLEANUPS]).toBe(__nc);
    expect(expected[RUNTIME_HELPER.ENABLE_STYLES]).toBe(__enableComponentStyles);
    expect(expected[RUNTIME_HELPER.REGISTER_COMPONENT]).toBe(__registerComponent);
    expect(expected[RUNTIME_HELPER.REGISTER_COMPONENT_LEAN]).toBe(__registerComponentLean);
    expect(expected[RUNTIME_HELPER.DESTROY_CHILD]).toBe(__dc);
    expect(expected[RUNTIME_HELPER.ROW_CHILD]).toBe(__rc);
    expect(expected[RUNTIME_HELPER.SIGNAL]).toBe(__sig);
    expect(expected[RUNTIME_HELPER.MOUNT_COMPONENT]).toBe(mountComponent);
    expect(expected[RUNTIME_HELPER.HOT_SIGNAL]).toBe(__hotSignal);
  });
});
