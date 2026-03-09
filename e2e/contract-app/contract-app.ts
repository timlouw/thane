import { defineComponent, signal, registerGlobalStyles } from 'thane';
import { batch, computed, effect } from 'thane';
import { mountComponent } from 'thane';
import type { MountHandle } from 'thane';
import { ChildCounter } from './child-counter.js';
import { StyledChild } from './styled-child.js';
import { CssImportChild } from './css-import-child.js';
import { PropParent } from './prop-parent.js';
import { DestroyParentSimple } from './destroy-parent-simple.js';
import { DestroyParentConditional } from './destroy-parent-conditional.js';
import { DestroyParentNested } from './destroy-parent-nested.js';

// Register global styles (verifies registerGlobalStyles e2e)
registerGlobalStyles(`
  [data-testid="global-styled"] { color: rgb(255, 165, 0); }
`);

type Item = {
  id: number;
  name: string;
  active: boolean;
  children: string[];
};

type NestedItem = {
  id: number;
  label: string;
  visible: boolean;
  children: string[];
};

const initialItems = (): Item[] => [
  { id: 1, name: 'Alpha', active: true, children: ['A1', 'A2'] },
  { id: 2, name: 'Beta', active: false, children: ['B1'] },
  { id: 3, name: 'Gamma', active: true, children: [] },
];

const initialNestedItems = (): NestedItem[] => [
  { id: 101, label: 'Nest-A', visible: true, children: ['x1'] },
  { id: 102, label: 'Nest-B', visible: false, children: [] },
];

const initialFallbackRows = (): Array<{ id: number; label: string }> => [
  { id: 201, label: 'FB-A' },
  { id: 202, label: 'FB-B' },
];

const loadingPiece = html`<div data-testid="var-piece-loading">Loading piece</div>`;
const loadingShell = html`<section data-testid="var-piece-shell">${loadingPiece}</section>`;

export const ContractApp = defineComponent('contract-app', () => {
  const count = signal(0);
  const showWhen = signal(true);
  const whenElseFlag = signal(true);
  const complexWhenElseFlag = signal(true);
  const items = signal<Item[]>(initialItems());
  const nestedItems = signal<NestedItem[]>(initialNestedItems());
  const fallbackRows = signal(initialFallbackRows());
  const parentCount = signal(10);
  const childMounts = signal(0);
  const childToParentEvents = signal(0);
  const nullableText = signal<string | null>('seed');
  const nullishDisplay = signal('seed');
  const rapidValue = signal(0);
  const exprA = signal(1);
  const exprB = signal(2);
  const childMountsA = signal(0);
  const childMountsB = signal(0);
  const childEventsA = signal(0);
  const childEventsB = signal(0);
  const complexThenClicks = signal(0);
  const complexElseClicks = signal(0);
  const complexSharedValue = signal(0);
  const matrixGateA = signal(true);
  const matrixGateB = signal(false);
  const matrixMeta = signal<{ label: string } | null>({ label: 'alpha' });
  const matrixRows = signal([
    { id: 1, name: 'M-1', qty: 1 },
    { id: 2, name: 'M-2', qty: 0 },
  ]);
  const orderFlag = signal(true);
  const depthFlag = signal(true);
  const orderItems = signal([
    { id: 1, name: 'O-1' },
    { id: 2, name: 'O-2' },
  ]);

  const clickCount = () => count(count() + 1);
  const toggleWhen = () => showWhen(!showWhen());
  const toggleWhenElse = () => whenElseFlag(!whenElseFlag());
  const toggleComplexWhenElse = () => complexWhenElseFlag(!complexWhenElseFlag());
  const incComplexThen = () => complexThenClicks(complexThenClicks() + 1);
  const incComplexElse = () => complexElseClicks(complexElseClicks() + 1);
  const bumpComplexShared = () => complexSharedValue(complexSharedValue() + 1);
  const toggleMatrixGateA = () => matrixGateA(!matrixGateA());
  const toggleMatrixGateB = () => matrixGateB(!matrixGateB());
  const clearMatrixLabel = () => matrixMeta(null);
  const setMatrixLabel = () => matrixMeta({ label: 'alpha' });
  const addMatrixRow = () => {
    const next = matrixRows().length + 1;
    matrixRows([...matrixRows(), { id: next, name: `M-${next}`, qty: next % 2 === 0 ? 0 : 2 }]);
  };
  const resetMatrixRows = () =>
    matrixRows([
      { id: 1, name: 'M-1', qty: 1 },
      { id: 2, name: 'M-2', qty: 0 },
    ]);
  const toggleOrderFlag = () => orderFlag(!orderFlag());
  const toggleDepthFlag = () => depthFlag(!depthFlag());
  const addOrderItem = () => {
    const next = orderItems().length + 1;
    orderItems([...orderItems(), { id: next, name: `O-${next}` }]);
  };
  const resetOrderItems = () =>
    orderItems([
      { id: 1, name: 'O-1' },
      { id: 2, name: 'O-2' },
    ]);
  const addItem = () => {
    const next = items().length + 1;
    items([...items(), { id: next, name: `New-${next}`, active: next % 2 === 0, children: [`N${next}`] }]);
  };
  const removeFirst = () => items(items().slice(1));
  const clearItems = () => items([]);
  const resetItems = () => items(initialItems());
  const reorderItems = () => {
    const current = items();
    if (current.length < 2) return;
    items([current[2]!, current[0]!, current[1]!, ...current.slice(3)]);
  };

  const toggleNestedVisibility = () => showWhen(!showWhen());

  const addChildSecond = () => {
    const current = nestedItems();
    const nextId = current.length ? Math.max(...current.map((x) => x.id)) + 1 : 103;
    nestedItems([
      ...current,
      {
        id: nextId,
        label: 'Nest-C',
        visible: true,
        children: ['y1'],
      },
    ]);
  };

  const clearNested = () => nestedItems([]);
  const resetNested = () => nestedItems(initialNestedItems());

  const addFallbackRow = () => {
    const nextId = fallbackRows().length ? Math.max(...fallbackRows().map((r) => r.id)) + 1 : 201;
    fallbackRows([...fallbackRows(), { id: nextId, label: `FB-${nextId}` }]);
  };
  const clearFallbackRows = () => fallbackRows([]);
  const resetFallbackRows = () => fallbackRows(initialFallbackRows());

  const incrementParent = () => parentCount(parentCount() + 1);
  const onChildMount = () => childMounts(childMounts() + 1);
  const onChildIncrement = (_local: number) => childToParentEvents(childToParentEvents() + 1);

  const setNullish = () => {
    nullableText(null);
    nullishDisplay('fallback-null');
  };
  const setValue = () => {
    nullableText('live-value');
    nullishDisplay('live-value');
  };

  const rapidBurst = () => {
    for (let i = 1; i <= 15; i++) {
      rapidValue(i);
    }
  };

  const incExprA = () => exprA(exprA() + 1);
  const incExprB = () => exprB(exprB() + 1);
  const swapExpr = () => {
    const a = exprA();
    const b = exprB();
    exprA(b);
    exprB(a);
  };

  const onChildMountA = () => childMountsA(childMountsA() + 1);
  const onChildMountB = () => childMountsB(childMountsB() + 1);
  const onChildIncrementA = (_local: number) => childEventsA(childEventsA() + 1);
  const onChildIncrementB = (_local: number) => childEventsB(childEventsB() + 1);

  const signalPropA = signal(10);
  const signalPropB = signal(20);
  const incSignalPropA = () => signalPropA(signalPropA() + 1);
  const incSignalPropB = () => signalPropB(signalPropB() + 1);

  // ── computed() test signals ──
  const compFirst = signal('John');
  const compLast = signal('Doe');
  const compFull = computed(() => `${compFirst()} ${compLast()}`);
  const compA = signal(3);
  const compB = signal(4);
  const compSum = computed(() => compA() + compB());

  // Computed signals work directly in templates — the compiler detects any
  // bare function call (e.g. compFull()) and generates reactive bindings.

  const setCompFirst = () => compFirst('Jane');
  const setCompLast = () => compLast('Smith');
  const incCompA = () => compA(compA() + 1);

  // ── batch() test signals ──
  const batchX = signal(1);
  const batchY = signal(10);
  const batchLog = signal('');
  // Track how many times the combined display is updated
  const batchNotifyCount = signal(0);
  // Subscribe to batchX — each notification bumps the counter
  batchX.subscribe(() => batchNotifyCount(batchNotifyCount() + 1), true);

  const batchBoth = () => {
    batch(() => {
      batchX(batchX() + 1);
      batchY(batchY() + 1);
      batchLog('batched');
    });
  };
  const batchNested = () => {
    batch(() => {
      batchX(100);
      batch(() => {
        batchY(200);
      });
      batchLog('nested');
    });
  };

  // ── effect() test signals ──
  const effectSource = signal(0);
  // Display signals initialized with compile-time-correct values
  // (effect runs during setup but template bakes in compile-time initial values)
  const effectLog = signal('effect-0');
  const effectRuns = signal(0);
  let effectRunCount = 0;

  const disposeEffect = effect(() => {
    const val = effectSource();
    effectRunCount++;
    effectRuns(effectRunCount);
    effectLog(`effect-${val}`);
  });

  const incEffectSource = () => effectSource(effectSource() + 1);
  const stopEffect = () => disposeEffect();

  // ── throwing subscriber resilience ──
  const throwingSubscriberSource = signal(0);
  const throwingSubscriberBefore = signal('');
  const throwingSubscriberAfter = signal('');
  // These subscribe WITHOUT skipInitial — but the template bakes in
  // compile-time initial values, so we only test post-interaction state.
  throwingSubscriberSource.subscribe((v) => throwingSubscriberBefore(`before-${v}`), true);
  throwingSubscriberSource.subscribe(() => {
    throw new Error('boom');
  }, true);
  throwingSubscriberSource.subscribe((v) => throwingSubscriberAfter(`after-${v}`), true);

  const triggerThrowingSubscriber = () => throwingSubscriberSource(throwingSubscriberSource() + 1);

  // ── computed notification-depth tracking ──
  // A computed with multiple subscribers where one unsubscribes mid-notification.
  // If _notifyComputedSubs depth tracking is broken, after the first cycle
  // notifyCount drifts negative and compaction / iteration corruption occurs.
  const notificationDepthSource = signal(0);
  const notificationDepthComputed = computed(() => notificationDepthSource() * 100);
  const notificationDepthLog = signal('');
  let unsubscribeMidNotification: (() => void) | null = null;

  // Subscribe three listeners; the second one will self-unsubscribe on first notification
  const notificationDepthFirstSubscriberValues: number[] = [];
  const notificationDepthThirdSubscriberValues: number[] = [];
  notificationDepthComputed.subscribe((value) => {
    notificationDepthFirstSubscriberValues.push(value);
    notificationDepthLog(
      notificationDepthFirstSubscriberValues.concat(notificationDepthThirdSubscriberValues).join(','),
    );
  }, true);
  unsubscribeMidNotification = notificationDepthComputed.subscribe(() => {
    // Self-unsubscribe during notification to trigger mid-notification null-slotting
    if (unsubscribeMidNotification) {
      unsubscribeMidNotification();
      unsubscribeMidNotification = null;
    }
  }, true);
  notificationDepthComputed.subscribe((value) => {
    notificationDepthThirdSubscriberValues.push(value);
    notificationDepthLog(
      notificationDepthFirstSubscriberValues.concat(notificationDepthThirdSubscriberValues).join(','),
    );
  }, true);

  const triggerNotificationDepthCase = () => notificationDepthSource(notificationDepthSource() + 1);

  // ── effect recovery after throw ──
  // An effect that throws on certain values but should still re-subscribe
  // and recover when the signal changes to a non-throwing value.
  const effectRecoverySource = signal(0);
  const effectRecoveryLog = signal('init');
  const effectRecoveryRuns = signal(0);
  let effectRecoveryRunCount = 0;

  effect(() => {
    const value = effectRecoverySource();
    effectRecoveryRunCount++;
    effectRecoveryRuns(effectRecoveryRunCount);
    if (value === 1) {
      throw new Error('effect-recovery-intentional-throw');
    }
    effectRecoveryLog(`ok-${value}`);
  });

  const setEffectRecoveryThrowing = () => effectRecoverySource(1); // will throw
  const setEffectRecoveryRecovered = () => effectRecoverySource(2); // should recover

  // ── reentrant reconciler safety ──
  // Two repeat lists sharing a trigger signal. When list1 changes, an effect
  // synchronously updates list2. If the reconciler uses a shared module-scoped
  // Set, the inner reconcile clears it and the outer loses track of retained keys.
  type ReentrantListItem = { id: number; label: string };
  const primaryReentrantList = signal<ReentrantListItem[]>([
    { id: 1, label: 'L1-A' },
    { id: 2, label: 'L1-B' },
    { id: 3, label: 'L1-C' },
  ]);
  const secondaryReentrantList = signal<ReentrantListItem[]>([
    { id: 10, label: 'L2-X' },
    { id: 20, label: 'L2-Y' },
  ]);

  // When list1 changes, synchronously mutate list2 — this triggers reentrant reconcile
  // because the subscriber notification from list1's reconcile is still in progress.
  primaryReentrantList.subscribe(() => {
    const currentSecondaryList = secondaryReentrantList();
    if (currentSecondaryList.length === 2) {
      secondaryReentrantList([...currentSecondaryList, { id: 30, label: 'L2-Z' }]);
    }
  }, true);

  const removeFromPrimaryReentrantList = () => {
    // Remove the middle item — triggers general keyed reconciliation path
    primaryReentrantList([primaryReentrantList()[0]!, primaryReentrantList()[2]!]);
  };

  // ── computed subscribe error cleanup ──
  // When subscribing to a computed whose derivation throws, the subscriber
  // callback must be cleaned up before the error propagates. Previously the
  // subscriber was left in the array (leaking) while the unsubscribe function
  // was never returned because the throw interrupted control flow.
  const computedSubscriptionErrorSource = signal(0);
  const computedSubscriptionErrorValue = computed(() => {
    if (computedSubscriptionErrorSource() === 0) throw new Error('computed-subscribe-initial-error');
    return computedSubscriptionErrorSource() * 10;
  });
  const computedSubscriptionErrorLog = signal('init');
  let computedSubscriptionLeaked = false;

  try {
    computedSubscriptionErrorValue.subscribe((value) => {
      computedSubscriptionLeaked = true;
      computedSubscriptionErrorLog(`sub-${value}`);
    });
  } catch (e) {
    computedSubscriptionErrorLog(`caught:${(e as Error).message}`);
  }

  const recoverComputedSubscriptionError = () => {
    computedSubscriptionErrorSource(1);
    // If subscriber was properly cleaned up, computedSubscriptionLeaked stays false.
    // If subscriber leaked, it fires with value 10 and flips the flag.
    computedSubscriptionErrorLog(computedSubscriptionLeaked ? 'leaked' : 'cleaned-up');
  };

  return {
    template: html`
      <main>
        <h1 data-testid="app-title">Thane Contract App</h1>

        <section data-testid="basic-section">
          <button data-testid="count-btn" @click=${clickCount}>count++</button>
          <p data-testid="count-value">${count()}</p>
        </section>

        <section data-testid="when-section">
          <button data-testid="toggle-when" @click=${toggleWhen}>toggle when</button>
          <div data-testid="when-block" ${when(showWhen())}>when-visible-${count()}</div>
        </section>

        <section data-testid="when-else-section">
          <button data-testid="toggle-when-else" @click=${toggleWhenElse}>toggle whenElse</button>
          ${whenElse(
            whenElseFlag(),
            html`<p data-testid="when-else-then">THEN</p>`,
            html`<p data-testid="when-else-else">ELSE</p>`,
          )}
        </section>

        <section data-testid="when-else-dom-section">
          <button data-testid="toggle-complex-when-else" @click=${toggleComplexWhenElse}
            >toggle complex whenElse</button
          >
          <button data-testid="bump-complex-shared" @click=${bumpComplexShared}>bump complex shared</button>
          <button data-testid="inc-complex-then" @click=${incComplexThen}>inc complex then</button>
          <button data-testid="inc-complex-else" @click=${incComplexElse}>inc complex else</button>
          <div data-testid="complex-wrapper">
            <span data-testid="complex-prefix">prefix</span>
            ${whenElse(
              complexWhenElseFlag(),
              html`
                <article data-testid="complex-then" class=${complexSharedValue()}>
                  <p data-testid="complex-then-count">${complexThenClicks()}</p>
                  <span data-testid="complex-shared">shared-${complexSharedValue()}</span>
                </article>
              `,
              html`
                <article data-testid="complex-else" data-shared=${complexSharedValue()}>
                  <p data-testid="complex-else-count">${complexElseClicks()}</p>
                  <span data-testid="complex-shared">shared-${complexSharedValue()}</span>
                </article>
              `,
            )}
            <span data-testid="complex-suffix">suffix</span>
          </div>
        </section>

        <section data-testid="directive-matrix-section">
          <button data-testid="toggle-matrix-a" @click=${toggleMatrixGateA}>toggle matrix A</button>
          <button data-testid="toggle-matrix-b" @click=${toggleMatrixGateB}>toggle matrix B</button>
          <button data-testid="clear-matrix-label" @click=${clearMatrixLabel}>clear matrix label</button>
          <button data-testid="set-matrix-label" @click=${setMatrixLabel}>set matrix label</button>
          <button data-testid="add-matrix-row" @click=${addMatrixRow}>add matrix row</button>
          <button data-testid="reset-matrix-rows" @click=${resetMatrixRows}>reset matrix rows</button>

          ${whenElse(
            ((matrixMeta()?.label ?? '').length > 0 && matrixGateA()) || (matrixGateB() && matrixRows().length > 2),
            html`
              <ul data-testid="matrix-then">
                ${repeat(
                  matrixRows(),
                  (row, index) => html`
                    <li data-testid="matrix-row">
                      <span data-testid="matrix-row-label">${row.name}-${index}</span>
                      <i data-testid="matrix-stock">${matrixGateA() ? 'in-' + row.qty : 'out'}</i>
                    </li>
                  `,
                  html`<li data-testid="matrix-empty">matrix-empty</li>`,
                  (row) => row.id,
                )}
              </ul>
            `,
            html`
              <div data-testid="matrix-else">
                <span data-testid="matrix-else-label">matrix-else-active</span>
              </div>
            `,
          )}
        </section>

        <section data-testid="directive-order-section">
          <button data-testid="toggle-order-flag" @click=${toggleOrderFlag}>toggle order flag</button>
          <button data-testid="toggle-depth-flag" @click=${toggleDepthFlag}>toggle depth flag</button>
          <button data-testid="add-order-item" @click=${addOrderItem}>add order item</button>
          <button data-testid="reset-order-items" @click=${resetOrderItems}>reset order items</button>

          <div data-testid="order-a">
            ${whenElse(
              orderFlag(),
              html`
                <ul data-testid="order-a-then">
                  ${repeat(
                    orderItems(),
                    (item, index) => html` <li data-testid="order-a-row">${item.name}-${index}</li> `,
                    html`<li data-testid="order-a-empty">order-a-empty</li>`,
                    (item) => item.id,
                  )}
                </ul>
              `,
              html`<div data-testid="order-a-else">order-a-else</div>`,
            )}
          </div>

          <div data-testid="order-b">
            <ul data-testid="order-b-list">
              ${repeat(
                orderItems(),
                (item, index) => html`
                  <li data-testid="order-b-row">
                    <span data-testid="order-b-label">${item.name}-${index}</span>
                    ${whenElse(
                      orderFlag(),
                      html`<em data-testid="order-b-branch">then</em>`,
                      html`<em data-testid="order-b-branch">else</em>`,
                    )}
                  </li>
                `,
                html`<li data-testid="order-b-empty">order-b-empty</li>`,
                (item) => item.id,
              )}
            </ul>
          </div>

          <div data-testid="order-c-wrap">
            ${whenElse(
              depthFlag() && orderFlag(),
              html`
                <ol data-testid="order-c-then">
                  ${repeat(
                    orderItems(),
                    (item, index) => html` <li data-testid="order-c-row">${item.name}-${index}</li> `,
                    html`<li data-testid="order-c-empty">order-c-empty</li>`,
                    (item) => item.id,
                  )}
                </ol>
              `,
              html`<p data-testid="order-c-else">order-c-else</p>`,
            )}
          </div>
        </section>

        <section data-testid="reactivity-section">
          <button data-testid="parent-inc" @click=${incrementParent}>parent++</button>
          <p data-testid="child-mount-count">${childMounts()}</p>
          <p data-testid="child-to-parent-events">${childToParentEvents()}</p>

          ${ChildCounter({
            label: 'child-' + parentCount(),
            parentCount: parentCount(),
            onChildMount,
            onChildIncrement,
          })}
        </section>

        <section data-testid="edge-section">
          <button data-testid="set-nullish" @click=${setNullish}>set null</button>
          <button data-testid="set-value" @click=${setValue}>set value</button>
          <p data-testid="nullish-value">${nullishDisplay()}</p>

          <button data-testid="rapid-burst" @click=${rapidBurst}>rapid updates</button>
          <p data-testid="rapid-value">${rapidValue()}</p>
        </section>

        <section data-testid="expression-section">
          <button data-testid="inc-expr-a" @click=${incExprA}>exprA++</button>
          <button data-testid="inc-expr-b" @click=${incExprB}>exprB++</button>
          <button data-testid="swap-expr" @click=${swapExpr}>swap</button>

          <p data-testid="expr-order-1">A:${exprA()}|B:${exprB()}</p>
          <p data-testid="expr-order-2">B:${exprB()}|A:${exprA()}</p>
          <p data-testid="expr-mixed">pre-${exprA() + exprB()}-post</p>
          <p data-testid="expr-ternary">${exprA() > exprB() ? 'gt' : 'le'}</p>
          <p data-testid="expr-dup-a">${exprA()}</p>
          <p data-testid="expr-dup-b">${exprA()}</p>
          <div data-testid="attr-expr-target" class="${exprA() > exprB() ? 'gt' : 'le'}">attr-expr</div>
          <div data-testid="style-expr-target" style="color: ${exprA() > exprB() ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 255)'}"
            >style-expr</div
          >
          <p data-testid="ws-adjacent">${exprA()} ${exprB()}</p>
          <p data-testid="ws-none">${exprA()}${exprB()}</p>
          <p data-testid="ws-multi">${exprA()} ${exprB()}</p>
          <p data-testid="ws-surrounding"> hello ${exprA()} and ${exprB()} world </p>
        </section>

        <section data-testid="template-injection-section"> ${loadingShell} </section>

        <section data-testid="repeat-section">
          <button data-testid="add-item" @click=${addItem}>add</button>
          <button data-testid="remove-first" @click=${removeFirst}>remove-first</button>
          <button data-testid="reorder-items" @click=${reorderItems}>reorder</button>
          <button data-testid="clear-items" @click=${clearItems}>clear</button>
          <button data-testid="reset-items" @click=${resetItems}>reset</button>

          <ul data-testid="item-list">
            ${repeat(
              items(),
              (item, index) => html`
                <li data-testid="item-row">
                  <span data-testid="item-id">${item.id}</span>
                  <span data-testid="item-name">${item.name}</span>
                  <span data-testid="item-index">${index}</span>
                  <span data-testid="item-derived">${item.name}-${index}</span>
                </li>
              `,
              null,
              (item) => item.id,
            )}
          </ul>
        </section>

        <section data-testid="nested-section">
          <button data-testid="nested-toggle-visibility" @click=${toggleNestedVisibility}
            >toggle-nested-visibility</button
          >
          <button data-testid="nested-add-child-second" @click=${addChildSecond}>add-child-second</button>
          <button data-testid="nested-clear" @click=${clearNested}>clear-nested</button>
          <button data-testid="nested-reset" @click=${resetNested}>reset-nested</button>

          <ul data-testid="nested-list">
            ${repeat(
              nestedItems(),
              (item, index) => html`
                <li data-testid="nested-row">
                  <span data-testid="nested-label">${item.label}-${index}</span>
                  <span data-testid="nested-parent-a">${exprA()}</span>
                  <div data-testid="nested-when" ${when(showWhen())}>visible</div>
                  ${whenElse(
                    showWhen(),
                    html`<b data-testid="nested-branch">then</b>`,
                    html`<b data-testid="nested-branch">else</b>`,
                  )}
                  <ol data-testid="nested-children">
                    ${repeat(
                      item.children,
                      (child, childIndex) => html`<li data-testid="nested-child">${child}-${childIndex}</li>`,
                      html`<li data-testid="nested-child-empty">empty-${item.id}</li>`,
                    )}
                  </ol>
                </li>
              `,
              html`<li data-testid="nested-empty">nested-empty</li>`,
              (item) => item.id,
            )}
          </ul>
        </section>

        <section data-testid="css-section">
          <div data-testid="css-parent-styled" class="parent-scoped">parent-green</div>
          <div data-testid="css-no-leak" class="leak-target">no-child-leak</div>
          ${StyledChild({})}
        </section>

        <section data-testid="css-import-section"> ${CssImportChild({})} </section>

        <section data-testid="global-styles-section">
          <div data-testid="global-styled">global-orange</div>
        </section>

        <section data-testid="multi-child-section">
          ${ChildCounter({
            label: 'multi-A',
            parentCount: parentCount(),
            onChildMount: onChildMountA,
            onChildIncrement: onChildIncrementA,
          })}
          ${ChildCounter({
            label: 'multi-B',
            parentCount: parentCount(),
            onChildMount: onChildMountB,
            onChildIncrement: onChildIncrementB,
          })}
          <p data-testid="multi-child-mounts-a">${childMountsA()}</p>
          <p data-testid="multi-child-mounts-b">${childMountsB()}</p>
          <p data-testid="multi-child-events-a">${childEventsA()}</p>
          <p data-testid="multi-child-events-b">${childEventsB()}</p>
        </section>

        <section data-testid="repeat-fallback-section">
          <button data-testid="fallback-add" @click=${addFallbackRow}>fallback-add</button>
          <button data-testid="fallback-clear" @click=${clearFallbackRows}>fallback-clear</button>
          <button data-testid="fallback-reset" @click=${resetFallbackRows}>fallback-reset</button>

          <ul data-testid="fallback-list">
            ${repeat(
              fallbackRows(),
              (row, index) => html`
                <li data-testid="fallback-row-label">${row.label}</li>
                <li data-testid="fallback-row-index">${index}</li>
                <li data-testid="fallback-row-expr">${row.label}-${exprA()}</li>
              `,
              html`<li data-testid="fallback-empty">fallback-empty</li>`,
              (row) => row.id,
            )}
          </ul>
        </section>

        <section data-testid="signal-prop-section">
          <button data-testid="inc-prop-a" @click=${incSignalPropA}>propA++</button>
          <button data-testid="inc-prop-b" @click=${incSignalPropB}>propB++</button>
          <p data-testid="prop-a-source">${signalPropA()}</p>
          <p data-testid="prop-b-source">${signalPropB()}</p>

          ${PropParent({ valueA: signalPropA, valueB: signalPropB })}
        </section>

        <section data-testid="computed-section">
          <button data-testid="comp-set-first" @click=${setCompFirst}>setFirst</button>
          <button data-testid="comp-set-last" @click=${setCompLast}>setLast</button>
          <button data-testid="comp-inc-a" @click=${incCompA}>compA++</button>
          <p data-testid="comp-full">${compFull()}</p>
          <p data-testid="comp-first">${compFirst()}</p>
          <p data-testid="comp-last">${compLast()}</p>
          <p data-testid="comp-sum">${compSum()}</p>
          <p data-testid="comp-a">${compA()}</p>
          <p data-testid="comp-b">${compB()}</p>
        </section>

        <section data-testid="batch-section">
          <button data-testid="batch-both" @click=${batchBoth}>batchBoth</button>
          <button data-testid="batch-nested" @click=${batchNested}>batchNested</button>
          <p data-testid="batch-x">${batchX()}</p>
          <p data-testid="batch-y">${batchY()}</p>
          <p data-testid="batch-log">${batchLog()}</p>
          <p data-testid="batch-notify">${batchNotifyCount()}</p>
        </section>

        <section data-testid="effect-section">
          <button data-testid="effect-inc" @click=${incEffectSource}>effectSource++</button>
          <button data-testid="effect-stop" @click=${stopEffect}>stopEffect</button>
          <p data-testid="effect-source">${effectSource()}</p>
          <p data-testid="effect-log">${effectLog()}</p>
          <p data-testid="effect-runs">${effectRuns()}</p>
        </section>

        <section data-testid="throwing-subscriber-section">
          <button data-testid="throwing-subscriber-trigger" @click=${triggerThrowingSubscriber}
            >trigger throwing subscriber</button
          >
          <p data-testid="throwing-subscriber-source">${throwingSubscriberSource()}</p>
          <p data-testid="throwing-subscriber-before">${throwingSubscriberBefore()}</p>
          <p data-testid="throwing-subscriber-after">${throwingSubscriberAfter()}</p>
        </section>

        <section data-testid="destroy-section">
          <div data-testid="destroy-simple-target"></div>
          <div data-testid="destroy-conditional-target"></div>
          <div data-testid="destroy-nested-target"></div>
        </section>

        <section data-testid="computed-notification-depth-section">
          <button data-testid="computed-notification-depth-trigger" @click=${triggerNotificationDepthCase}
            >trigger notification depth case</button
          >
          <p data-testid="computed-notification-depth-log">${notificationDepthLog()}</p>
        </section>

        <section data-testid="effect-recovery-section">
          <button data-testid="effect-recovery-set-throwing" @click=${setEffectRecoveryThrowing}
            >set throwing state</button
          >
          <button data-testid="effect-recovery-set-recovered" @click=${setEffectRecoveryRecovered}
            >set recovered state</button
          >
          <p data-testid="effect-recovery-log">${effectRecoveryLog()}</p>
          <p data-testid="effect-recovery-runs">${effectRecoveryRuns()}</p>
        </section>

        <section data-testid="reentrant-reconcile-section">
          <button data-testid="reentrant-reconcile-remove-primary" @click=${removeFromPrimaryReentrantList}
            >remove primary item</button
          >
          <ul data-testid="reentrant-reconcile-primary-list">
            ${repeat(
              primaryReentrantList(),
              (item) => html`<li data-testid="reentrant-reconcile-primary-item">${item.label}</li>`,
              null,
              (item) => item.id,
            )}
          </ul>
          <ul data-testid="reentrant-reconcile-secondary-list">
            ${repeat(
              secondaryReentrantList(),
              (item) => html`<li data-testid="reentrant-reconcile-secondary-item">${item.label}</li>`,
              null,
              (item) => item.id,
            )}
          </ul>
        </section>

        <section data-testid="computed-subscribe-cleanup-section">
          <button data-testid="computed-subscribe-cleanup-recover" @click=${recoverComputedSubscriptionError}
            >recover computed subscription</button
          >
          <p data-testid="computed-subscribe-cleanup-log">${computedSubscriptionErrorLog()}</p>
        </section>
      </main>
    `,
    styles: css`
      .parent-scoped {
        color: rgb(0, 128, 0);
      }
    `,
    onMount: () => {
      // Expose destroy-test mount functions on window for Playwright
      const win = window as any;
      win.__destroyLog = [];
      win.__activeTrackers = new Set();
      win.__intervalTicks = {};

      win.__mountSimple = () => {
        const t = document.createElement('div');
        document.querySelector('[data-testid="destroy-simple-target"]')!.appendChild(t);
        return mountComponent(DestroyParentSimple, t);
      };
      win.__mountConditional = () => {
        const t = document.createElement('div');
        document.querySelector('[data-testid="destroy-conditional-target"]')!.appendChild(t);
        return mountComponent(DestroyParentConditional, t);
      };
      win.__mountNested = () => {
        const t = document.createElement('div');
        document.querySelector('[data-testid="destroy-nested-target"]')!.appendChild(t);
        return mountComponent(DestroyParentNested, t);
      };
    },
  };
});
