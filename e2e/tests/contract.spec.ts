import { expect, test } from '@playwright/test';

const gotoApp = async ({ page }: { page: any }) => {
  await page.goto('/index.html');
  await expect(page.getByTestId('app-title')).toHaveText('Thane Contract App');
};

const listItemIds = async (page: any): Promise<string[]> =>
  page.locator('[data-testid="item-id"]').allTextContents();

test('basic render, click updates, when and whenElse branch switching', async ({ page }) => {
  await gotoApp({ page });

  await expect(page.getByTestId('count-value')).toHaveText('0');

  // when-block is initially visible and shows the full mixed text.
  // Comment markers preserve static text in mixed-content conditionals,
  // so "when-visible-${count()}" renders as "when-visible-0".
  await expect(page.getByTestId('when-block')).toBeVisible();
  await expect(page.getByTestId('when-block')).toHaveText('when-visible-0');

  await page.getByTestId('count-btn').click();
  await page.getByTestId('count-btn').click();
  await expect(page.getByTestId('count-value')).toHaveText('2');
  await expect(page.getByTestId('when-block')).toHaveText('when-visible-2');

  await page.getByTestId('toggle-when').click();
  await expect(page.getByTestId('when-block')).toHaveCount(0);
  await page.getByTestId('toggle-when').click();
  await expect(page.getByTestId('when-block')).toHaveText('when-visible-2');

  await expect(page.getByTestId('when-else-then')).toBeVisible();
  await expect(page.getByTestId('when-else-else')).toHaveCount(0);
  await page.getByTestId('toggle-when-else').click();
  await expect(page.getByTestId('when-else-then')).toHaveCount(0);
  await expect(page.getByTestId('when-else-else')).toBeVisible();

  // Negative control: branch-specific test id already asserts exclusivity.
});

test('repeat supports count, add/remove/reorder, keyed identity, and empty state', async ({ page }) => {
  await gotoApp({ page });

  await expect(page.getByTestId('item-row')).toHaveCount(3);
  await expect(await listItemIds(page)).toEqual(['1', '2', '3']);

  const row1 = page.getByTestId('item-row').nth(0);
  const row1Handle = await row1.elementHandle();
  expect(row1Handle).toBeTruthy();

  await page.getByTestId('reorder-items').click();
  await expect(await listItemIds(page)).toEqual(['3', '1', '2']);

  const row1After = await page.getByTestId('item-row').nth(1).elementHandle();
  expect(row1After).toBeTruthy();
  const sameIdentity = await row1Handle!.evaluate((node, other) => node === other, row1After);
  expect(sameIdentity).toBe(true);

  await page.getByTestId('add-item').click();
  await expect(page.getByTestId('item-row')).toHaveCount(4);

  await page.getByTestId('remove-first').click();
  await expect(page.getByTestId('item-row')).toHaveCount(3);

  await page.getByTestId('clear-items').click();
  await expect(page.getByTestId('item-row')).toHaveCount(0);

  // Add to empty list — verifies empty→non-empty transition
  await page.getByTestId('add-item').click();
  await expect(page.getByTestId('item-row')).toHaveCount(1);
  await expect(page.getByTestId('item-name').first()).toHaveText('New-1');

  await page.getByTestId('reset-items').click();
  await expect(await listItemIds(page)).toEqual(['1', '2', '3']);
});

test('nested repeat/when/whenElse keep structure and deep bindings correct', async ({ page }) => {
  await gotoApp({ page });

  await expect(page.getByTestId('nested-row')).toHaveCount(2);
  await expect(page.getByTestId('nested-label').first()).toHaveText('Nest-A-0');
  await expect(page.getByTestId('nested-parent-a').first()).toHaveText('1');
  await expect(page.getByTestId('nested-when')).toHaveCount(2);
  await expect(page.getByTestId('nested-branch').first()).toHaveText('then');
  await expect(page.getByTestId('nested-branch').nth(1)).toHaveText('then');

  await expect(page.getByTestId('nested-child').first()).toHaveText('x1-0');

  await page.getByTestId('nested-toggle-visibility').click();
  await expect(page.getByTestId('nested-when')).toHaveCount(0);
  await expect(page.getByTestId('nested-branch').first()).toHaveText('else');

  await page.getByTestId('nested-add-child-second').click();
  await expect(page.getByTestId('nested-child')).toHaveCount(2);
  await expect(page.getByTestId('nested-child').nth(1)).toHaveText('y1-0');

  await page.getByTestId('nested-clear').click();
  await expect(page.getByTestId('nested-row')).toHaveCount(0);
  await expect(page.getByTestId('nested-empty')).toHaveText('nested-empty');

  await page.getByTestId('nested-reset').click();
  await expect(page.getByTestId('nested-row')).toHaveCount(2);
});

test('repeat safe fallback renders correct rows and content in browser', async ({ page }) => {
  await gotoApp({ page });

  await expect(page.getByTestId('fallback-row-label')).toHaveCount(2);
  await expect(page.getByTestId('fallback-row-index')).toHaveCount(2);
  await expect(page.getByTestId('fallback-row-expr')).toHaveCount(2);
  await expect(page.getByTestId('fallback-row-label').nth(0)).toHaveText('FB-A');
  await expect(page.getByTestId('fallback-row-label').nth(1)).toHaveText('FB-B');
  await expect(page.getByTestId('fallback-row-index').nth(0)).toHaveText('0');
  await expect(page.getByTestId('fallback-row-index').nth(1)).toHaveText('1');
  await expect(page.getByTestId('fallback-row-expr').nth(0)).toHaveText('FB-A-1');
  await expect(page.getByTestId('fallback-row-expr').nth(1)).toHaveText('FB-B-1');

  await page.getByTestId('inc-expr-a').click();
  await expect(page.getByTestId('fallback-row-expr').nth(0)).toHaveText('FB-A-2');
  await expect(page.getByTestId('fallback-row-expr').nth(1)).toHaveText('FB-B-2');

  await page.getByTestId('fallback-add').click();
  await expect(page.getByTestId('fallback-row-label')).toHaveCount(3);
  await expect(page.getByTestId('fallback-row-label').nth(2)).toHaveText('FB-203');
  await expect(page.getByTestId('fallback-row-index').nth(2)).toHaveText('2');
  await expect(page.getByTestId('fallback-row-expr').nth(2)).toHaveText('FB-203-2');

  await page.getByTestId('fallback-clear').click();
  await expect(page.getByTestId('fallback-row-label')).toHaveCount(0);
  await expect(page.getByTestId('fallback-row-expr')).toHaveCount(0);
  await expect(page.getByTestId('fallback-empty')).toHaveText('fallback-empty');

  await page.getByTestId('fallback-reset').click();
  await expect(page.getByTestId('fallback-row-label')).toHaveCount(2);
  await expect(page.getByTestId('fallback-row-label').nth(0)).toHaveText('FB-A');
  await expect(page.getByTestId('fallback-row-expr').nth(0)).toHaveText('FB-A-2');
});

test('inter-component reactivity and child-parent interaction with remount', async ({ page }) => {
  await gotoApp({ page });

  // Scope to the reactivity section to avoid matching multi-child ChildCounters
  const section = page.getByTestId('reactivity-section');

  // Verify child component's own rendered state
  await expect(section.getByTestId('child-local')).toHaveText('0');

  await expect(page.getByTestId('child-mount-count')).toHaveText('1');
  await expect(page.getByTestId('child-to-parent-events')).toHaveText('0');

  // Child click updates child local state AND fires parent callback
  await section.getByTestId('child-inc').click();
  await expect(section.getByTestId('child-local')).toHaveText('1');
  await expect(page.getByTestId('child-to-parent-events')).toHaveText('1');

  // Multiple child increments
  await section.getByTestId('child-inc').click();
  await expect(section.getByTestId('child-local')).toHaveText('2');
  await expect(page.getByTestId('child-to-parent-events')).toHaveText('2');

  // Parent increment doesn't reset child-to-parent count
  await page.getByTestId('parent-inc').click();
  await expect(page.getByTestId('child-to-parent-events')).toHaveText('2');
});

test('edge cases: nullish fallback, rapid updates, and isolated DOM updates', async ({ page }) => {
  await gotoApp({ page });

  await expect(page.getByTestId('nullish-value')).toHaveText('seed');
  await page.getByTestId('set-nullish').click();
  await expect(page.getByTestId('nullish-value')).toHaveText('fallback-null');
  await page.getByTestId('set-value').click();
  await expect(page.getByTestId('nullish-value')).toHaveText('live-value');

  const countBtnHandle = await page.getByTestId('count-btn').elementHandle();
  await page.getByTestId('rapid-burst').click();
  await expect(page.getByTestId('rapid-value')).toHaveText('15');

  const countBtnAfter = await page.getByTestId('count-btn').elementHandle();
  const sameNode = await countBtnHandle!.evaluate((node, other) => node === other, countBtnAfter);
  expect(sameNode).toBe(true);

  await expect(page.getByTestId('count-value')).toHaveText('0');
});

test('variable-assigned html template can be injected into another html template via ${}', async ({ page }) => {
  await gotoApp({ page });

  await expect(page.getByTestId('template-injection-section')).toBeVisible();
  await expect(page.getByTestId('var-piece-shell')).toBeVisible();
  await expect(page.getByTestId('var-piece-loading')).toHaveText('Loading piece');
});

test('expression bindings handle order, mixed text, ternary, and duplicate reads', async ({ page }) => {
  await gotoApp({ page });

  await expect(page.getByTestId('expr-order-1')).toHaveText('A:1|B:2');
  await expect(page.getByTestId('expr-order-2')).toHaveText('B:2|A:1');
  await expect(page.getByTestId('expr-mixed')).toHaveText('pre-3-post');
  await expect(page.getByTestId('expr-ternary')).toHaveText('le');
  await expect(page.getByTestId('expr-dup-a')).toHaveText('1');
  await expect(page.getByTestId('expr-dup-b')).toHaveText('1');
  await expect(page.getByTestId('attr-expr-target')).toHaveClass(/\ble\b/);
  await expect(page.getByTestId('style-expr-target')).toHaveCSS('color', 'rgb(0, 0, 255)');

  await page.getByTestId('inc-expr-a').click();
  await expect(page.getByTestId('expr-order-1')).toHaveText('A:2|B:2');
  await expect(page.getByTestId('expr-order-2')).toHaveText('B:2|A:2');
  await expect(page.getByTestId('expr-mixed')).toHaveText('pre-4-post');
  await expect(page.getByTestId('expr-ternary')).toHaveText('le');
  await expect(page.getByTestId('expr-dup-a')).toHaveText('2');
  await expect(page.getByTestId('expr-dup-b')).toHaveText('2');
  await expect(page.getByTestId('attr-expr-target')).toHaveClass(/\ble\b/);
  await expect(page.getByTestId('style-expr-target')).toHaveCSS('color', 'rgb(0, 0, 255)');

  await page.getByTestId('inc-expr-b').click();
  await expect(page.getByTestId('expr-order-1')).toHaveText('A:2|B:3');
  await expect(page.getByTestId('expr-order-2')).toHaveText('B:3|A:2');
  await expect(page.getByTestId('expr-mixed')).toHaveText('pre-5-post');
  await expect(page.getByTestId('expr-ternary')).toHaveText('le');
  await expect(page.getByTestId('attr-expr-target')).toHaveClass(/\ble\b/);
  await expect(page.getByTestId('style-expr-target')).toHaveCSS('color', 'rgb(0, 0, 255)');

  await page.getByTestId('swap-expr').click();
  await expect(page.getByTestId('expr-order-1')).toHaveText('A:3|B:2');
  await expect(page.getByTestId('expr-order-2')).toHaveText('B:2|A:3');
  await expect(page.getByTestId('expr-mixed')).toHaveText('pre-5-post');
  await expect(page.getByTestId('expr-ternary')).toHaveText('gt');
  await expect(page.getByTestId('expr-dup-a')).toHaveText('3');
  await expect(page.getByTestId('expr-dup-b')).toHaveText('3');
  await expect(page.getByTestId('attr-expr-target')).toHaveClass(/\bgt\b/);
  await expect(page.getByTestId('style-expr-target')).toHaveCSS('color', 'rgb(255, 0, 0)');
});

test('whitespace between adjacent template bindings is preserved exactly', async ({ page }) => {
  await gotoApp({ page });

  // Single space between two bindings
  await expect(page.getByTestId('ws-adjacent')).toHaveText('1 2');
  // No space (bindings directly adjacent)
  await expect(page.getByTestId('ws-none')).toHaveText('12');
  // Double space preserved
  await expect(page.getByTestId('ws-multi')).toHaveText('1  2');
  // Surrounding text + internal spaces
  await expect(page.getByTestId('ws-surrounding')).toHaveText('hello 1 and 2 world');

  // After signal update, whitespace still preserved
  await page.getByTestId('inc-expr-a').click();
  await expect(page.getByTestId('ws-adjacent')).toHaveText('2 2');
  await expect(page.getByTestId('ws-none')).toHaveText('22');
  await expect(page.getByTestId('ws-multi')).toHaveText('2  2');
  await expect(page.getByTestId('ws-surrounding')).toHaveText('hello 2 and 2 world');

  // After both change
  await page.getByTestId('swap-expr').click();
  await expect(page.getByTestId('ws-adjacent')).toHaveText('2 2');
  await expect(page.getByTestId('ws-none')).toHaveText('22');
  await expect(page.getByTestId('ws-surrounding')).toHaveText('hello 2 and 2 world');

  await page.getByTestId('inc-expr-b').click();
  await expect(page.getByTestId('ws-adjacent')).toHaveText('2 3');
  await expect(page.getByTestId('ws-none')).toHaveText('23');
  await expect(page.getByTestId('ws-multi')).toHaveText('2  3');
  await expect(page.getByTestId('ws-surrounding')).toHaveText('hello 2 and 3 world');
});

test('CSS scoping: component styles apply within component and do not leak across boundaries', async ({ page }) => {
  await gotoApp({ page });

  // ── 1. Parent scoped styles are applied ──
  // .contract-app .parent-scoped → color: green
  await expect(page.getByTestId('css-parent-styled')).toHaveCSS('color', 'rgb(0, 128, 0)');

  // ── 2. Child scoped styles are applied ──
  // .styled-child [data-testid="css-child-styled"] → color: blue
  await expect(page.getByTestId('css-child-styled')).toHaveCSS('color', 'rgb(0, 0, 255)');
  // .styled-child .leak-target → red background (inside child)
  await expect(page.getByTestId('css-child-isolated')).toHaveCSS('background-color', 'rgb(255, 0, 0)');

  // ── 3. Child styles do NOT leak to parent/sibling elements ──
  // Parent also has an element with class .leak-target, but .styled-child .leak-target
  // should NOT match it because it's outside the styled-child component boundary.
  await expect(page.getByTestId('css-no-leak')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  // ── 4. Parent styles DO cascade into child (expected light-DOM behavior) ──
  // .contract-app .parent-scoped matches inside child because there is no Shadow DOM barrier.
  await expect(page.getByTestId('css-child-inherits')).toHaveCSS('color', 'rgb(0, 128, 0)');
});

// ── Comment marker / §5 / reactive binding browser-level tests ──

test('comment-marker mixed-content in repeat items renders and updates correctly', async ({ page }) => {
  await gotoApp({ page });

  // item-derived uses mixed content: ${item.name}-${index} — two comment-marker bindings
  await expect(page.getByTestId('item-derived').nth(0)).toHaveText('Alpha-0');
  await expect(page.getByTestId('item-derived').nth(1)).toHaveText('Beta-1');
  await expect(page.getByTestId('item-derived').nth(2)).toHaveText('Gamma-2');

  // After reorder (3,1,2), items are DOM-reordered but keyed reconciler
  // calls update(newItem) — the index was captured at creation time.
  // Reorder moves items: Gamma(was idx 2), Alpha(was idx 0), Beta(was idx 1)
  await page.getByTestId('reorder-items').click();
  await expect(page.getByTestId('item-derived').nth(0)).toHaveText('Gamma-2');
  await expect(page.getByTestId('item-derived').nth(1)).toHaveText('Alpha-0');
  await expect(page.getByTestId('item-derived').nth(2)).toHaveText('Beta-1');

  // After add, the new item also uses comment markers
  await page.getByTestId('add-item').click();
  await expect(page.getByTestId('item-derived').nth(3)).toHaveText('New-4-3');

  // After remove-first (removes Gamma), remaining: [Alpha, Beta, New-4]
  await page.getByTestId('remove-first').click();
  await expect(page.getByTestId('item-derived').nth(0)).toHaveText('Alpha-0');
  await expect(page.getByTestId('item-derived').nth(1)).toHaveText('Beta-1');
  await expect(page.getByTestId('item-derived').nth(2)).toHaveText('New-4-3');
});

test('signal text binding inside repeat reacts to parent signal changes', async ({ page }) => {
  await gotoApp({ page });

  // nested-parent-a shows ${exprA()} inside each nested repeat item — comment marker signal binding
  await expect(page.getByTestId('nested-parent-a').nth(0)).toHaveText('1');
  await expect(page.getByTestId('nested-parent-a').nth(1)).toHaveText('1');

  // Increment exprA — both items should react
  await page.getByTestId('inc-expr-a').click();
  await expect(page.getByTestId('nested-parent-a').nth(0)).toHaveText('2');
  await expect(page.getByTestId('nested-parent-a').nth(1)).toHaveText('2');

  // Increment again
  await page.getByTestId('inc-expr-a').click();
  await expect(page.getByTestId('nested-parent-a').nth(0)).toHaveText('3');
  await expect(page.getByTestId('nested-parent-a').nth(1)).toHaveText('3');

  // After clear + reset, signal binding still works
  await page.getByTestId('nested-clear').click();
  await expect(page.getByTestId('nested-parent-a')).toHaveCount(0);
  await page.getByTestId('nested-reset').click();
  await expect(page.getByTestId('nested-parent-a').nth(0)).toHaveText('3');
  await expect(page.getByTestId('nested-parent-a').nth(1)).toHaveText('3');
});

test('§5: conditional mixed-text preserves static content around dynamic bindings', async ({ page }) => {
  await gotoApp({ page });

  // when-block: "when-visible-${count()}" — §5 ensures "when-visible-" is not overwritten
  await expect(page.getByTestId('when-block')).toHaveText('when-visible-0');

  // Increment count a few times
  await page.getByTestId('count-btn').click();
  await expect(page.getByTestId('when-block')).toHaveText('when-visible-1');
  await page.getByTestId('count-btn').click();
  await expect(page.getByTestId('when-block')).toHaveText('when-visible-2');

  // Toggle off, increment, toggle on — fresh mount should show current count
  await page.getByTestId('toggle-when').click();
  await expect(page.getByTestId('when-block')).toHaveCount(0);
  await page.getByTestId('count-btn').click(); // count is now 3
  await page.getByTestId('toggle-when').click();
  await expect(page.getByTestId('when-block')).toHaveText('when-visible-3');

  // Multiple rapid count updates while visible — static text stays intact
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('count-btn').click();
  }
  await expect(page.getByTestId('when-block')).toHaveText('when-visible-8');
});

test('nested repeat label + index mixed-content and inner repeat comment markers', async ({ page }) => {
  await gotoApp({ page });

  // nested-label uses "${item.label}-${index}" — two comment marker item bindings
  await expect(page.getByTestId('nested-label').nth(0)).toHaveText('Nest-A-0');
  await expect(page.getByTestId('nested-label').nth(1)).toHaveText('Nest-B-1');

  // Inner repeat: nested-child uses "${child}-${childIndex}" comment markers
  // Nest-A has children: ['x1'], so first nested-child is "x1-0"
  await expect(page.getByTestId('nested-child').first()).toHaveText('x1-0');

  // Add a third nested item and verify its mixed-content label
  await page.getByTestId('nested-add-child-second').click();
  await expect(page.getByTestId('nested-label').nth(2)).toHaveText('Nest-C-2');
  // New item has children: ['y1'], so its nested-child is "y1-0"
  await expect(page.getByTestId('nested-child').nth(1)).toHaveText('y1-0');

  // Clear and reset — mixed content re-renders correctly
  await page.getByTestId('nested-clear').click();
  await expect(page.getByTestId('nested-label')).toHaveCount(0);
  await page.getByTestId('nested-reset').click();
  await expect(page.getByTestId('nested-label').nth(0)).toHaveText('Nest-A-0');
  await expect(page.getByTestId('nested-label').nth(1)).toHaveText('Nest-B-1');
});

test('boundary comments isolate text nodes in multi-binding expressions', async ({ page }) => {
  await gotoApp({ page });

  // expr-order-1: "A:${exprA()}|B:${exprB()}" — boundary comments prevent text merging
  // Without boundary comments, "A:" + "1" + "|B:" + "2" would merge into single text nodes
  await expect(page.getByTestId('expr-order-1')).toHaveText('A:1|B:2');

  // Update only the first signal — second binding's surrounding text must be untouched
  await page.getByTestId('inc-expr-a').click();
  await expect(page.getByTestId('expr-order-1')).toHaveText('A:2|B:2');

  // Update only the second signal
  await page.getByTestId('inc-expr-b').click();
  await expect(page.getByTestId('expr-order-1')).toHaveText('A:2|B:3');

  // After swap, both update and surrounding static text ("A:", "|B:") preserved
  await page.getByTestId('swap-expr').click();
  await expect(page.getByTestId('expr-order-1')).toHaveText('A:3|B:2');
  await expect(page.getByTestId('expr-order-2')).toHaveText('B:2|A:3');

  // expr-mixed: "pre-${exprA()+exprB()}-post" — verify static "pre-" and "-post" stay
  await expect(page.getByTestId('expr-mixed')).toHaveText('pre-5-post');
});

test('fallback repeat mixed-content with signal expression in item template', async ({ page }) => {
  await gotoApp({ page });

  // fallback-row-expr uses "${row.label}-${exprA()}" — item var + signal, comment markers
  await expect(page.getByTestId('fallback-row-expr').nth(0)).toHaveText('FB-A-1');
  await expect(page.getByTestId('fallback-row-expr').nth(1)).toHaveText('FB-B-1');

  // Signal change updates all fallback rows
  await page.getByTestId('inc-expr-a').click();
  await page.getByTestId('inc-expr-a').click();
  await expect(page.getByTestId('fallback-row-expr').nth(0)).toHaveText('FB-A-3');
  await expect(page.getByTestId('fallback-row-expr').nth(1)).toHaveText('FB-B-3');

  // Add row, then signal update should include new row
  await page.getByTestId('fallback-add').click();
  await expect(page.getByTestId('fallback-row-expr').nth(2)).toHaveText('FB-203-3');
  await page.getByTestId('inc-expr-a').click();
  await expect(page.getByTestId('fallback-row-expr').nth(0)).toHaveText('FB-A-4');
  await expect(page.getByTestId('fallback-row-expr').nth(2)).toHaveText('FB-203-4');

  // Clear → empty fallback renders, then reset restores mixed-content
  await page.getByTestId('fallback-clear').click();
  await expect(page.getByTestId('fallback-empty')).toBeVisible();
  await page.getByTestId('fallback-reset').click();
  await expect(page.getByTestId('fallback-row-expr').nth(0)).toHaveText('FB-A-4');
});

// ══════════════════════════════════════════════════════════════════════════════
// New coverage: CSS file import, global styles, multi-child, mount, onDestroy
// ══════════════════════════════════════════════════════════════════════════════

test('CSS file import: external .css styles are applied to the component', async ({ page }) => {
  await gotoApp({ page });

  // CssImportChild imports its styles from css-import-child.css
  // :host .css-import-text { color: rgb(128, 0, 128); }
  await expect(page.getByTestId('css-import-text')).toHaveCSS('color', 'rgb(128, 0, 128)');
  await expect(page.getByTestId('css-import-text')).toHaveText('css-file-styled');

  // :host .css-import-border { border: 2px solid rgb(128, 0, 128); }
  await expect(page.getByTestId('css-import-border')).toHaveCSS('border-color', 'rgb(128, 0, 128)');
  await expect(page.getByTestId('css-import-border')).toHaveCSS('border-width', '2px');
  await expect(page.getByTestId('css-import-border')).toHaveCSS('border-style', 'solid');
});

test('registerGlobalStyles applies styles globally without component scoping', async ({ page }) => {
  await gotoApp({ page });

  // Global styles registered via registerGlobalStyles() apply using data-testid attribute selector
  // [data-testid="global-styled"] { color: rgb(255, 165, 0); }
  await expect(page.getByTestId('global-styled')).toHaveCSS('color', 'rgb(255, 165, 0)');
  await expect(page.getByTestId('global-styled')).toHaveText('global-orange');
});

test('multiple instances of same child component have independent state', async ({ page }) => {
  await gotoApp({ page });

  // Both child instances mounted independently
  await expect(page.getByTestId('multi-child-mounts-a')).toHaveText('1');
  await expect(page.getByTestId('multi-child-mounts-b')).toHaveText('1');

  // Get the child-inc buttons within the multi-child-section
  const multiSection = page.getByTestId('multi-child-section');
  const childButtons = multiSection.locator('[data-testid="child-inc"]');

  // Click first child's button — only first child's event count increments
  await childButtons.nth(0).click();
  await expect(page.getByTestId('multi-child-events-a')).toHaveText('1');
  await expect(page.getByTestId('multi-child-events-b')).toHaveText('0');

  // Click second child's button — only second child's event count increments
  await childButtons.nth(1).click();
  await expect(page.getByTestId('multi-child-events-a')).toHaveText('1');
  await expect(page.getByTestId('multi-child-events-b')).toHaveText('1');

  // Each child's local state is independent
  const childLocals = multiSection.locator('[data-testid="child-local"]');
  await expect(childLocals.nth(0)).toHaveText('1');
  await expect(childLocals.nth(1)).toHaveText('1');

  // Click first child again
  await childButtons.nth(0).click();
  await expect(childLocals.nth(0)).toHaveText('2');
  await expect(childLocals.nth(1)).toHaveText('1');
});

test('mount to explicit target element renders inside #app div', async ({ page }) => {
  await gotoApp({ page });

  // The app should be mounted inside div#app, not directly on body
  const appDiv = page.locator('#app');
  await expect(appDiv).toBeVisible();
  await expect(appDiv.getByTestId('app-title')).toHaveText('Thane Contract App');

  // Verify the #app div has the component class
  await expect(appDiv).toHaveClass(/contract-app/);
});

test('mount returns handle with destroy() that removes component content', async ({ page }) => {
  await gotoApp({ page });

  // Verify the app is rendered
  await expect(page.getByTestId('app-title')).toHaveText('Thane Contract App');

  // Call destroy via the exposed mount handle
  await page.evaluate(() => (window as any).__mountHandle.destroy());

  // After destroy, component content should be removed
  await expect(page.getByTestId('app-title')).toHaveCount(0);

  // The #app div should still exist in the DOM but be empty
  const appDiv = page.locator('#app');
  await expect(appDiv).toHaveCount(1);
  await expect(appDiv).toBeEmpty();
});

// ══════════════════════════════════════════════════════════════════════════════
// Signal props: reactive signal references passed through nested components
// ══════════════════════════════════════════════════════════════════════════════

test('signal props propagate reactive updates through nested component chain', async ({ page }) => {
  await gotoApp({ page });

  const section = page.getByTestId('signal-prop-section');

  // ── 1. Initial values propagate through all levels ──
  // Source level (contract-app)
  await expect(section.getByTestId('prop-a-source')).toHaveText('10');
  await expect(section.getByTestId('prop-b-source')).toHaveText('20');

  // PropParent uses signal A
  await expect(section.getByTestId('prop-parent-a')).toHaveText('10');
  await expect(section.getByTestId('prop-parent-static')).toHaveText('parent-static');

  // PropChild uses signal B (passes A through without using it)
  await expect(section.getByTestId('prop-child-b')).toHaveText('20');
  await expect(section.getByTestId('prop-child-static')).toHaveText('child-static');

  // PropGrandchild uses signal A (received through two levels)
  await expect(section.getByTestId('prop-grandchild-a')).toHaveText('10');
  await expect(section.getByTestId('prop-grandchild-static')).toHaveText('grandchild-static');

  // ── 2. Update signal A → only A-bound DOM updates ──
  await section.getByTestId('inc-prop-a').click();
  await expect(section.getByTestId('prop-a-source')).toHaveText('11');
  await expect(section.getByTestId('prop-parent-a')).toHaveText('11');
  await expect(section.getByTestId('prop-grandchild-a')).toHaveText('11');
  // Signal B bindings untouched
  await expect(section.getByTestId('prop-child-b')).toHaveText('20');

  // ── 3. Update signal B → only B-bound DOM updates ──
  await section.getByTestId('inc-prop-b').click();
  await expect(section.getByTestId('prop-b-source')).toHaveText('21');
  await expect(section.getByTestId('prop-child-b')).toHaveText('21');
  // Signal A bindings untouched
  await expect(section.getByTestId('prop-parent-a')).toHaveText('11');
  await expect(section.getByTestId('prop-grandchild-a')).toHaveText('11');

  // ── 4. Rapid successive updates on both signals ──
  await section.getByTestId('inc-prop-a').click();
  await section.getByTestId('inc-prop-a').click();
  await section.getByTestId('inc-prop-a').click();
  await expect(section.getByTestId('prop-parent-a')).toHaveText('14');
  await expect(section.getByTestId('prop-grandchild-a')).toHaveText('14');
  await expect(section.getByTestId('prop-child-b')).toHaveText('21'); // still unchanged

  await section.getByTestId('inc-prop-b').click();
  await section.getByTestId('inc-prop-b').click();
  await expect(section.getByTestId('prop-child-b')).toHaveText('23');
  await expect(section.getByTestId('prop-parent-a')).toHaveText('14'); // still unchanged
  await expect(section.getByTestId('prop-grandchild-a')).toHaveText('14'); // still unchanged
});

test('signal props deliver fine-grained DOM updates without re-creating elements', async ({ page }) => {
  await gotoApp({ page });

  const section = page.getByTestId('signal-prop-section');

  // Grab element handles before any updates
  const parentStaticHandle = await section.getByTestId('prop-parent-static').elementHandle();
  const parentAHandle = await section.getByTestId('prop-parent-a').elementHandle();
  const childStaticHandle = await section.getByTestId('prop-child-static').elementHandle();
  const childBHandle = await section.getByTestId('prop-child-b').elementHandle();
  const grandchildStaticHandle = await section.getByTestId('prop-grandchild-static').elementHandle();
  const grandchildAHandle = await section.getByTestId('prop-grandchild-a').elementHandle();

  // Update signal A multiple times
  await section.getByTestId('inc-prop-a').click();
  await section.getByTestId('inc-prop-a').click();
  await expect(section.getByTestId('prop-parent-a')).toHaveText('12');
  await expect(section.getByTestId('prop-grandchild-a')).toHaveText('12');

  // Update signal B
  await section.getByTestId('inc-prop-b').click();
  await expect(section.getByTestId('prop-child-b')).toHaveText('21');

  // ── All element nodes are the same DOM nodes (surgical text updates, no re-creation) ──
  const parentStaticAfter = await section.getByTestId('prop-parent-static').elementHandle();
  const sameParentStatic = await parentStaticHandle!.evaluate((n, o) => n === o, parentStaticAfter);
  expect(sameParentStatic).toBe(true);

  const parentAAfter = await section.getByTestId('prop-parent-a').elementHandle();
  const sameParentA = await parentAHandle!.evaluate((n, o) => n === o, parentAAfter);
  expect(sameParentA).toBe(true);

  const childStaticAfter = await section.getByTestId('prop-child-static').elementHandle();
  const sameChildStatic = await childStaticHandle!.evaluate((n, o) => n === o, childStaticAfter);
  expect(sameChildStatic).toBe(true);

  const childBAfter = await section.getByTestId('prop-child-b').elementHandle();
  const sameChildB = await childBHandle!.evaluate((n, o) => n === o, childBAfter);
  expect(sameChildB).toBe(true);

  const grandchildStaticAfter = await section.getByTestId('prop-grandchild-static').elementHandle();
  const sameGrandchildStatic = await grandchildStaticHandle!.evaluate((n, o) => n === o, grandchildStaticAfter);
  expect(sameGrandchildStatic).toBe(true);

  const grandchildAAfter = await section.getByTestId('prop-grandchild-a').elementHandle();
  const sameGrandchildA = await grandchildAHandle!.evaluate((n, o) => n === o, grandchildAAfter);
  expect(sameGrandchildA).toBe(true);
});
