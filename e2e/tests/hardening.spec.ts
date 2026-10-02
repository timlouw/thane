import { expect, test, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════════
// Hardening probes: one test per defect found by probing the compiler and runtime, run against
// e2e/hardening-app.
//
// Each defect is fixed, and its test asserts the correct behaviour. Every page mounts one probe
// (`/?probe=<id>`), so a test sees only its own component, styles and errors. A few probes check
// shapes that never failed and are kept as regression tests.
// ═══════════════════════════════════════════════════════════════════════

type Probe = {
  /** Uncaught page errors since the page was opened. */
  pageErrors: string[];
  /** Errors thrown by mounting the probe (main.ts records them instead of letting them escape). */
  mountErrors: () => Promise<string[]>;
};

const openProbe = async (
  page: Page,
  id: string,
  options: { manual?: boolean; target?: 'body' } = {},
): Promise<Probe> => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(
    `/?probe=${id}${options.manual ? '&manual=1' : ''}${options.target ? `&target=${options.target}` : ''}`,
  );
  await page.waitForFunction(() => (window as any).__ready === true);
  return { pageErrors, mountErrors: () => page.evaluate(() => (window as any).__mountErrors as string[]) };
};

/** Opens a probe and checks that it mounted without an error. */
const mountProbe = async (page: Page, id: string): Promise<Probe> => {
  const probe = await openProbe(page, id);
  expect(await probe.mountErrors()).toEqual([]);
  return probe;
};

/** Live subscribers of a store signal from e2e/hardening-app/shared/store.ts (non-null subscriber slots). */
const liveSubscribers = (page: Page, name: 'destroyRowsTick' | 'hiddenRowsTick'): Promise<number> =>
  page.evaluate((signalName) => {
    const slots = (window as any).__probe.store[signalName]._s;
    if (!Array.isArray(slots)) throw new Error('signal internals changed: update liveSubscribers in hardening.spec.ts');
    return slots.filter((callback: unknown) => callback != null).length;
  }, name);

const kidDestroyCounts = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => ({ ...((window as any).__counts?.kidDestroy ?? {}) }));

test.describe('hardening probes', () => {
  test('a method call on the row item renders in row text', async ({ page }) => {
    const probe = await mountProbe(page, 'rowMethodCall');
    await expect(page.locator('.method-row')).toHaveText(['ALPHA', 'BETA']);

    await page.evaluate(() => (window as any).__probe.rowMethodCall.items([{ id: 3, name: 'gamma' }]));
    await expect(page.locator('.method-row')).toHaveText(['GAMMA']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('click handlers in nested repeat() rows fire', async ({ page }) => {
    const probe = await mountProbe(page, 'nestedRowEvent');
    await expect(page.locator('.nested-event-picked')).toHaveText('none');

    await page.locator('.nested-event-inner', { hasText: 'b' }).click();
    await expect(page.locator('.nested-event-picked')).toHaveText('b');
    await page.locator('.nested-event-inner', { hasText: 'a' }).click();
    await expect(page.locator('.nested-event-picked')).toHaveText('a');
    expect(probe.pageErrors).toEqual([]);
  });

  test('a when() in a nested repeat() row renders the inner item', async ({ page }) => {
    const probe = await mountProbe(page, 'nestedRowWhen');
    await expect(page.locator('.nested-when-w')).toHaveText(['a-shown']);

    await page.evaluate(() => (window as any).__probe.nestedRowWhen.show(false));
    await expect(page.locator('.nested-when-w')).toHaveCount(0);
    await page.evaluate(() => (window as any).__probe.nestedRowWhen.show(true));
    await expect(page.locator('.nested-when-w')).toHaveText(['a-shown']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('click handlers in a when() branch inside a row fire', async ({ page }) => {
    const probe = await mountProbe(page, 'rowWhenElseEvent');
    await expect(page.locator('.branch-event-clicks')).toHaveText('0');

    await page.locator('.branch-event-then').click();
    await expect(page.locator('.branch-event-clicks')).toHaveText('1');
    await page.locator('.branch-event-then').click();
    await expect(page.locator('.branch-event-clicks')).toHaveText('2');
    expect(probe.pageErrors).toEqual([]);
  });

  test('a child component in a when() nested in a when() is mounted', async ({ page }) => {
    const probe = await mountProbe(page, 'nestedWhenElseChild');
    await expect(page.locator('.nested-branch-then .card')).toHaveText(['branch-card']);

    await page.evaluate(() => (window as any).__probe.nestedWhenElseChild.flag(false));
    await expect(page.locator('.nested-branch-else')).toHaveText('no');
    await expect(page.locator('.card')).toHaveCount(0);
    await page.evaluate(() => (window as any).__probe.nestedWhenElseChild.flag(true));
    await expect(page.locator('.nested-branch-then .card')).toHaveText(['branch-card']);

    await page.evaluate(() => (window as any).__probe.nestedWhenElseChild.show(false));
    await expect(page.locator('.nested-branch-when')).toHaveCount(0);
    await page.evaluate(() => (window as any).__probe.nestedWhenElseChild.show(true));
    await expect(page.locator('.nested-branch-then .card')).toHaveText(['branch-card']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('child-component rows inside a when() mount when it shows', async ({ page }) => {
    const probe = await mountProbe(page, 'componentRowsInWhen');
    await expect(page.locator('.card')).toHaveCount(0);

    await page.evaluate(() => (window as any).__probe.componentRowsInWhen.show(true));
    await expect(page.locator('.component-rows-when .card')).toHaveText(['x', 'y']);
    await page.evaluate(() => (window as any).__probe.componentRowsInWhen.show(false));
    await expect(page.locator('.card')).toHaveCount(0);
    await page.evaluate(() => (window as any).__probe.componentRowsInWhen.show(true));
    await expect(page.locator('.component-rows-when .card')).toHaveText(['x', 'y']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a child component in a when() inside a row is mounted', async ({ page }) => {
    const probe = await mountProbe(page, 'rowWhenChild');
    await expect(page.locator('.when-child-row .card')).toHaveText(['row-card']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('onMount runs when the setup declares a helper that returns an object', async ({ page }) => {
    const probe = await mountProbe(page, 'helperReturn');
    await expect(page.locator('.helper-return')).toHaveText('helper');
    await expect(page.locator('#app')).toHaveAttribute('data-mounted', 'yes');
    expect(probe.pageErrors).toEqual([]);
  });

  test('whitespace inside <pre> is kept', async ({ page }) => {
    const probe = await mountProbe(page, 'preWhitespace');
    expect(await page.locator('.whitespace-pre').textContent()).toBe('line1\n    line2');
    expect(probe.pageErrors).toEqual([]);
  });

  test('a backslash and an escaped interpolation in template text render literally', async ({ page }) => {
    const probe = await mountProbe(page, 'backslashEscape');
    expect(await page.locator('.escape-bs').textContent()).toBe('C:\\dir');
    expect(await page.locator('.escape-dollar').textContent()).toBe('${notExpr}');
    expect(probe.pageErrors).toEqual([]);
  });

  test('hyphenated tags keep their name as a when() root and with when()', async ({ page }) => {
    const probe = await mountProbe(page, 'hyphenatedTag');
    await expect(page.locator('.hyphenated-we-else')).toHaveText('B');
    await expect(page.locator('section.hyphenated my-tag')).toHaveCount(0);

    await page.evaluate(() => {
      (window as any).__probe.hyphenatedTag.flag(true);
      (window as any).__probe.hyphenatedTag.show(true);
    });
    await expect(page.locator('section.hyphenated my-tag.hyphenated-we')).toHaveText('A');
    await expect(page.locator('section.hyphenated my-tag.hyphenated-w')).toHaveText('W');
    await expect(page.locator('.hyphenated-we-else')).toHaveCount(0);
    await expect(page.locator('section.hyphenated my')).toHaveCount(0);
    expect(
      await page.locator('section.hyphenated my-tag').evaluateAll((els) => els.flatMap((el) => el.getAttributeNames())),
    ).not.toContain('-tag');

    await page.evaluate(() => {
      (window as any).__probe.hyphenatedTag.flag(false);
      (window as any).__probe.hyphenatedTag.show(false);
    });
    await expect(page.locator('section.hyphenated my-tag')).toHaveCount(0);
    await expect(page.locator('.hyphenated-we-else')).toHaveText('B');
    expect(probe.pageErrors).toEqual([]);
  });

  test('a nested list in the row root does not reorder the outer rows', async ({ page }) => {
    const probe = await mountProbe(page, 'nestedListRowRoot');
    const rowIds = () =>
      page.locator('.row-root-list-row').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
    expect(await rowIds()).toEqual(['A', 'B']);

    await page.evaluate(() => (window as any).__probe.nestedListRowRoot.inner(['A1']));
    await expect(page.locator('.row-root-list-row[data-id="A"] .row-root-list-inner')).toHaveText(['A1']);
    expect(await rowIds()).toEqual(['A', 'B']);

    await page.evaluate(() => (window as any).__probe.nestedListRowRoot.inner(['A1', 'B1', 'B2']));
    await expect(page.locator('.row-root-list-row[data-id="B"] .row-root-list-inner')).toHaveText(['B1', 'B2']);
    expect(await rowIds()).toEqual(['A', 'B']);

    await page.evaluate(() => (window as any).__probe.nestedListRowRoot.inner([]));
    await expect(page.locator('.row-root-list-inner')).toHaveCount(0);
    expect(await rowIds()).toEqual(['A', 'B']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('static siblings survive clearing a list', async ({ page }) => {
    const probe = await mountProbe(page, 'staticSibling');
    await expect(page.locator('ul.static-sibling > li')).toHaveText(['H', 'a', 'b']);

    await page.evaluate(() => (window as any).__probe.staticSibling.items([]));
    await expect(page.locator('ul.static-sibling > li')).toHaveText(['H']);
    await page.evaluate(() => (window as any).__probe.staticSibling.items(['c']));
    await expect(page.locator('ul.static-sibling > li')).toHaveText(['H', 'c']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a repeat() inside a when() inside a row renders', async ({ page }) => {
    const probe = await mountProbe(page, 'rowWhenRepeat');
    await expect(page.locator('.when-list-tag')).toHaveText(['t1', 't2']);

    await page.evaluate(() => (window as any).__probe.rowWhenRepeat.show(false));
    await expect(page.locator('.when-list-wrap')).toHaveCount(0);
    await page.evaluate(() => (window as any).__probe.rowWhenRepeat.show(true));
    await expect(page.locator('.when-list-tag')).toHaveText(['t1', 't2']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('host() with a compound argument applies only while the host matches it', async ({ page }) => {
    const probe = await mountProbe(page, 'hostCompound');
    const text = page.locator('.host-compound-a');
    const setHostClasses = (classes: string[]) =>
      page.evaluate((list) => {
        const host = document.getElementById('app')!;
        host.classList.remove('x', 'y');
        host.classList.add(...list);
      }, classes);
    const green = 'rgb(0, 128, 0)';

    await expect(text).not.toHaveCSS('color', green);
    await setHostClasses(['y']);
    await expect(text).toHaveCSS('color', green);
    await setHostClasses(['x', 'y']);
    await expect(text).not.toHaveCSS('color', green);
    await setHostClasses(['x']);
    await expect(text).not.toHaveCSS('color', green);
    expect(probe.pageErrors).toEqual([]);
  });

  test('host-context() applies inside a matching ancestor', async ({ page }) => {
    const probe = await mountProbe(page, 'hostContext');
    const text = page.locator('.host-context-a');
    const red = 'rgb(255, 0, 0)';

    await expect(text).not.toHaveCSS('color', red);
    await page.evaluate(() => document.body.classList.add('host-context-dark'));
    await expect(text).toHaveCSS('color', red);
    await page.evaluate(() => document.body.classList.remove('host-context-dark'));
    await expect(text).not.toHaveCSS('color', red);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a quote in a CSS comment leaves the following rules scoped (dev build)', async ({ page }) => {
    const probe = await mountProbe(page, 'cssCommentQuote');
    await expect(page.locator('#app .comment-quote-a')).toHaveCSS('color', 'rgb(0, 0, 255)');
    await expect(page.locator('#app .comment-quote-leak')).toHaveCSS('color', 'rgb(1, 2, 3)');
    await expect(page.getByTestId('comment-quote-outside')).not.toHaveCSS('color', 'rgb(1, 2, 3)');
    expect(probe.pageErrors).toEqual([]);
  });

  test("destroying a component releases its rows' subscriptions and destroys row children", async ({ page }) => {
    const probe = await openProbe(page, 'destroyRows', { manual: true });
    const before = await liveSubscribers(page, 'destroyRowsTick');
    expect(await page.evaluate(() => (window as any).__mountProbe())).toBe(true);
    expect(await probe.mountErrors()).toEqual([]);
    await expect(page.locator('.destroy-row .kid')).toHaveText(['a', 'b']);
    expect(await liveSubscribers(page, 'destroyRowsTick')).toBeGreaterThan(before);

    await page.evaluate(() => (window as any).__probe.store.destroyRowsTick(1));
    await expect(page.locator('.destroy-m')).toHaveText(['a-1', 'b-1']);

    await page.evaluate(() => (window as any).__handle.destroy());
    await expect(page.locator('.destroy-row')).toHaveCount(0);
    expect(await liveSubscribers(page, 'destroyRowsTick')).toBe(before);
    expect(await kidDestroyCounts(page)).toEqual({ a: 1, b: 1 });
    expect(probe.pageErrors).toEqual([]);
  });

  test("hiding a when() releases its rows' subscriptions and showing it again adds no second set", async ({ page }) => {
    const probe = await openProbe(page, 'hiddenRows', { manual: true });
    const before = await liveSubscribers(page, 'hiddenRowsTick');
    expect(await page.evaluate(() => (window as any).__mountProbe())).toBe(true);
    expect(await probe.mountErrors()).toEqual([]);
    await expect(page.locator('.hidden-m')).toHaveText(['a-0', 'b-0']);
    await expect(page.locator('.hidden-row .kid')).toHaveText(['a', 'b']);
    const mounted = await liveSubscribers(page, 'hiddenRowsTick');
    expect(mounted).toBeGreaterThan(before);

    for (let round = 1; round <= 3; round++) {
      await page.evaluate(() => (window as any).__probe.hiddenRows.show(false));
      await expect(page.locator('.hidden-row')).toHaveCount(0);
      expect(await liveSubscribers(page, 'hiddenRowsTick')).toBe(before);
      // each hide destroys each row's child once (the rows mount them, and clean them up)
      expect(await kidDestroyCounts(page)).toEqual({ a: round, b: round });

      await page.evaluate(() => (window as any).__probe.hiddenRows.show(true));
      expect(await liveSubscribers(page, 'hiddenRowsTick')).toBe(mounted);
      await expect(page.locator('.hidden-row .kid')).toHaveText(['a', 'b']);
      await page.evaluate((tick) => (window as any).__probe.store.hiddenRowsTick(tick), round);
      await expect(page.locator('.hidden-m')).toHaveText([`a-${round}`, `b-${round}`]);
    }
    expect(probe.pageErrors).toEqual([]);
  });

  test('a child component in a row may use a named index in its props', async ({ page }) => {
    const probe = await mountProbe(page, 'indexChildProps');
    await expect(page.locator('.index-props-row .kid')).toHaveText(['x0', 'y1']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('multi-root and text-only when() branches show and hide completely', async ({ page }) => {
    const probe = await mountProbe(page, 'multiRootBranch');
    const two = page.locator('section.multi-root-two');
    const text = page.locator('section.multi-root-text');
    const set = (key: 'two' | 'text' | 'n', value: boolean | number) =>
      page.evaluate((arg) => (window as any).__probe.multiRootBranch[arg.key](arg.value), { key, value });

    await expect(two.locator('.multi-root-a')).toHaveText('A');
    await expect(two.locator('.multi-root-b')).toHaveText('1');
    await expect(two.locator('.multi-root-e')).toHaveCount(0);
    await expect(text).toHaveText('text-1');
    await expect(text.locator('.multi-root-text-else')).toHaveCount(0);

    for (let n = 2; n <= 4; n++) {
      await set('two', false);
      await set('text', false);
      await expect(two.locator('.multi-root-a')).toHaveCount(0);
      await expect(two.locator('.multi-root-b')).toHaveCount(0);
      await expect(two).toHaveText('E');
      await expect(text).toHaveText('else');

      await set('two', true);
      await set('text', true);
      await set('n', n);
      await expect(two.locator('.multi-root-a')).toHaveCount(1);
      await expect(two.locator('.multi-root-b')).toHaveText(String(n));
      await expect(two.locator('.multi-root-e')).toHaveCount(0);
      await expect(two).toHaveText(`A${n}`);
      await expect(text).toHaveText(`text-${n}`);
      await expect(text.locator('.multi-root-text-else')).toHaveCount(0);
    }
    expect(probe.pageErrors).toEqual([]);
  });

  test("attribute bindings in a row's when() land on that row's elements", async ({ page }) => {
    // A shape that never failed, kept as a regression test. Four shapes: the
    // attribute on the when() element (A), on an element inside its content (B), bound to a component
    // signal (C), and inside a when() branch (D). Row 2 starts hidden.
    const probe = await mountProbe(page, 'rowWhenAttribute');
    const toggle = (id: number) => page.evaluate((rowId) => (window as any).__probe.rowWhenAttribute.toggle(rowId), id);
    const titles = (shape: 'a' | 'b' | 'd') =>
      page
        .locator(`.when-attr-${shape}-row`)
        .evaluateAll(
          (rows, cls) => rows.map((row) => row.querySelector(`.${cls}`)?.getAttribute('title') ?? null),
          `when-attr-${shape}`,
        );
    const tags = () =>
      page
        .locator('.when-attr-c-row')
        .evaluateAll((rows) => rows.map((row) => row.querySelector('.when-attr-c')?.getAttribute('data-tag') ?? null));

    for (const shape of ['a', 'b', 'd'] as const) expect(await titles(shape)).toEqual(['one', null, 'three']);
    expect(await tags()).toEqual(['t0', null, 't0']);

    await toggle(2);
    for (const shape of ['a', 'b', 'd'] as const) expect(await titles(shape)).toEqual(['one', 'two', 'three']);
    await page.evaluate(() => (window as any).__probe.rowWhenAttribute.tag('t1'));
    expect(await tags()).toEqual(['t1', 't1', 't1']);

    await toggle(2);
    await toggle(2);
    await page.evaluate(() => {
      const handles = (window as any).__probe.rowWhenAttribute;
      handles.rows(handles.rows().map((r: { label: string }) => ({ ...r, label: r.label.toUpperCase() })));
      handles.tag('t2');
    });
    for (const shape of ['a', 'b', 'd'] as const) expect(await titles(shape)).toEqual(['ONE', 'TWO', 'THREE']);
    expect(await tags()).toEqual(['t2', 't2', 't2']);

    await toggle(1);
    for (const shape of ['a', 'b', 'd'] as const) expect(await titles(shape)).toEqual([null, 'TWO', 'THREE']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('child components in the rows of a repeat() inside a when() mount', async ({ page }) => {
    const probe = await mountProbe(page, 'rowChildInWhen');
    await expect(page.locator('.when-rows-row .kid')).toHaveText(['a', 'b']);

    await page.evaluate(() => (window as any).__probe.rowChildInWhen.show(false));
    await expect(page.locator('.when-rows-row')).toHaveCount(0);
    await page.evaluate(() => (window as any).__probe.rowChildInWhen.show(true));
    await expect(page.locator('.when-rows-row .kid')).toHaveText(['a', 'b']);
    expect(probe.pageErrors).toEqual([]);
  });

  test("bindings in a row's when() on a component signal apply while it is first shown", async ({ page }) => {
    const probe = await mountProbe(page, 'rowWhenSignal');
    const titles = () => page.locator('.when-signal-b').evaluateAll((els) => els.map((el) => el.getAttribute('title')));
    expect(await titles()).toEqual(['one', 'two', 'three']);

    await page.evaluate(() => {
      const handles = (window as any).__probe.rowWhenSignal;
      handles.rows(handles.rows().map((r: { label: string }) => ({ ...r, label: r.label.toUpperCase() })));
    });
    expect(await titles()).toEqual(['ONE', 'TWO', 'THREE']);

    await page.evaluate(() => (window as any).__probe.rowWhenSignal.show(false));
    await expect(page.locator('.when-signal-b')).toHaveCount(0);
    await page.evaluate(() => (window as any).__probe.rowWhenSignal.show(true));
    expect(await titles()).toEqual(['ONE', 'TWO', 'THREE']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a row that is a component call may hold a template literal in its props', async ({ page }) => {
    const probe = await mountProbe(page, 'componentRowTemplate');
    await expect(page.locator('.component-row .card')).toHaveText(['x-a', 'x-b']);

    await page.evaluate(() =>
      (window as any).__probe.componentRowTemplate.rows([
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
        { id: 3, label: 'c' },
      ]),
    );
    await expect(page.locator('.component-row .card')).toHaveText(['x-a', 'x-b', 'x-c']);
    expect(probe.pageErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Element lookups and directive branches: developer ids, text positions, browser-normalised markup,
// branches at every position and depth, and two instances of one component. They pinned the
// behaviour that path-based lookup and comment-anchored branches had to keep.
// ═══════════════════════════════════════════════════════════════════════

/** A probe's exposed signal setter: `window.__probe[id][key](value)`. */
const setProbe = (page: Page, id: string, key: string, value: unknown) =>
  page.evaluate((arg) => (window as any).__probe[arg.id][arg.key](arg.value), { id, key, value });

const countingKidCounts = (page: Page): Promise<{ mount: Record<string, number>; destroy: Record<string, number> }> =>
  page.evaluate(() => ({
    mount: { ...((window as any).__counts?.countingKidMount ?? {}) },
    destroy: { ...((window as any).__counts?.countingKidDestroy ?? {}) },
  }));

test.describe('lookups and branches', () => {
  test('developer ids: two instances of one component and a second component each bind their own elements', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'duplicateIds');
    const one = page.locator('.ids-one');
    const two = page.locator('.ids-two');
    const three = page.locator('.ids-three');

    for (const [scope, t] of [
      [one, 'a1'],
      [two, 'a2'],
    ] as const) {
      await expect(scope.locator('p#dev-attr')).toHaveAttribute('title', t);
      await expect(scope.locator('div#dev-when > b')).toHaveAttribute('title', t);
      await expect(scope.locator('i#dev-then')).toHaveAttribute('title', t);
      await expect(scope.locator('i#dev-else')).toHaveCount(0);
      await expect(scope.locator('ul#dev-list > li')).toHaveText(['x', 'y']);
      await expect(scope.locator('span#dev-inner')).toHaveCount(0);
      await expect(scope.locator('button#dev-btn')).toHaveText('0');
    }
    await expect(three.locator('p#dev-attr')).toHaveAttribute('title', 'b');
    await expect(three.locator('span#dev-inner')).toHaveAttribute('title', 'b');

    // Each instance's signals reach only its own elements
    await setProbe(page, 'idsA2', 't', 'a2b');
    await expect(two.locator('p#dev-attr')).toHaveAttribute('title', 'a2b');
    await expect(two.locator('div#dev-when > b')).toHaveAttribute('title', 'a2b');
    await expect(two.locator('i#dev-then')).toHaveAttribute('title', 'a2b');
    await expect(one.locator('p#dev-attr')).toHaveAttribute('title', 'a1');
    await expect(three.locator('p#dev-attr')).toHaveAttribute('title', 'b');

    await two.locator('button#dev-btn').click();
    await two.locator('button#dev-btn').click();
    await expect(two.locator('button#dev-btn')).toHaveText('2');
    await expect(one.locator('button#dev-btn')).toHaveText('0');

    await setProbe(page, 'idsA1', 'items', ['z']);
    await expect(one.locator('ul#dev-list > li')).toHaveText(['z']);
    await expect(two.locator('ul#dev-list > li')).toHaveText(['x', 'y']);

    // Directive roots keep their ids through hide and show
    for (let round = 1; round <= 3; round++) {
      await setProbe(page, 'idsA1', 'show', false);
      await expect(one.locator('div#dev-when')).toHaveCount(0);
      await expect(one.locator('i#dev-then')).toHaveCount(0);
      await expect(one.locator('i#dev-else')).toHaveAttribute('title', round === 1 ? 'a1' : `a1-${round - 1}`);
      await setProbe(page, 'idsA1', 't', `a1-${round}`);
      await expect(one.locator('i#dev-else')).toHaveAttribute('title', `a1-${round}`);
      await setProbe(page, 'idsA1', 'show', true);
      await expect(one.locator('div#dev-when > b')).toHaveAttribute('title', `a1-${round}`);
      await expect(one.locator('i#dev-then')).toHaveAttribute('title', `a1-${round}`);
      await expect(one.locator('i#dev-else')).toHaveCount(0);
    }
    await expect(two.locator('i#dev-then')).toHaveAttribute('title', 'a2b');

    // An element with a developer id inside a branch that starts hidden
    await setProbe(page, 'idsA2', 'hidden', true);
    await expect(two.locator('span#dev-inner')).toHaveAttribute('title', 'a2b');
    await setProbe(page, 'idsA2', 't', 'a2c');
    await expect(two.locator('span#dev-inner')).toHaveAttribute('title', 'a2c');
    await expect(three.locator('span#dev-inner')).toHaveAttribute('title', 'b');
    await expect(one.locator('span#dev-inner')).toHaveCount(0);
    expect(probe.pageErrors).toEqual([]);
  });

  test("a when() that shows later binds its own element, not a child component's element with the same id", async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'childSameId');
    await setProbe(page, 'childSameId', 'show', true);
    await expect(page.locator('.ids-own-p')).toHaveAttribute('title', 'own');
    await expect(page.locator('.ids-child-p')).toHaveAttribute('title', 'child');
    await setProbe(page, 'childSameId', 't', 'own2');
    await expect(page.locator('.ids-own-p')).toHaveAttribute('title', 'own2');
    await expect(page.locator('.ids-child-p')).toHaveAttribute('title', 'child');
    expect(probe.pageErrors).toEqual([]);
  });

  test('text bindings at the start, middle and end of text, next to comments, in <pre> and at the top level', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'textPositions');
    const check = async (a: string, b: string) => {
      await expect(page.locator('.text-start')).toHaveText(`${a} tail`);
      await expect(page.locator('.text-mid')).toHaveText(`head ${a} tail`);
      await expect(page.locator('.text-end')).toHaveText(`head ${a}`);
      await expect(page.locator('.text-two')).toHaveText(`${a}${b}`);
      await expect(page.locator('.text-expr')).toHaveText(`${a}-${b}!`);
      await expect(page.locator('.text-cmt')).toHaveText(`${a} x ${b}`);
      expect(await page.locator('.text-pre').textContent()).toBe(`line1\n  ${a} line2\n${b}`);
      await expect(page.locator('.text-sole')).toHaveText(b);
      const text = (await page.locator('#app').textContent())!.replace(/\s+/g, ' ').trim();
      const squash = (value: string) => value.replace(/\s+/g, ' ');
      expect(text.startsWith(squash(`top ${a} level `))).toBe(true);
      expect(text.endsWith(squash(` ${b} end`))).toBe(true);
    };
    await check('A', 'B');
    await setProbe(page, 'textPositions', 'a', 'A2');
    await setProbe(page, 'textPositions', 'b', 'B2');
    await check('A2', 'B2');
    await setProbe(page, 'textPositions', 'a', '');
    await check('', 'B2');
    await setProbe(page, 'textPositions', 'a', 'A3');
    await check('A3', 'B2');
    expect(probe.pageErrors).toEqual([]);
  });

  test('markup the parser rebuilds: a table without <tbody>, a <p> before a block, unclosed <li>, a <select> list', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'rebuiltMarkup');
    const check = async (t: string, x: string) => {
      await expect(page.locator('table.rebuilt-table > tbody > tr.rebuilt-tr')).toHaveAttribute('title', t);
      await expect(page.locator('tr.rebuilt-tr > td.rebuilt-td')).toHaveText(x);
      await expect(page.locator('tr.rebuilt-tr > td.rebuilt-td2')).toHaveAttribute('title', t);
      await expect(page.locator('.rebuilt-pwrap > p')).toHaveCount(2);
      await expect(page.locator('.rebuilt-pwrap > p.rebuilt-p')).toHaveText('intro');
      await expect(page.locator('.rebuilt-pwrap > div.rebuilt-div')).toHaveAttribute('title', t);
      await expect(page.locator('.rebuilt-pwrap > div.rebuilt-div')).toHaveText(x);
      await expect(page.locator('.rebuilt-pwrap > span.rebuilt-after')).toHaveAttribute('title', t);
      await expect(page.locator('.rebuilt-pwrap > span.rebuilt-after')).toHaveText(x);
      await expect(page.locator('ul.rebuilt-list > li')).toHaveCount(2);
      await expect(page.locator('ul.rebuilt-list > li.rebuilt-li')).toHaveAttribute('title', t);
      await expect(page.locator('ul.rebuilt-list > li.rebuilt-li2')).toHaveAttribute('title', t);
      await expect(page.locator('ul.rebuilt-list > li.rebuilt-li2')).toHaveText(x);
    };
    await check('t1', 'x1');
    await setProbe(page, 'rebuiltMarkup', 't', 't2');
    await setProbe(page, 'rebuiltMarkup', 'x', 'x2');
    await check('t2', 'x2');

    await page.locator('td.rebuilt-td2').click();
    await expect(page.locator('.rebuilt-picks')).toHaveText('1');

    const options = page.locator('select.rebuilt-select > option');
    await expect(options).toHaveText(['Choose', 'o1', 'o2']);
    await setProbe(page, 'rebuiltMarkup', 'opts', ['o3']);
    await expect(options).toHaveText(['Choose', 'o3']);
    await setProbe(page, 'rebuiltMarkup', 'opts', []);
    await expect(options).toHaveText(['Choose']);
    await setProbe(page, 'rebuiltMarkup', 'opts', ['o4', 'o5']);
    await expect(options).toHaveText(['Choose', 'o4', 'o5']);
    await expect(page.locator('select.rebuilt-select > option.rebuilt-opt').first()).toHaveAttribute('value', 'o4');
    expect(probe.pageErrors).toEqual([]);
  });

  test('a repeat() whose container is the component root', async ({ page }) => {
    const probe = await mountProbe(page, 'rootList');
    const rows = page.locator('#app > p.root-list-row');
    await expect(rows).toHaveText(['r1', 'r2']);
    await setProbe(page, 'rootList', 'items', ['r3']);
    await expect(rows).toHaveText(['r3']);
    await setProbe(page, 'rootList', 'items', []);
    await expect(rows).toHaveCount(0);
    await setProbe(page, 'rootList', 'items', ['r4', 'r5', 'r6']);
    await expect(rows).toHaveText(['r4', 'r5', 'r6']);
    await setProbe(page, 'rootList', 'items', ['r6', 'r4']);
    await expect(rows).toHaveText(['r6', 'r4']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('when() / when() alone in an element, next to text and three deep, toggled five times', async ({ page }) => {
    const probe = await mountProbe(page, 'branchPositions');
    const set = (key: string, value: unknown) => setProbe(page, 'branchPositions', key, value);
    const clicks = page.locator('.branches-clicks');
    let clickCount = 0;
    const click = async (selector: string) => {
      await page.locator(selector).click();
      await expect(clicks).toHaveText(String(++clickCount));
    };

    await expect(page.locator('.branches-only-w')).toHaveAttribute('title', 't0');
    await expect(page.locator('.branches-only-w')).toHaveText('t0+only');
    await expect(page.locator('.branches-text')).toHaveText('before t0+then after');
    await expect(page.locator('.branches-l3')).toHaveText('L3:t0+l3');
    expect(await countingKidCounts(page)).toEqual({ mount: { only: 1, then: 1, l3: 1 }, destroy: {} });
    await click('.branches-only-btn');
    await click('.branches-then-btn');
    await click('.branches-l3-btn');

    for (let round = 1; round <= 5; round++) {
      // when() as the only child of its element
      await set('only', false);
      await expect(page.locator('.branches-only')).toHaveText('');
      await set('t', `o${round}`);
      await set('only', true);
      await expect(page.locator('.branches-only-w')).toHaveAttribute('title', `o${round}`);
      await expect(page.locator('.branches-only-w')).toHaveText(`o${round}+only`);
      await click('.branches-only-btn');

      // when() between text
      await set('text', false);
      await expect(page.locator('.branches-text')).toHaveText(`before o${round} after`);
      await expect(page.locator('.branches-else')).toHaveAttribute('title', `o${round}`);
      await set('t', `x${round}`);
      await expect(page.locator('.branches-else')).toHaveText(`x${round}`);
      await set('text', true);
      await expect(page.locator('.branches-text')).toHaveText(`before x${round}+then after`);
      await expect(page.locator('.branches-then')).toHaveAttribute('title', `x${round}`);
      await click('.branches-then-btn');

      // three deep: hide the innermost, the middle, then the outer level, and show them back
      await set('l3', false);
      await expect(page.locator('.branches-l3')).toHaveCount(0);
      await set('l2', false);
      await expect(page.locator('.branches-l2')).toHaveCount(0);
      await expect(page.locator('.branches-l2-else')).toHaveText('no');
      await set('l1', false);
      await expect(page.locator('.branches-l1')).toHaveCount(0);
      await set('t', `d${round}`);
      await set('l1', true);
      await expect(page.locator('.branches-l1')).toHaveAttribute('title', `d${round}`);
      await expect(page.locator('.branches-l2-else')).toHaveText('no');
      await set('l2', true);
      await expect(page.locator('.branches-l2')).toHaveAttribute('title', `d${round}`);
      await set('l3', true);
      await expect(page.locator('.branches-l3')).toHaveAttribute('title', `d${round}`);
      await expect(page.locator('.branches-l3')).toHaveText(`L3:d${round}+l3`);
      await expect(page.locator('.branches-l1')).toContainText(`L1:d${round}`);
      await click('.branches-l3-btn');

      // l3's child also mounts and is destroyed again each time an outer level shows: l1's and l2's
      // templates carry l3's content pre-rendered (its compile-time value is true), and a pre-rendered
      // branch whose condition is false when it binds is initialised, then hidden
      expect(await countingKidCounts(page)).toEqual({
        mount: { only: round + 1, then: round + 1, l3: 3 * round + 1 },
        destroy: { only: round, then: round, l3: 3 * round },
      });
    }

    // Hiding an outer level destroys the children of every level inside it once
    await set('l1', false);
    expect((await countingKidCounts(page)).destroy.l3).toBe(16);
    await set('l1', true);
    expect((await countingKidCounts(page)).mount.l3).toBe(17);
    await expect(page.locator('.branches-l3')).toHaveText('L3:d5+l3');
    expect(probe.pageErrors).toEqual([]);
  });

  test('when() and when() at the top level of the template, between static nodes', async ({ page }) => {
    const probe = await mountProbe(page, 'topLevelBranches');
    const set = (key: string, value: unknown) => setProbe(page, 'topLevelBranches', key, value);
    const children = () =>
      page
        .locator('#app')
        .evaluate((app) =>
          [...app.children]
            .filter((el) => el.tagName !== 'TEMPLATE')
            .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
        );

    expect(await children()).toEqual(['b.top-w', 'u.top-else', 'span.top-static']);
    for (let round = 1; round <= 5; round++) {
      await set('a', false);
      await set('b', true);
      expect(await children()).toEqual(['i.top-then', 'span.top-static']);
      await set('t', `t${round}`);
      await expect(page.locator('.top-then')).toHaveAttribute('title', `t${round}`);
      await expect(page.locator('.top-then')).toHaveText(`t${round}`);
      await set('a', true);
      await set('b', false);
      expect(await children()).toEqual(['b.top-w', 'u.top-else', 'span.top-static']);
      await expect(page.locator('.top-w')).toHaveAttribute('title', `t${round}`);
      await expect(page.locator('.top-else')).toHaveText(`t${round}`);
    }
    expect(probe.pageErrors).toEqual([]);
  });

  test('a component mounted into document.body after the nodes the page already holds', async ({ page }) => {
    const probe = await openProbe(page, 'bodyMount', { target: 'body' });
    expect(await probe.mountErrors()).toEqual([]);
    const bodyChildren = () =>
      page.evaluate(() =>
        [...document.body.children]
          .filter((el) => el.tagName !== 'SCRIPT')
          .map((el) => el.className || el.id || el.tagName),
      );
    expect(await bodyChildren()).toEqual(['H1', 'app', 'comment-quote-leak', 'body-mount']);
    await expect(page.getByTestId('hardening-title')).toHaveText('Thane Hardening App');
    await expect(page.locator('#app')).toBeEmpty();

    await expect(page.locator('body > .body-mount')).toHaveAttribute('title', 't0');
    await expect(page.locator('.body-mount-row')).toHaveText(['a', 'b']);
    await setProbe(page, 'bodyMount', 't', 't1');
    await setProbe(page, 'bodyMount', 'items', ['c', 'a', 'b']);
    await expect(page.locator('body > .body-mount')).toHaveAttribute('title', 't1');
    await expect(page.locator('.body-mount-row')).toHaveText(['c', 'a', 'b']);
    await page.locator('.body-mount-btn').click();
    await expect(page.locator('.body-mount-btn')).toHaveText('1');
    const bodyText = await page.evaluate(() => document.body.textContent!.replace(/\s+/g, ' '));
    // The component's text follows the page's own content (a production build drops the whitespace)
    expect(bodyText).toMatch(/outside every component ?body t1/);
    expect(await bodyChildren()).toEqual(['H1', 'app', 'comment-quote-leak', 'body-mount']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a text-only when() branch that starts hidden shows its text and toggles', async ({ page }) => {
    const probe = await mountProbe(page, 'hiddenTextBranch');
    const section = page.locator('section.hidden-text');
    await expect(section).toHaveText('else');
    for (let n = 1; n <= 5; n++) {
      await setProbe(page, 'hiddenTextBranch', 'on', true);
      await expect(section).toHaveText(`text-${n}`);
      await setProbe(page, 'hiddenTextBranch', 'n', n + 1);
      await expect(section).toHaveText(`text-${n + 1}`);
      await setProbe(page, 'hiddenTextBranch', 'on', false);
      await expect(section).toHaveText('else');
      await expect(section.locator('.hidden-text-else')).toHaveCount(1);
    }
    expect(probe.pageErrors).toEqual([]);
  });

  test('a child component after a row when() of unknown initial value mounts in its own place', async ({ page }) => {
    const probe = await mountProbe(page, 'rowChildAfterWhen');
    const shape = (rowClass: string) =>
      page
        .locator(rowClass)
        .evaluateAll((rows) =>
          rows.map((row) => [...row.children].map((el) => `${el.tagName.toLowerCase()}:${el.textContent}`)),
        );
    const card = 'hardening-probe-card';
    expect(await shape('.after-when-row')).toEqual([[`${card}:g1`], [`${card}:g2`]]);
    await setProbe(page, 'rowChildAfterWhen', 'on', true);
    expect(await shape('.after-when-row')).toEqual([
      ['b:L', `${card}:g1`],
      ['b:L', `${card}:g2`],
    ]);
    await setProbe(page, 'rowChildAfterWhen', 'on', false);
    expect(await shape('.after-when-row')).toEqual([[`${card}:g1`], [`${card}:g2`]]);
    // A nested list before the child: its rows go before its own anchor, the child stays after them
    expect(await shape('.after-list-row')).toEqual([
      ['i:t1', 'i:t2', `${card}:g1`],
      ['i:t3', `${card}:g2`],
    ]);
    await setProbe(page, 'rowChildAfterWhen', 'rows', [
      { id: 1, g: 'g1', tags: ['t4'] },
      { id: 2, g: 'g2', tags: ['t5', 't6'] },
    ]);
    expect(await shape('.after-list-row')).toEqual([
      ['i:t4', `${card}:g1`],
      ['i:t5', 'i:t6', `${card}:g2`],
    ]);
    // No placeholder element is left anywhere
    await expect(page.locator('.after-when template, .after-list template')).toHaveCount(0);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a list anchor is a comment: static siblings and the list survive clearing', async ({ page }) => {
    // The anchor is the container's last node, a comment; no placeholder element is left
    const lastNode = (container: string) =>
      page.locator(container).evaluate((el) => ({
        type: el.lastChild?.nodeType,
        templates: el.querySelectorAll('template').length,
      }));
    const probe = await mountProbe(page, 'staticSibling');
    expect(await lastNode('ul.static-sibling')).toEqual({ type: 8, templates: 0 });
    await setProbe(page, 'staticSibling', 'items', []);
    await expect(page.locator('ul.static-sibling > li')).toHaveText(['H']);
    expect(await lastNode('ul.static-sibling')).toEqual({ type: 8, templates: 0 });
    await setProbe(page, 'staticSibling', 'items', ['c', 'd']);
    await expect(page.locator('ul.static-sibling > li')).toHaveText(['H', 'c', 'd']);
    expect(probe.pageErrors).toEqual([]);

    // A list alone in its container (the component root holds only the rows and the anchor), which
    // clearing empties at once and gives the anchor back
    const root = await mountProbe(page, 'rootList');
    await setProbe(page, 'rootList', 'items', []);
    await expect(page.locator('#app > p.root-list-row')).toHaveCount(0);
    expect(await page.locator('#app').evaluate((el) => [...el.childNodes].map((n) => n.nodeType))).toEqual([8]);
    await setProbe(page, 'rootList', 'items', ['r7', 'r8']);
    await expect(page.locator('#app > p.root-list-row')).toHaveText(['r7', 'r8']);
    expect(await lastNode('#app')).toEqual({ type: 8, templates: 0 });
    expect(root.pageErrors).toEqual([]);
  });

  test('child hosts: in the template where the parser keeps them, replacing a comment where it would not', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'childHosts');
    const card = 'hardening-probe-card';
    // One host per child, in its place, with the child mounted into it
    const children = (selector: string) =>
      page
        .locator(selector)
        .evaluateAll((els) =>
          els.map((el) => [...el.children].map((c) => `${c.tagName.toLowerCase()}:${c.textContent}`)),
        );
    expect(await children('.hosts-p')).toEqual([[`${card}:p`]]);
    // a table row: the host replaces a comment anchor, inside the row
    expect(await children('.hosts-tbody > tr')).toEqual([
      ['td:g1', `${card}:tr-g1`],
      ['td:g2', `${card}:tr-g2`],
    ]);
    // a row that is only the child: the host is the row
    expect(await children('.hosts-list')).toEqual([[`${card}:row-g1`, `${card}:row-g2`]]);
    // svg: the host is an HTML element, as createElement makes it
    const svgHost = await page
      .locator('.hosts-svg')
      .evaluate((svg) => [...svg.children].map((c) => [c.localName, c.namespaceURI, c.textContent]));
    expect(svgHost).toEqual([[card, 'http://www.w3.org/1999/xhtml', 'svg']]);
    // rows that move and go keep their children
    await setProbe(page, 'childHosts', 'rows', [
      { id: 2, g: 'g2' },
      { id: 3, g: 'g3' },
    ]);
    expect(await children('.hosts-tbody > tr')).toEqual([
      ['td:g2', `${card}:tr-g2`],
      ['td:g3', `${card}:tr-g3`],
    ]);
    expect(await children('.hosts-list')).toEqual([[`${card}:row-g2`, `${card}:row-g3`]]);
    await setProbe(page, 'childHosts', 'rows', []);
    expect(await children('.hosts-list')).toEqual([[]]);
    await expect(page.locator('.hosts-tbody > tr')).toHaveCount(0);
    expect(probe.pageErrors).toEqual([]);
  });

  test('no generated id reaches the DOM', async ({ page }) => {
    for (const id of [
      'duplicateIds',
      'childSameId',
      'textPositions',
      'rebuiltMarkup',
      'rootList',
      'branchPositions',
      'topLevelBranches',
      'rowChildAfterWhen',
      'childHosts',
      'staticSibling',
    ]) {
      const probe = await mountProbe(page, id);
      const markup = await page.locator('#app').evaluate((el) => el.innerHTML);
      expect(markup.match(/\bid="[bi]\d+"|<template|<!--[bi]\d|data-thane-ref/g) ?? [], id).toEqual([]);
      expect(probe.pageErrors, id).toEqual([]);
    }
  });

  test('an event on an element with an empty id attribute is bound', async ({ page }) => {
    const probe = await mountProbe(page, 'emptyIdEvent');
    await page.locator('.empty-id-btn').click();
    await expect(page.locator('.empty-id-btn')).toHaveText('1');
    expect(probe.pageErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// The text between row text bindings, rendered. Text is compared exactly (textContent), not
// whitespace-normalised.
// ═══════════════════════════════════════════════════════════════════════

type TextRow = { id: number; first: string; mid: string; last: string };

const TEXT_ROWS: TextRow[] = [{ id: 1, first: 'John', mid: 'Q', last: 'Doe' }];
const TEXT_ROWS_UPDATED: TextRow[] = [
  { id: 2, first: 'Jane', mid: 'R', last: 'Roe' },
  { id: 1, first: 'Max', mid: 'S', last: 'Mu' },
];

/** The exact text of every row of the probe's list `.row-text-<shape>`. */
const rowTexts = (page: Page, shape: string): Promise<string[]> =>
  page.locator(`.row-text-${shape} li`).allTextContents();

test.describe('row text bindings', () => {
  test('row text bindings separated by whitespace show one space, and update', async ({ page }) => {
    const probe = await mountProbe(page, 'rowTextSpace');
    const check = async (rows: TextRow[], label: string) => {
      for (const shape of ['space', 'two', 'newline', 'padded']) {
        await expect.poll(() => rowTexts(page, shape), shape).toEqual(rows.map((r) => `${r.first} ${r.last}`));
      }
      await expect.poll(() => rowTexts(page, 'three')).toEqual(rows.map((r) => `${r.first} ${r.mid} ${r.last}`));
      await expect.poll(() => rowTexts(page, 'signal')).toEqual(rows.map((r) => `${r.first} ${label}`));
    };
    await check(TEXT_ROWS, 'L');
    await setProbe(page, 'rowTextSpace', 'items', TEXT_ROWS_UPDATED);
    await setProbe(page, 'rowTextSpace', 'label', 'M');
    await check(TEXT_ROWS_UPDATED, 'M');
    expect(probe.pageErrors).toEqual([]);
  });

  test('row shapes that already show their text as written: -, adjacent, around, in a when(), and component level', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'rowTextSpace');
    const check = async (rows: TextRow[], a: string, b: string) => {
      await expect.poll(() => rowTexts(page, 'dash')).toEqual(rows.map((r) => `${r.first}-${r.last}`));
      await expect.poll(() => rowTexts(page, 'adjacent')).toEqual(rows.map((r) => `${r.first}${r.last}`));
      await expect.poll(() => rowTexts(page, 'around')).toEqual(rows.map((r) => `x ${r.first} y`));
      await expect.poll(() => rowTexts(page, 'when')).toEqual(rows.map((r) => `${r.first} ${r.last}`));
      await expect.poll(() => page.locator('.row-text-component').textContent()).toBe(`${a} ${b}`);
    };
    await check(TEXT_ROWS, 'A', 'B');
    await setProbe(page, 'rowTextSpace', 'items', TEXT_ROWS_UPDATED);
    await setProbe(page, 'rowTextSpace', 'a', 'A2');
    await check(TEXT_ROWS_UPDATED, 'A2', 'B');
    expect(probe.pageErrors).toEqual([]);
  });

  test('the space between a text binding and an element shows, in rows and at component level', async ({ page }) => {
    const probe = await mountProbe(page, 'rowTextSpace');
    await expect.poll(() => rowTexts(page, 'before')).toEqual(['John b']);
    await expect.poll(() => rowTexts(page, 'after')).toEqual(['b John']);
    await expect.poll(() => page.locator('.row-text-cbefore').textContent()).toBe('A b');
    await expect.poll(() => page.locator('.row-text-cafter').textContent()).toBe('b A');
    expect(probe.pageErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// The whitespace between a text binding and an element or
// directive next to it, rendered. Text is compared exactly (textContent): a hidden when() leaves the
// space on each side of its anchors, as static text around a removed element would.
// ═══════════════════════════════════════════════════════════════════════

/** The exact text of every row of the probe's list `.next-to-<shape>`. */
const nextToRows = (page: Page, shape: string): Promise<string[]> =>
  page.locator(`.next-to-${shape} li`).allTextContents();
const nextToText = (page: Page, shape: string): Promise<string | null> =>
  page.locator(`.next-to-${shape}`).textContent();

test.describe('text bindings next to elements and directives', () => {
  test('whitespace between a text binding and an element or directive shows as one space', async ({ page }) => {
    const probe = await mountProbe(page, 'textNextToElements');
    await expect.poll(() => nextToRows(page, 'label')).toEqual(['Name: John']);
    await expect.poll(() => nextToRows(page, 'check')).toEqual([' John']);
    await expect.poll(() => nextToRows(page, 'before')).toEqual(['John x']);
    await expect.poll(() => nextToRows(page, 'when')).toEqual(['John w Doe']);
    await expect.poll(() => nextToRows(page, 'whenelse')).toEqual(['John y Doe']);
    await expect.poll(() => nextToText(page, 'cbefore')).toBe('A x');
    await expect.poll(() => nextToText(page, 'cwhen')).toBe('A w B');
    await expect.poll(() => nextToText(page, 'cwhenelse')).toBe('A y B');
    await expect.poll(() => nextToText(page, 'branch')).toBe('A x');

    await setProbe(page, 'textNextToElements', 'items', [
      { id: 2, first: 'Jane', last: 'Roe', on: false },
      { id: 1, first: 'Max', last: 'Mu', on: true },
    ]);
    await setProbe(page, 'textNextToElements', 'a', 'A2');
    await expect.poll(() => nextToRows(page, 'label')).toEqual(['Name: Jane', 'Name: Max']);
    await expect.poll(() => nextToRows(page, 'before')).toEqual(['Jane x', 'Max x']);
    await expect.poll(() => nextToRows(page, 'when')).toEqual(['Jane  Roe', 'Max w Mu']);
    await expect.poll(() => nextToRows(page, 'whenelse')).toEqual(['Jane n Roe', 'Max y Mu']);
    await expect.poll(() => nextToText(page, 'cbefore')).toBe('A2 x');
    await expect.poll(() => nextToText(page, 'branch')).toBe('A2 x');

    await setProbe(page, 'textNextToElements', 'on', false);
    await expect.poll(() => nextToText(page, 'cwhen')).toBe('A2  B');
    await expect.poll(() => nextToText(page, 'cwhenelse')).toBe('A2 n B');
    await expect.poll(() => nextToText(page, 'branch')).toBe('none');
    await setProbe(page, 'textNextToElements', 'on', true);
    await expect.poll(() => nextToText(page, 'cwhen')).toBe('A2 w B');
    await expect.poll(() => nextToText(page, 'branch')).toBe('A2 x');
    expect(probe.pageErrors).toEqual([]);
  });

  test('a space between two elements on one line stays; with a line break it goes', async ({ page }) => {
    const probe = await mountProbe(page, 'textNextToElements');
    await expect.poll(() => nextToText(page, 'elements')).toBe('x y');
    await expect.poll(() => nextToText(page, 'lines')).toBe('xy');
    expect(probe.pageErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Nested directives inside repeat() rows: everything a component-level list or branch can contain
// also works inside a row, at any depth.
// ═══════════════════════════════════════════════════════════════════════

type DirectiveRow = { id: number; first: string; last: string; on: boolean; tags: string[] };

const texts = (page: Page, selector: string): Promise<string[]> => page.locator(selector).allTextContents();
const directivesLog = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as any).__probe.rowDirectives.log()]);

test.describe('nested directives in rows', () => {
  test('a when() pre-rendered in a row binds its content: two bindings with a space, an attribute', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'rowDirectives');
    await expect.poll(() => texts(page, '.row-dirs-pre-w')).toEqual(['John Doe', 'Jane Roe']);
    await expect(page.locator('.row-dirs-pre-w').first()).toHaveAttribute('title', 'John');

    const rows: DirectiveRow[] = [
      { id: 2, first: 'Max', last: 'Mu', on: true, tags: [] },
      { id: 1, first: 'Ann', last: 'Lee', on: false, tags: ['z'] },
    ];
    await setProbe(page, 'rowDirectives', 'rows', rows);
    await expect.poll(() => texts(page, '.row-dirs-pre-w')).toEqual(['Max Mu', 'Ann Lee']);
    await setProbe(page, 'rowDirectives', 'show', false);
    await expect(page.locator('.row-dirs-pre-w')).toHaveCount(0);
    await setProbe(page, 'rowDirectives', 'show', true);
    await expect.poll(() => texts(page, '.row-dirs-pre-w')).toEqual(['Max Mu', 'Ann Lee']);
    await expect(page.locator('.row-dirs-pre-w').first()).toHaveAttribute('title', 'Max');
    expect(probe.pageErrors).toEqual([]);
  });

  test('handlers in both when() branches of a row fire; .stop keeps a click from the row handler', async ({ page }) => {
    const probe = await mountProbe(page, 'rowDirectives');
    await page.locator('.row-dirs-then').click();
    await page.locator('.row-dirs-else').click();
    await expect.poll(() => directivesLog(page)).toEqual(['then1', 'row1', 'else2']);

    // Swap the branches: each row's other branch is bound when it shows
    await setProbe(page, 'rowDirectives', 'rows', [
      { id: 1, first: 'John', last: 'Doe', on: false, tags: [] },
      { id: 2, first: 'Jane', last: 'Roe', on: true, tags: [] },
    ]);
    await page.locator('.row-dirs-then').click();
    await page.locator('.row-dirs-else').click();
    await expect.poll(() => directivesLog(page)).toEqual(['then1', 'row1', 'else2', 'then2', 'row2', 'else1']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('child components in a row when() and when() mount, and go and come back with their branch', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'rowDirectives');
    await expect.poll(() => texts(page, '.row-dirs-kw .ckid')).toEqual(['w1', 'w2']);
    await expect.poll(() => texts(page, '.row-dirs-kr .ckid')).toEqual(['r1']);
    await expect.poll(() => texts(page, '.row-dirs-kt .ckid')).toEqual(['t1']);
    await expect.poll(() => texts(page, '.row-dirs-ke .ckid')).toEqual(['e2']);
    expect((await countingKidCounts(page)).mount).toEqual({ w1: 1, w2: 1, r1: 1, t1: 1, e2: 1 });

    // Swap the rows' conditions: each child goes with its branch, the other branch's child comes
    await setProbe(page, 'rowDirectives', 'rows', [
      { id: 1, first: 'John', last: 'Doe', on: false, tags: [] },
      { id: 2, first: 'Jane', last: 'Roe', on: true, tags: [] },
    ]);
    await expect.poll(() => texts(page, '.row-dirs-kr .ckid')).toEqual(['r2']);
    await expect.poll(() => texts(page, '.row-dirs-kt .ckid')).toEqual(['t2']);
    await expect.poll(() => texts(page, '.row-dirs-ke .ckid')).toEqual(['e1']);
    expect(await countingKidCounts(page)).toEqual({
      mount: { w1: 1, w2: 1, r1: 1, t1: 1, e2: 1, r2: 1, t2: 1, e1: 1 },
      destroy: { r1: 1, t1: 1, e2: 1 },
    });

    await setProbe(page, 'rowDirectives', 'show', false);
    await expect(page.locator('.row-dirs-kw')).toHaveCount(0);
    await setProbe(page, 'rowDirectives', 'show', true);
    await expect.poll(() => texts(page, '.row-dirs-kw .ckid')).toEqual(['w1', 'w2']);
    expect((await countingKidCounts(page)).destroy).toEqual({ r1: 1, t1: 1, e2: 1, w1: 1, w2: 1 });

    await setProbe(page, 'rowDirectives', 'rows', []);
    await expect(page.locator('.ckid')).toHaveCount(0);
    expect((await countingKidCounts(page)).destroy).toEqual({ r1: 1, t1: 1, e2: 1, w1: 2, w2: 2, r2: 1, t2: 1, e1: 1 });
    expect(probe.pageErrors).toEqual([]);
  });

  test('a when() and a list inside a row when(), and a list inside a row when() branch', async ({ page }) => {
    const probe = await mountProbe(page, 'rowDirectives');
    await expect.poll(() => texts(page, '.row-dirs-in-then')).toEqual(['John']);
    await expect.poll(() => texts(page, '.row-dirs-in-else')).toEqual(['off']);
    await expect.poll(() => texts(page, '.row-dirs-in-tag')).toEqual(['a', 'b', 'c']);
    await expect.poll(() => texts(page, '.row-dirs-we-tag')).toEqual(['John:a', 'John:b']);
    await expect.poll(() => texts(page, '.row-dirs-we-none')).toEqual(['none']);

    await setProbe(page, 'rowDirectives', 'rows', [
      { id: 1, first: 'Jo', last: 'Doe', on: true, tags: ['a', 'x', 'b'] },
      { id: 2, first: 'Ja', last: 'Roe', on: true, tags: ['c'] },
    ]);
    await expect.poll(() => texts(page, '.row-dirs-in-then')).toEqual(['Jo', 'Ja']);
    await expect.poll(() => texts(page, '.row-dirs-in-tag')).toEqual(['a', 'x', 'b', 'c']);
    await expect.poll(() => texts(page, '.row-dirs-we-tag')).toEqual(['Jo:a', 'Jo:x', 'Jo:b', 'Ja:c']);
    await expect(page.locator('.row-dirs-we-none')).toHaveCount(0);

    await setProbe(page, 'rowDirectives', 'show', false);
    await expect(page.locator('.row-dirs-in')).toHaveCount(0);
    await setProbe(page, 'rowDirectives', 'show', true);
    await expect.poll(() => texts(page, '.row-dirs-in-tag')).toEqual(['a', 'x', 'b', 'c']);
    await expect.poll(() => texts(page, '.row-dirs-in-then')).toEqual(['Jo', 'Ja']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('rows whose items are signals: a when() on the item signal and a binding in it', async ({ page }) => {
    const probe = await mountProbe(page, 'signalRows');
    await expect.poll(() => texts(page, '.signal-row')).toEqual(['s1', '']);
    await page.evaluate(() => (window as any).__probe.signalRows.set(1, { on: true }));
    await expect.poll(() => texts(page, '.signal-row')).toEqual(['s1', 's2']);
    await page.evaluate(() => (window as any).__probe.signalRows.set(0, { name: 's1b' }));
    await expect.poll(() => texts(page, '.signal-row')).toEqual(['s1b', 's2']);
    await page.evaluate(() => (window as any).__probe.signalRows.set(0, { on: false }));
    await expect.poll(() => texts(page, '.signal-row')).toEqual(['', 's2']);
    expect(probe.pageErrors).toEqual([]);
  });
});

type NestedMid = { id: number; name: string; on: boolean; leaves: { id: number; n: string }[] };
type NestedTop = { id: number; title: string; mids: NestedMid[] };

/** The nestedLists probe's starting data (e2e/hardening-app/probes/nested-lists.ts), changed by `edit`. */
const nestedTops = (edit: (tops: NestedTop[]) => void = () => {}): NestedTop[] => {
  const tops: NestedTop[] = [
    {
      id: 1,
      title: 'A',
      mids: [
        {
          id: 11,
          name: 'a1',
          on: true,
          leaves: [
            { id: 111, n: 'x' },
            { id: 112, n: 'y' },
          ],
        },
        { id: 12, name: 'a2', on: false, leaves: [] },
      ],
    },
    { id: 2, title: 'B', mids: [{ id: 21, name: 'b1', on: true, leaves: [{ id: 211, n: 'z' }] }] },
    { id: 3, title: 'C', mids: [] },
  ];
  edit(tops);
  return tops;
};
const nestedLog = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as any).__probe.nestedLists.log()]);

test.describe('nested lists in rows', () => {
  test('three levels of lists: each row reads the rows above it and follows their updates', async ({ page }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-top-title')).toEqual(['A', 'B', 'C']);
    await expect.poll(() => texts(page, '.lists-mid-name')).toEqual(['A/a1', 'A/a2', 'B/b1']);
    await expect.poll(() => texts(page, '.lists-leaf-btn')).toEqual(['A/a1/x', 'A/a1/y', 'B/b1/z']);

    await setProbe(
      page,
      'nestedLists',
      'tops',
      nestedTops((t) => {
        t[0]!.title = 'A2';
        t[0]!.mids[0]!.leaves.pop();
        t[0]!.mids[1]!.leaves.push({ id: 121, n: 'w' });
      }),
    );
    await expect.poll(() => texts(page, '.lists-mid-name')).toEqual(['A2/a1', 'A2/a2', 'B/b1']);
    await expect.poll(() => texts(page, '.lists-leaf-btn')).toEqual(['A2/a1/x', 'A2/a2/w', 'B/b1/z']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('handlers on every level of nested lists fire in bubbling order; .stop keeps a click in its row', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await page.locator('.lists-leaf-btn', { hasText: 'A/a1/y' }).click();
    await expect.poll(() => nestedLog(page)).toEqual(['leaf112', 'mid11', 'top1']);
    await page.locator('.lists-leaf-stop').last().click();
    await expect.poll(() => nestedLog(page)).toEqual(['leaf112', 'mid11', 'top1', 'stop211']);
    await page.locator('.lists-mid-name', { hasText: 'B/b1' }).click();
    await expect.poll(() => nestedLog(page)).toEqual(['leaf112', 'mid11', 'top1', 'stop211', 'mid21', 'top2']);

    // Rows created by an update are bound like the first ones
    await setProbe(
      page,
      'nestedLists',
      'tops',
      nestedTops((t) => t[2]!.mids.push({ id: 31, name: 'c1', on: true, leaves: [{ id: 311, n: 'v' }] })),
    );
    await page.locator('.lists-leaf-btn', { hasText: 'C/c1/v' }).click();
    await expect
      .poll(() => nestedLog(page))
      .toEqual(['leaf112', 'mid11', 'top1', 'stop211', 'mid21', 'top2', 'leaf311', 'mid31', 'top3']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('index bindings in inner rows follow a reorder and an insert', async ({ page }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-idx-row')).toEqual(['0:a1', '1:a2', '0:b1']);
    await setProbe(
      page,
      'nestedLists',
      'tops',
      nestedTops((t) => t[0]!.mids.reverse()),
    );
    await expect.poll(() => texts(page, '.lists-idx-row')).toEqual(['0:a2', '1:a1', '0:b1']);
    await setProbe(
      page,
      'nestedLists',
      'tops',
      nestedTops((t) => t[0]!.mids.reverse().unshift({ id: 10, name: 'a0', on: true, leaves: [] })),
    );
    await expect.poll(() => texts(page, '.lists-idx-row')).toEqual(['0:a0', '1:a2', '2:a1', '0:b1']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('child components in inner rows mount with the outer row in their props, and go with their row', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-kid-row .ckid')).toEqual(['A/a1', 'A/a2', 'B/b1']);
    expect((await countingKidCounts(page)).mount).toEqual({ 'A/a1': 1, 'A/a2': 1, 'B/b1': 1 });

    await setProbe(
      page,
      'nestedLists',
      'tops',
      nestedTops((t) => {
        t[0]!.mids.pop();
        t.splice(1, 1);
      }),
    );
    await expect.poll(() => texts(page, '.lists-kid-row .ckid')).toEqual(['A/a1']);
    expect((await countingKidCounts(page)).destroy).toEqual({ 'A/a2': 1, 'B/b1': 1 });

    await setProbe(page, 'nestedLists', 'tops', []);
    await expect(page.locator('.ckid')).toHaveCount(0);
    expect(await countingKidCounts(page)).toEqual({
      mount: { 'A/a1': 1, 'A/a2': 1, 'B/b1': 1 },
      destroy: { 'A/a1': 1, 'A/a2': 1, 'B/b1': 1 },
    });
    expect(probe.pageErrors).toEqual([]);
  });

  test("an inner list's empty template shows while it is empty", async ({ page }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-e-row')).toEqual(['a1', 'a2', 'b1']);
    await expect.poll(() => texts(page, '.lists-e-none')).toEqual(['none']);
    await setProbe(
      page,
      'nestedLists',
      'tops',
      nestedTops((t) => {
        t[1]!.mids = [];
        t[2]!.mids.push({ id: 31, name: 'c1', on: true, leaves: [] });
      }),
    );
    await expect.poll(() => texts(page, '.lists-e-row')).toEqual(['a1', 'a2', 'c1']);
    await expect.poll(() => texts(page, '.lists-e-none')).toEqual(['none']);
    await expect(page.locator('.lists-empty > li').nth(1).locator('.lists-e-none')).toHaveCount(1);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a when() and a when() in inner rows', async ({ page }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-branch-on')).toEqual(['a1', 'b1']);
    await expect.poll(() => texts(page, '.lists-branch-t')).toEqual(['A', 'B']);
    await expect.poll(() => texts(page, '.lists-branch-f')).toEqual(['off']);
    await setProbe(
      page,
      'nestedLists',
      'tops',
      nestedTops((t) => {
        t[0]!.title = 'A2';
        t[0]!.mids[1]!.on = true;
      }),
    );
    await expect.poll(() => texts(page, '.lists-branch-on')).toEqual(['a1', 'a2', 'b1']);
    await expect.poll(() => texts(page, '.lists-branch-t')).toEqual(['A2', 'A2', 'B']);
    await expect(page.locator('.lists-branch-f')).toHaveCount(0);
    expect(probe.pageErrors).toEqual([]);
  });

  test('repeat › whenElse › repeat › when() and when()', async ({ page }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-mx-row')).toEqual(['A:a1on', 'off', 'B:b1on']);
    await setProbe(page, 'nestedLists', 'show', false);
    await expect.poll(() => texts(page, '.lists-mx-hidden')).toEqual(['hidden', 'hidden', 'hidden']);
    await setProbe(
      page,
      'nestedLists',
      'tops',
      nestedTops((t) => (t[0]!.mids[1]!.on = true)),
    );
    await setProbe(page, 'nestedLists', 'show', true);
    await expect.poll(() => texts(page, '.lists-mx-row')).toEqual(['A:a1on', 'A:a2on', 'B:b1on']);
    expect(probe.pageErrors).toEqual([]);
  });

  test("an inner list whose item has the outer item's name reads its own item", async ({ page }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-sh-row')).toEqual(['a1', 'a2', 'b1']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a handler of the outer row on an element after an inner list, in its container', async ({ page }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-af-row')).toEqual(['a1', 'a2', 'b1']);
    await page.locator('.lists-af-btn').first().click();
    await page.locator('.lists-af-btn').last().click();
    await expect.poll(() => nestedLog(page)).toEqual(['after1', 'after3']);
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('nested lists in rows: an outer item named item', () => {
  test("a child in an inner row reads an outer row's item named `item`", async ({ page }) => {
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-oi-row .card')).toEqual(['A:a1', 'A:a2', 'B:b1']);
    await setProbe(
      page,
      'nestedLists',
      'tops',
      nestedTops((t) => t[2]!.mids.push({ id: 31, name: 'c1', on: true, leaves: [] })),
    );
    await expect.poll(() => texts(page, '.lists-oi-row .card')).toEqual(['A:a1', 'A:a2', 'B:b1', 'C:c1']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('rows whose items are signals and are named `item`: inner rows read item() and follow it', async ({ page }) => {
    // Row factories used to call every row's item `item`, so an inner row's own item hid the outer one
    // and item() threw. They keep the source's names now, and scoping works as in the source.
    const probe = await mountProbe(page, 'nestedLists');
    await expect.poll(() => texts(page, '.lists-si-row')).toEqual(['A/x', 'A/y', 'B/z']);
    await page.evaluate(() => (window as any).__probe.nestedLists.sigRows()[0]({ id: 1, name: 'C', tags: ['x', 'y'] }));
    await expect.poll(() => texts(page, '.lists-si-row')).toEqual(['C/x', 'C/y', 'B/z']);
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('double quotes inside attribute expressions', () => {
  test('row and component attributes whose expression holds double quotes render and update', async ({ page }) => {
    const probe = await mountProbe(page, 'quotesInAttrs');
    const rows = page.locator('.hardening-quotes-in-attrs li');
    await expect(page.locator('.quotes-top')).toHaveAttribute('title', 'one');
    await expect(rows.nth(0)).toHaveAttribute('class', 'on');
    await expect(rows.nth(0)).toHaveAttribute('title', 'yes');
    await expect(rows.nth(0)).toHaveAttribute('data-x', 'A!');
    await expect(rows.nth(1)).toHaveAttribute('title', 'no');

    await page.evaluate(() => {
      const q = (window as any).__probe.quotesInAttrs;
      q.sel(2);
      q.flag(false);
      q.items([
        { id: 1, on: false, label: 'A' },
        { id: 2, on: true, label: 'C' },
      ]);
    });
    await expect(page.locator('.quotes-top')).toHaveAttribute('title', 'two');
    await expect(rows.nth(1)).toHaveAttribute('class', 'on');
    await expect(rows.nth(0)).toHaveAttribute('title', 'no');
    await expect(rows.nth(1)).toHaveAttribute('data-x', 'C!');
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('@namespace in a component stylesheet', () => {
  test('the namespace applies, and the rule after the statement stays scoped to the component', async ({ page }) => {
    const probe = await mountProbe(page, 'cssNamespace');
    await page.evaluate(() => {
      const outside = document.createElement('p');
      outside.className = 'ns-leak';
      outside.dataset.testid = 'ns-outside';
      outside.textContent = 'outside';
      document.body.appendChild(outside);
    });
    await expect(page.locator('#app .ns-rect')).toHaveCSS('fill', 'rgb(255, 0, 0)');
    await expect(page.locator('#app .ns-leak')).toHaveCSS('color', 'rgb(1, 2, 3)');
    await expect(page.getByTestId('ns-outside')).not.toHaveCSS('color', 'rgb(1, 2, 3)');
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('calls to the component’s own functions in a template', () => {
  test('a function follows the signals it reads, a plain one renders once, a helper follows its body', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'helperCalls');
    await expect(page.locator('.calls-label')).toHaveText('Total');
    await expect(page.locator('.calls-total')).toHaveText('6');
    await expect(page.locator('.calls-formatted')).toHaveText('2 EUR');
    await setProbe(page, 'helperCalls', 'qty', 4);
    await expect(page.locator('.calls-total')).toHaveText('8');
    await expect(page.locator('.calls-total')).toHaveAttribute('title', '8');
    await setProbe(page, 'helperCalls', 'price', 5);
    await expect(page.locator('.calls-total')).toHaveText('20');
    await expect(page.locator('.calls-formatted')).toHaveText('5 EUR');
    await setProbe(page, 'helperCalls', 'currency', 'USD');
    await expect(page.locator('.calls-formatted')).toHaveText('5 USD');
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('several components in one file', () => {
  test("the file's components mount one another, each with its own signals and styles", async ({ page }) => {
    const probe = await mountProbe(page, 'severalComponents');
    const green = 'rgb(0, 128, 0)';
    await expect(page.locator('.several-own')).toHaveText('1');
    await expect(page.locator('.exported-count-value')).toHaveText('3');
    await expect(page.locator('.local-pill-text')).toHaveText(['top 2', 'a 2', 'b 2']);
    await expect(page.locator('.local-pill-text').first()).toHaveCSS('color', green);
    await expect(page.locator('.several-plain')).not.toHaveCSS('color', green);

    await setProbe(page, 'severalComponents', 'items', [
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ]);
    await expect(page.locator('.several-rows .local-pill-text')).toHaveText(['b 2', 'c 2']);
    await setProbe(page, 'exportedCount', 'count', 4);
    await expect(page.locator('.exported-count-value')).toHaveText('4');
    await setProbe(page, 'severalComponents', 'count', 5);
    await expect(page.locator('.several-own')).toHaveText('5');
    await expect(page.locator('.exported-count-value')).toHaveText('4');
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('fragments', () => {
  test('fragments go wherever a template goes: branches, twice with a child, an empty template', async ({ page }) => {
    const probe = await mountProbe(page, 'fragments');
    await expect(page.locator('.fragments-busy')).toHaveText('busy');
    await expect(page.locator('.fragments-done')).toHaveCount(0);
    await expect(page.locator('.fragments-count')).toHaveText(['1', '1']);
    await expect(page.locator('.fragment-kid-n')).toHaveText(['7', '7']);
    await expect(page.locator('.fragments-empty')).toHaveText('none');

    await setProbe(page, 'fragments', 'loading', false);
    await expect(page.locator('.fragments-busy')).toHaveCount(0);
    await expect(page.locator('.fragments-done')).toHaveText('done');
    await setProbe(page, 'fragments', 'count', 2);
    await expect(page.locator('.fragments-count')).toHaveText(['2', '2']);
    await setProbe(page, 'fragments', 'rows', [1, 2]);
    await expect(page.locator('.fragments-row')).toHaveText(['1', '2']);
    await expect(page.locator('.fragments-empty')).toHaveCount(0);
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('fragments another module exports', () => {
  test('a static one is written out; one with bindings is mounted at the top, in a branch and in rows', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'importedFragments');
    await expect(page.locator('.exported-static')).toHaveText('static');
    await expect(page.locator('.exported-badge')).toHaveText(['calm', 'calm', 'calm']);
    await expect(page.locator('.exported-kid-n')).toHaveText(['3', '3', '3']);
    await expect(page.locator('.exported-tag')).toHaveText(['a', 'b']);

    await setProbe(page, 'importedFragments', 'tone', 'loud');
    await expect(page.locator('.exported-badge')).toHaveText(['loud', 'loud', 'loud']);
    await expect(page.locator('.imported-top .exported-badge')).toHaveAttribute('data-tone', 'loud');
    await setProbe(page, 'importedFragments', 'tags', ['c']);
    await expect(page.locator('.exported-tag')).toHaveText(['c']);

    await setProbe(page, 'importedFragments', 'open', false);
    await expect(page.locator('.exported-tags')).toHaveCount(0);
    await setProbe(page, 'importedFragments', 'open', true);
    await expect(page.locator('.exported-tag')).toHaveText(['c']);

    await setProbe(page, 'importedFragments', 'rows', [2]);
    await expect(page.locator('.imported-row .exported-badge')).toHaveCount(1);
    await setProbe(page, 'importedFragments', 'tone', 'calm');
    await expect(page.locator('.exported-badge')).toHaveText(['calm', 'calm']);
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('a keyed list reordered while a row goes', () => {
  test('the rows stay before the list anchor, so a later append goes last', async ({ page }) => {
    const probe = await mountProbe(page, 'reorderBeforeAnchor');
    const rows = page.locator('ul.reorder > li');
    await expect(rows).toHaveText(['A', 'B', 'C', 'T']);
    await setProbe(page, 'reorderBeforeAnchor', 'items', [{ id: 'C' }, { id: 'A' }]);
    await expect(rows).toHaveText(['C', 'A', 'T']);
    await setProbe(page, 'reorderBeforeAnchor', 'items', [{ id: 'C' }, { id: 'A' }, { id: 'D' }]);
    await expect(rows).toHaveText(['C', 'A', 'D', 'T']);
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('JavaScript control flow in templates', () => {
  test('a ternary, &&, a chain of ternaries and .map() rows show and update like the directives they mean', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'controlFlow');
    const set = (key: string, value: unknown) => setProbe(page, 'controlFlow', key, value);
    await expect(page.locator('.flow-ternary')).toHaveText('off');
    await expect(page.locator('.flow-and')).toHaveText('');
    await expect(page.locator('.flow-chain')).toHaveText('none');
    await expect(page.locator('.flow-row')).toHaveText(['0:a', '1:b']);
    await expect(page.locator('.flow-cards .card')).toHaveText(['a', 'b']);
    await expect(page.locator('.flow-text')).toHaveText('no');

    await set('open', true);
    await set('n', 1);
    await expect(page.locator('.flow-on')).toHaveText('on 1');
    await expect(page.locator('.flow-and-on')).toHaveText('shown');
    await expect(page.locator('.flow-chain')).toHaveText('some');
    await expect(page.locator('.flow-text')).toHaveText('yes');
    await set('n', 3);
    await expect(page.locator('.flow-on')).toHaveText('on 3');
    await expect(page.locator('.flow-chain')).toHaveText('many');

    // .map() rows are keyed by index: the rows stay, and show the items now at their positions
    await set('items', ['c', 'a', 'b']);
    await expect(page.locator('.flow-row')).toHaveText(['0:c', '1:a', '2:b']);
    await expect(page.locator('.flow-cards .card')).toHaveText(['c', 'a', 'b']);
    await set('items', []);
    await expect(page.locator('.flow-row')).toHaveCount(0);

    await set('open', false);
    await expect(page.locator('.flow-ternary')).toHaveText('off');
    await expect(page.locator('.flow-and-on')).toHaveCount(0);
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe("when()'s narrowing form", () => {
  test('the branch gets the value: its bindings, handlers and child props read it, and follow it', async ({ page }) => {
    const probe = await mountProbe(page, 'narrowing');
    const set = (key: string, value: unknown) => setProbe(page, 'narrowing', key, value);
    await expect(page.locator('.narrow-none')).toHaveText('none');
    await expect(page.locator('.narrow-tag')).toHaveText(['x']);

    await set('user', { name: 'Ada', tags: ['a', 'b'] });
    await expect(page.locator('.narrow-name')).toHaveText('Ada (2)');
    await expect(page.locator('.narrow-name')).toHaveAttribute('title', 'Ada');
    await expect(page.locator('.narrow .card')).toHaveText('Ada');
    await page.locator('.narrow-greet').click();
    await expect(page.locator('.narrow-greeted')).toHaveText('Ada');

    // Another value while the branch shows: its bindings and handlers read the new one
    await set('user', { name: 'Grace', tags: [] });
    await expect(page.locator('.narrow-name')).toHaveText('Grace (0)');
    await page.locator('.narrow-greet').click();
    await expect(page.locator('.narrow-greeted')).toHaveText('Grace');

    await set('user', null);
    await expect(page.locator('.narrow-name')).toHaveCount(0);
    await expect(page.locator('.narrow-none')).toHaveText('none');

    // In rows, the condition reads the row's item
    await set('rows', [
      { id: 1, tag: null },
      { id: 2, tag: 'y' },
    ]);
    await expect(page.locator('.narrow-tag')).toHaveText(['y']);
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('a child component in a row reads the row in its props', () => {
  test("a row's new item mounts its child again; the same item keeps it", async ({ page }) => {
    const probe = await mountProbe(page, 'rowChildProps');
    await expect(page.locator('.child-props-in-row .ckid')).toHaveText(['a', 'b']);
    await expect(page.locator('.child-props-as-row .ckid')).toHaveText(['row-a', 'row-b']);

    // Row 1 gets a new object with the same key; row 2 keeps its object
    await page.evaluate(() => {
      const { rows } = (window as any).__probe.rowChildProps;
      rows([{ id: 1, label: 'c' }, rows()[1]]);
    });
    await expect(page.locator('.child-props-in-row .ckid')).toHaveText(['c', 'b']);
    await expect(page.locator('.child-props-as-row .ckid')).toHaveText(['row-c', 'row-b']);
    expect(await countingKidCounts(page)).toEqual({
      mount: { 'a': 1, 'b': 1, 'c': 1, 'row-a': 1, 'row-b': 1, 'row-c': 1 },
      destroy: { 'a': 1, 'row-a': 1 },
    });

    await setProbe(page, 'rowChildProps', 'rows', []);
    await expect(page.locator('.ckid')).toHaveCount(0);
    expect((await countingKidCounts(page)).destroy).toEqual({
      'a': 1,
      'b': 1,
      'c': 1,
      'row-a': 1,
      'row-b': 1,
      'row-c': 1,
    });
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe("a row's code reads its item and index as they are now", () => {
  /** Row 1 gets a new object with the label 'c' under its key; row 2 keeps its object */
  const relabel = (page: Page) =>
    page.evaluate(() => {
      const { rows } = (window as any).__probe.rowClosures;
      rows([{ ...rows()[0], label: 'c' }, rows()[1]]);
    });
  const swap = (page: Page) =>
    page.evaluate(() => {
      const { rows } = (window as any).__probe.rowClosures;
      rows([rows()[1], rows()[0]]);
    });
  const picked = (page: Page) => page.evaluate(() => (window as any).__probe.rowClosures.picked());

  test('a binding that reads the item and another signal', async ({ page }) => {
    const probe = await mountProbe(page, 'rowClosures');
    await expect(page.locator('.rc-mixed li')).toHaveText(['a!', 'b!']);
    await relabel(page);
    await expect(page.locator('.rc-mixed li')).toHaveText(['c!', 'b!']);
    await setProbe(page, 'rowClosures', 'suffix', '?');
    await expect(page.locator('.rc-mixed li')).toHaveText(['c?', 'b?']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a listener on a row element (.self) reads the new item', async ({ page }) => {
    const probe = await mountProbe(page, 'rowClosures');
    await relabel(page);
    await page.locator('.rc-self li').first().click();
    expect(await picked(page)).toBe('self c');
    expect(probe.pageErrors).toEqual([]);
  });

  test('a delegated handler and a listener read the index after the rows move', async ({ page }) => {
    const probe = await mountProbe(page, 'rowClosures');
    await page.locator('.rc-index li').nth(1).click();
    expect(await picked(page)).toBe('index 1');
    await page.locator('.rc-self-index li').nth(1).click();
    expect(await picked(page)).toBe('self index 1');
    await swap(page);
    await expect(page.locator('.rc-index li')).toHaveText(['b', 'a']);
    await page.locator('.rc-index li').nth(1).click();
    expect(await picked(page)).toBe('index 1');
    await page.locator('.rc-index li').first().click();
    expect(await picked(page)).toBe('index 0');
    await page.locator('.rc-self-index li').first().click();
    expect(await picked(page)).toBe('self index 0');
    expect(probe.pageErrors).toEqual([]);
  });

  test("a child in a row's when() branch, and in an inner row, gets the row's new item", async ({ page }) => {
    const probe = await mountProbe(page, 'rowClosures');
    await expect(page.locator('.rc-branch-kid .ckid')).toHaveText(['branch a', 'branch b']);
    await expect(page.locator('.rc-inner-kid .ckid')).toHaveText(['a/k', 'b/k']);
    // The branch stays (on is still true) and the inner row's item is the same object
    await relabel(page);
    await expect(page.locator('.rc-branch-kid .ckid')).toHaveText(['branch c', 'branch b']);
    await expect(page.locator('.rc-inner-kid .ckid')).toHaveText(['c/k', 'b/k']);
    expect(await countingKidCounts(page)).toEqual({
      mount: { 'branch a': 1, 'branch b': 1, 'branch c': 1, 'a/k': 1, 'b/k': 1, 'c/k': 1 },
      destroy: { 'branch a': 1, 'a/k': 1 },
    });
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('event modifiers', () => {
  const log = (page: Page) => page.evaluate(() => (window as any).__probe.eventModifiers.log());
  const clear = (page: Page) => page.evaluate(() => (window as any).__probe.eventModifiers.log([]));

  test('.once runs the handler on the first event only: at component level, in a branch and in each row', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'eventModifiers');
    for (let i = 0; i < 2; i++) {
      await page.locator('.em-once').click();
      await page.locator('.em-branch-once').click();
      await page.locator('.em-rows button').first().click();
      await page.locator('.em-rows button').nth(1).click();
    }
    expect(await log(page)).toEqual(['once', 'branch once', 'row once 1', 'row once 2']);
    expect(probe.pageErrors).toEqual([]);
  });

  test('.capture runs before the handlers of the element clicked', async ({ page }) => {
    await mountProbe(page, 'eventModifiers');
    await page.locator('.em-capture-inner').click();
    expect(await log(page)).toEqual(['outer capture', 'inner', 'outer bubble']);
  });

  test('.passive: the handler cannot prevent the default; .prevent does', async ({ page }) => {
    await mountProbe(page, 'eventModifiers');
    await page.locator('.em-passive').click();
    await page.locator('.em-prevent').click();
    expect(await log(page)).toEqual(['passive prevented false', 'prevented true']);
    // The passive link followed its href; the prevented one did not
    await expect(page).toHaveURL(/#passive$/);
  });

  test('key modifiers run on their keys only, with .once on the first of them', async ({ page }) => {
    await mountProbe(page, 'eventModifiers');
    await page.locator('.em-keys').press('a');
    await page.locator('.em-keys').press('Enter');
    await page.locator('.em-keys').press('Escape');
    await clear(page);
    await page.locator('.em-key-once').press('a');
    await page.locator('.em-key-once').press('Enter');
    await page.locator('.em-key-once').press('Enter');
    expect(await log(page)).toEqual(['enter once']);
  });
});

test.describe('ownership', () => {
  const state = (page: Page) =>
    page.evaluate(() => {
      const w = window as any;
      return { subscribers: w.__probe.ownership.subscribers(), counts: { ...(w.__counts?.ownership ?? {}) } };
    });

  test("a page's computed, effect and listener go with it: five visits leave nothing on the store", async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'ownership');
    await expect(page.locator('.own-count')).toHaveText('3');
    expect(await state(page)).toEqual({ subscribers: 1, counts: { 'effect 3': 1 } });

    for (let visit = 0; visit < 5; visit++) {
      await setProbe(page, 'ownership', 'open', false);
      await expect(page.locator('.own-count')).toHaveCount(0);
      await setProbe(page, 'ownership', 'open', true);
      await expect(page.locator('.own-count')).toHaveText('3');
    }
    // The page on screen holds the one subscription; the five destroyed ones ran their effect's cleanup
    expect(await state(page)).toEqual({ subscribers: 1, counts: { 'effect 3': 6, 'effect cleanup': 5 } });

    // The store changes: only the page on screen follows it
    await setProbe(page, 'ownership', 'products', [1, 2, 3, 4]);
    await expect(page.locator('.own-count')).toHaveText('4');
    expect((await state(page)).counts).toEqual({ 'effect 3': 6, 'effect cleanup': 6, 'effect 4': 1 });

    // The listener onMount added is removed with the page
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await setProbe(page, 'ownership', 'open', false);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    expect(await state(page)).toEqual({
      subscribers: 0,
      counts: { 'effect 3': 6, 'effect cleanup': 7, 'effect 4': 1, 'resize': 1 },
    });
    expect(probe.pageErrors).toEqual([]);
  });
});

test.describe('element refs', () => {
  test('onMount reaches the element through its ref, and a handler reads one', async ({ page }) => {
    const probe = await mountProbe(page, 'elementRefs');
    await expect(page.locator('.refs-input')).toBeFocused();
    await page.locator('.refs-input').fill('changed');
    await page.locator('.refs-copy').click();
    await expect(page.locator('.refs-copied')).toHaveText('changed');
    // The ref is the element itself: a canvas ref has the canvas's API
    expect(
      await page.evaluate(() => {
        const { canvas } = (window as any).__probe.elementRefs;
        return [canvas.el.tagName, typeof canvas.el.getContext, canvas.el.width];
      }),
    ).toEqual(['CANVAS', 'function', 20]);
    expect(probe.pageErrors).toEqual([]);
  });

  test('a ref in a when() branch is its element while the branch shows, and null while it is hidden', async ({
    page,
  }) => {
    const probe = await mountProbe(page, 'elementRefs');
    const panel = () =>
      page.evaluate(() => {
        const el = (window as any).__probe.elementRefs.panel.el as HTMLElement | null;
        return el && { connected: el.isConnected, className: el.className };
      });
    expect(await panel()).toEqual({ connected: true, className: 'refs-panel' });
    await setProbe(page, 'elementRefs', 'open', false);
    await expect(page.locator('.refs-panel')).toHaveCount(0);
    expect(await panel()).toBeNull();
    await setProbe(page, 'elementRefs', 'open', true);
    await expect(page.locator('.refs-panel')).toHaveCount(1);
    expect(await panel()).toEqual({ connected: true, className: 'refs-panel' });
    expect(probe.pageErrors).toEqual([]);
  });
});
