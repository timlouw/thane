import { expect, test } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════════
// Child Destroy / Memory Leak Regression Tests
//
// These tests verify that destroying a parent component properly
// propagates cleanup to child components at all nesting levels:
//   - Top-level child mounts (concise arrow + block body)
//   - Children inside when() conditionals
//   - Nested children (parent → child → grandchild)
//   - Signal subscription cleanup
//   - Interval/timer cleanup via onDestroy
//
// The tests use DestroyTracker components that register side-effects
// on window globals, allowing Playwright to observe cleanup behavior.
// ═══════════════════════════════════════════════════════════════════════

const gotoApp = async ({ page }: { page: any }) => {
  await page.goto('/index.html');
  await expect(page.getByTestId('app-title')).toHaveText('Thane Contract App');
};

// Helper: reset all destroy tracking globals
const resetTrackers = async (page: any) => {
  await page.evaluate(() => {
    const win = window as any;
    win.__destroyLog = [];
    win.__activeTrackers = new Set();
    win.__intervalTicks = {};
  });
};

// Helper: get the destroy log (list of tracker IDs that had onDestroy called)
const getDestroyLog = async (page: any): Promise<string[]> => {
  return page.evaluate(() => (window as any).__destroyLog || []);
};

// Helper: get active trackers (set of tracker IDs that are still alive)
const getActiveTrackers = async (page: any): Promise<string[]> => {
  return page.evaluate(() => [...((window as any).__activeTrackers || [])]);
};

// Helper: get interval tick counts for a tracker
const getIntervalTicks = async (page: any, trackerId: string): Promise<number> => {
  return page.evaluate((id: string) => ((window as any).__intervalTicks || {})[id] || 0, trackerId);
};

// ─── Test 1: Simple parent → child destroy propagation ───────────────

test('destroying a simple parent fires child onDestroy', async ({ page }) => {
  await gotoApp({ page });
  await resetTrackers(page);

  // Mount the simple parent (contains one DestroyTracker child)
  const handle = await page.evaluate(() => {
    const h = (window as any).__mountSimple();
    // Store handle globally so we can destroy it later
    (window as any).__testHandle = h;
    return !!h;
  });
  expect(handle).toBe(true);

  // Verify child is alive
  const activeBeforeDestroy = await getActiveTrackers(page);
  expect(activeBeforeDestroy).toContain('simple-child');

  // Destroy the parent
  await page.evaluate(() => (window as any).__testHandle.destroy());

  // Verify child's onDestroy was called
  const log = await getDestroyLog(page);
  expect(log).toContain('simple-child');

  // Verify tracker is no longer active
  const activeAfterDestroy = await getActiveTrackers(page);
  expect(activeAfterDestroy).not.toContain('simple-child');
});

// ─── Test 2: Nested parent → child → grandchild destroy ─────────────

test('destroying a parent recursively destroys grandchild components', async ({ page }) => {
  await gotoApp({ page });
  await resetTrackers(page);

  // Mount the nested parent (contains direct DestroyTracker + DestroyGrandchild → DestroyTracker)
  await page.evaluate(() => {
    (window as any).__testHandle = (window as any).__mountNested();
  });

  // Verify both trackers are alive
  const activeBefore = await getActiveTrackers(page);
  expect(activeBefore).toContain('nested-direct');
  expect(activeBefore).toContain('grandchild-tracker');
  expect(activeBefore).toHaveLength(2);

  // Destroy the parent
  await page.evaluate(() => (window as any).__testHandle.destroy());

  // Both onDestroy callbacks should have fired
  const log = await getDestroyLog(page);
  expect(log).toContain('nested-direct');
  expect(log).toContain('grandchild-tracker');
  expect(log).toHaveLength(2);

  // No active trackers remain
  const activeAfter = await getActiveTrackers(page);
  expect(activeAfter).toHaveLength(0);
});

// ─── Test 3: Interval cleanup on destroy ─────────────────────────────

test('child intervals are cleared when parent is destroyed', async ({ page }) => {
  await gotoApp({ page });
  await resetTrackers(page);

  // Mount the simple parent
  await page.evaluate(() => {
    (window as any).__testHandle = (window as any).__mountSimple();
  });

  // Wait for the interval to tick a few times (interval is 50ms)
  await page.waitForTimeout(200);
  const ticksBefore = await getIntervalTicks(page, 'simple-child');
  expect(ticksBefore).toBeGreaterThan(0);

  // Destroy the parent
  await page.evaluate(() => (window as any).__testHandle.destroy());

  // Record ticks right after destroy
  const ticksAtDestroy = await getIntervalTicks(page, 'simple-child');

  // Wait a bit more — if the interval was cleared, ticks should NOT increase
  await page.waitForTimeout(200);
  const ticksAfterWait = await getIntervalTicks(page, 'simple-child');

  // Ticks should be the same (interval was cleared by onDestroy)
  expect(ticksAfterWait).toBe(ticksAtDestroy);
});

// ─── Test 4: Conditional hide cleans up child ────────────────────────

test('hiding a when() conditional cleans up child component', async ({ page }) => {
  await gotoApp({ page });
  await resetTrackers(page);

  // Mount the conditional parent (child visible by default)
  await page.evaluate(() => {
    (window as any).__testHandle = (window as any).__mountConditional();
  });

  // Verify child is alive
  const activeBefore = await getActiveTrackers(page);
  expect(activeBefore).toContain('cond-child');

  // Toggle the conditional to hide the child
  await page.getByTestId('destroy-cond-toggle').click();
  await expect(page.getByTestId('destroy-cond-status')).toHaveText('hidden');

  // Child's onDestroy should have been called (conditional cleanup fires)
  const log = await getDestroyLog(page);
  expect(log).toContain('cond-child');

  // Tracker is no longer active
  const activeAfter = await getActiveTrackers(page);
  expect(activeAfter).not.toContain('cond-child');
});

// ─── Test 5: Conditional child interval cleanup ──────────────────────

test('hiding a conditional stops child intervals', async ({ page }) => {
  await gotoApp({ page });
  await resetTrackers(page);

  // Mount conditional parent
  await page.evaluate(() => {
    (window as any).__testHandle = (window as any).__mountConditional();
  });

  // Wait for interval to tick
  await page.waitForTimeout(200);
  const ticksBefore = await getIntervalTicks(page, 'cond-child');
  expect(ticksBefore).toBeGreaterThan(0);

  // Hide the conditional
  await page.getByTestId('destroy-cond-toggle').click();

  // Record ticks at hide
  const ticksAtHide = await getIntervalTicks(page, 'cond-child');

  // Wait more — ticks should not increase
  await page.waitForTimeout(200);
  const ticksAfterWait = await getIntervalTicks(page, 'cond-child');
  expect(ticksAfterWait).toBe(ticksAtHide);
});

// ─── Test 6: Multiple mount/destroy cycles don't leak ────────────────

test('repeated mount/destroy cycles do not accumulate active trackers', async ({ page }) => {
  await gotoApp({ page });
  await resetTrackers(page);

  // Perform 5 mount+destroy cycles
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      const h = (window as any).__mountSimple();
      h.destroy();
    });
  }

  // All 5 children should have been destroyed
  const log = await getDestroyLog(page);
  expect(log.filter((id: string) => id === 'simple-child')).toHaveLength(5);

  // No active trackers remain
  const active = await getActiveTrackers(page);
  expect(active).toHaveLength(0);
});

// ─── Test 7: Multiple nested mount/destroy cycles don't leak ─────────

test('repeated nested mount/destroy cycles clean up all descendants', async ({ page }) => {
  await gotoApp({ page });
  await resetTrackers(page);

  // Perform 3 mount+destroy cycles of the nested parent
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const h = (window as any).__mountNested();
      h.destroy();
    });
  }

  // 3 cycles × 2 trackers = 6 destroy calls
  const log = await getDestroyLog(page);
  expect(log.filter((id: string) => id === 'nested-direct')).toHaveLength(3);
  expect(log.filter((id: string) => id === 'grandchild-tracker')).toHaveLength(3);
  expect(log).toHaveLength(6);

  // Nothing active
  const active = await getActiveTrackers(page);
  expect(active).toHaveLength(0);
});

// ─── Test 8: Destroying parent also destroys conditional child ───────

test('destroying conditional parent fires cleanup even if child is visible', async ({ page }) => {
  await gotoApp({ page });
  await resetTrackers(page);

  // Mount conditional parent (child is visible by default)
  await page.evaluate(() => {
    (window as any).__testHandle = (window as any).__mountConditional();
  });

  // Verify child is alive
  const activeBefore = await getActiveTrackers(page);
  expect(activeBefore).toContain('cond-child');

  // Destroy the parent directly (without toggling the conditional)
  await page.evaluate(() => (window as any).__testHandle.destroy());

  // Child should still be cleaned up
  const log = await getDestroyLog(page);
  expect(log).toContain('cond-child');

  const activeAfter = await getActiveTrackers(page);
  expect(activeAfter).toHaveLength(0);
});

// ─── Test 9: Interval cleanup verified across nested destroy ─────────

test('nested destroy stops all descendant intervals', async ({ page }) => {
  await gotoApp({ page });
  await resetTrackers(page);

  // Mount nested parent
  await page.evaluate(() => {
    (window as any).__testHandle = (window as any).__mountNested();
  });

  // Wait for intervals to tick
  await page.waitForTimeout(200);
  const directTicks = await getIntervalTicks(page, 'nested-direct');
  const grandchildTicks = await getIntervalTicks(page, 'grandchild-tracker');
  expect(directTicks).toBeGreaterThan(0);
  expect(grandchildTicks).toBeGreaterThan(0);

  // Destroy the parent
  await page.evaluate(() => (window as any).__testHandle.destroy());

  // Record ticks at destroy
  const directTicksAtDestroy = await getIntervalTicks(page, 'nested-direct');
  const grandchildTicksAtDestroy = await getIntervalTicks(page, 'grandchild-tracker');

  // Wait more — neither interval should tick further
  await page.waitForTimeout(200);
  expect(await getIntervalTicks(page, 'nested-direct')).toBe(directTicksAtDestroy);
  expect(await getIntervalTicks(page, 'grandchild-tracker')).toBe(grandchildTicksAtDestroy);
});
