import { defineComponent, signal, registerGlobalStyles } from 'thane';
import { batch, computed, effect } from 'thane';
import { mount } from 'thane';
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

  const clickCount = () => count(count() + 1);
  const toggleWhen = () => showWhen(!showWhen());
  const toggleWhenElse = () => whenElseFlag(!whenElseFlag());
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

  // ── subscriber exception handling test ──
  const excSource = signal(0);
  const excBefore = signal('');
  const excAfter = signal('');
  // These subscribe WITHOUT skipInitial — but the template bakes in
  // compile-time initial values, so we only test post-interaction state.
  excSource.subscribe((v) => excBefore(`before-${v}`), true);
  excSource.subscribe(() => {
    throw new Error('boom');
  }, true);
  excSource.subscribe((v) => excAfter(`after-${v}`), true);

  const triggerExc = () => excSource(excSource() + 1);

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
          ${whenElse(whenElseFlag(), html`<p data-testid="when-else-then">THEN</p>`, html`<p data-testid="when-else-else">ELSE</p>`)}
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
          <div data-testid="style-expr-target" style="color: ${exprA() > exprB() ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 255)'}">style-expr</div>
          <p data-testid="ws-adjacent">${exprA()} ${exprB()}</p>
          <p data-testid="ws-none">${exprA()}${exprB()}</p>
          <p data-testid="ws-multi">${exprA()}  ${exprB()}</p>
          <p data-testid="ws-surrounding"> hello ${exprA()} and ${exprB()} world </p>
        </section>

        <section data-testid="template-injection-section">
          ${loadingShell}
        </section>

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
          <button data-testid="nested-toggle-visibility" @click=${toggleNestedVisibility}>toggle-nested-visibility</button>
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
                  ${whenElse(showWhen(), html`<b data-testid="nested-branch">then</b>`, html`<b data-testid="nested-branch">else</b>`)}
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

        <section data-testid="css-import-section">
          ${CssImportChild({})}
        </section>

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

        <section data-testid="exc-section">
          <button data-testid="exc-trigger" @click=${triggerExc}>triggerExc</button>
          <p data-testid="exc-source">${excSource()}</p>
          <p data-testid="exc-before">${excBefore()}</p>
          <p data-testid="exc-after">${excAfter()}</p>
        </section>

        <section data-testid="destroy-section">
          <div data-testid="destroy-simple-target"></div>
          <div data-testid="destroy-conditional-target"></div>
          <div data-testid="destroy-nested-target"></div>
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
        return mount(DestroyParentSimple, t);
      };
      win.__mountConditional = () => {
        const t = document.createElement('div');
        document.querySelector('[data-testid="destroy-conditional-target"]')!.appendChild(t);
        return mount(DestroyParentConditional, t);
      };
      win.__mountNested = () => {
        const t = document.createElement('div');
        document.querySelector('[data-testid="destroy-nested-target"]')!.appendChild(t);
        return mount(DestroyParentNested, t);
      };
    },
  };
});
