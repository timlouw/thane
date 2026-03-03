import { expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

const goto = async (page: any, path = '/') => {
  await page.goto(path);
  await expect(page.getByTestId('shell-header')).toBeVisible();
};

// ─────────────────────────────────────────────────────────────
//  1. Basic Rendering
// ─────────────────────────────────────────────────────────────

test.describe('1. Basic Rendering', () => {
  test('shell renders with header, nav, outlet, and footer', async ({ page }) => {
    await goto(page, '/');
    await expect(page.getByTestId('app-title')).toHaveText('Router E2E App');
    await expect(page.getByTestId('nav')).toBeVisible();
    await expect(page.getByTestId('shell-footer')).toHaveText('Footer');
  });

  test('home page renders on initial load at /', async ({ page }) => {
    await goto(page, '/');
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.getByTestId('page-title')).toHaveText('Home');
  });

  test('about page renders when navigating to /about', async ({ page }) => {
    await goto(page, '/about');
    await expect(page.getByTestId('about-page')).toBeVisible();
    await expect(page.getByTestId('page-title')).toHaveText('About');
    await expect(page.getByTestId('about-text')).toHaveText('This is the about page.');
  });

  test('document title is set from route config', async ({ page }) => {
    await goto(page, '/');
    await expect(page).toHaveTitle('Home');

    await goto(page, '/about');
    await expect(page).toHaveTitle('About');
  });
});

// ─────────────────────────────────────────────────────────────
//  2. Client-Side Navigation
// ─────────────────────────────────────────────────────────────

test.describe('2. Client-Side Navigation', () => {
  test('clicking nav links navigates without full page reload', async ({ page }) => {
    await goto(page, '/');
    await expect(page.getByTestId('home-page')).toBeVisible();

    // Navigate to About via nav link
    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();
    await expect(page.getByTestId('home-page')).toHaveCount(0);

    // Navigate to Home via nav link
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.getByTestId('about-page')).toHaveCount(0);
  });

  test('shell persists during client-side navigation', async ({ page }) => {
    await goto(page, '/');
    const headerHandle = await page.getByTestId('shell-header').elementHandle();
    expect(headerHandle).toBeTruthy();

    // Navigate to about
    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();

    // Verify shell header is the same DOM node (not re-rendered)
    const headerAfter = await page.getByTestId('shell-header').elementHandle();
    const sameNode = await headerHandle!.evaluate((node, other) => node === other, headerAfter);
    expect(sameNode).toBe(true);
  });

  test('navigate to user page and back', async ({ page }) => {
    await goto(page, '/');
    await page.getByTestId('nav-user').click();
    await expect(page.getByTestId('user-page')).toBeVisible();

    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-page')).toBeVisible();
  });

  test('browser back/forward works', async ({ page }) => {
    await goto(page, '/');
    await expect(page.getByTestId('home-page')).toBeVisible();

    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('home-page')).toBeVisible();

    await page.goForward();
    await expect(page.getByTestId('about-page')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
//  3. Route Parameters
// ─────────────────────────────────────────────────────────────

test.describe('3. Route Parameters', () => {
  test('route param :id is extracted and displayed', async ({ page }) => {
    await goto(page, '/users/42');
    await expect(page.getByTestId('user-page')).toBeVisible();
    await expect(page.getByTestId('user-id')).toHaveText('42');
  });

  test('navigating to different user IDs updates the param', async ({ page }) => {
    await goto(page, '/users/42');
    await expect(page.getByTestId('user-id')).toHaveText('42');

    // Navigate to a different user via programmatic navigate
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-page')).toBeVisible();

    await goto(page, '/users/99');
    await expect(page.getByTestId('user-id')).toHaveText('99');
  });

  test('string param values work', async ({ page }) => {
    await goto(page, '/users/alice');
    await expect(page.getByTestId('user-id')).toHaveText('alice');
  });
});

// ─────────────────────────────────────────────────────────────
//  4. 404 / Not Found
// ─────────────────────────────────────────────────────────────

test.describe('4. Not Found', () => {
  test('unknown path renders the not-found page', async ({ page }) => {
    await goto(page, '/nonexistent');
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByTestId('not-found-text')).toHaveText('The page you requested does not exist.');
  });

  test('deeply nested unknown path renders not-found', async ({ page }) => {
    await goto(page, '/a/b/c/d');
    await expect(page.getByTestId('not-found-page')).toBeVisible();
  });

  test('document title is set for not-found route', async ({ page }) => {
    await goto(page, '/xyz');
    await expect(page).toHaveTitle('404 — Not Found');
  });
});

// ─────────────────────────────────────────────────────────────
//  5. Shared State Between Pages
// ─────────────────────────────────────────────────────────────

test.describe('5. Shared State', () => {
  test('visit count increments across navigations', async ({ page }) => {
    await goto(page, '/');
    // After home loads: visitCount = 1
    await expect(page.getByTestId('home-visit-count')).toHaveText('1');

    // Navigate to about: visitCount = 2
    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();
    await expect(page.getByTestId('about-visit-count')).toHaveText('2');

    // Navigate to user: visitCount = 3
    await page.getByTestId('nav-user').click();
    await expect(page.getByTestId('user-page')).toBeVisible();
    await expect(page.getByTestId('user-visit-count')).toHaveText('3');

    // Back to home: visitCount = 4
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.getByTestId('home-visit-count')).toHaveText('4');
  });

  test('shared message persists across navigations', async ({ page }) => {
    await goto(page, '/');
    // Initial state
    await expect(page.getByTestId('shell-message')).toHaveText('initial');

    // Set message from home page
    await page.getByTestId('home-set-message').click();
    await expect(page.getByTestId('shell-message')).toHaveText('hello from home');

    // Navigate to about — message should persist in shell
    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();
    await expect(page.getByTestId('shell-message')).toHaveText('hello from home');
    await expect(page.getByTestId('about-shared-message')).toHaveText('hello from home');

    // Set message from about page
    await page.getByTestId('about-set-message').click();
    await expect(page.getByTestId('shell-message')).toHaveText('hello from about');

    // Navigate back to home — message should still reflect last change
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.getByTestId('shell-message')).toHaveText('hello from about');
  });

  test('shell displays live visit count from shared signal', async ({ page }) => {
    await goto(page, '/');
    await expect(page.getByTestId('shell-visit-count')).toHaveText('1');

    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();
    await expect(page.getByTestId('shell-visit-count')).toHaveText('2');
  });
});

// ─────────────────────────────────────────────────────────────
//  6. Page-Local State
// ─────────────────────────────────────────────────────────────

test.describe('6. Page-Local State', () => {
  test('page-local state resets on navigation (fresh component instance)', async ({ page }) => {
    await goto(page, '/');
    await expect(page.getByTestId('home-local-count')).toHaveText('0');

    // Increment local count
    await page.getByTestId('home-increment').click();
    await page.getByTestId('home-increment').click();
    await expect(page.getByTestId('home-local-count')).toHaveText('2');

    // Navigate away and back
    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();

    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-page')).toBeVisible();

    // Local state should be reset to 0 (fresh component instance)
    await expect(page.getByTestId('home-local-count')).toHaveText('0');
  });
});

// ─────────────────────────────────────────────────────────────
//  7. Direct URL Access (SPA Fallback)
// ─────────────────────────────────────────────────────────────

test.describe('7. Direct URL Access', () => {
  test('direct navigation to /about loads correctly', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByTestId('shell-header')).toBeVisible();
    await expect(page.getByTestId('about-page')).toBeVisible();
  });

  test('direct navigation to /users/123 loads correctly', async ({ page }) => {
    await page.goto('/users/123');
    await expect(page.getByTestId('shell-header')).toBeVisible();
    await expect(page.getByTestId('user-page')).toBeVisible();
    await expect(page.getByTestId('user-id')).toHaveText('123');
  });

  test('direct navigation to unknown path shows 404', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page.getByTestId('shell-header')).toBeVisible();
    await expect(page.getByTestId('not-found-page')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────
//  8. Hash Stability (Code Splitting)
// ─────────────────────────────────────────────────────────────

test.describe('8. Code Splitting', () => {
  test('page components are loaded as separate chunks', async ({ page }) => {
    // Load home page and track network requests
    const jsRequests: string[] = [];
    page.on('request', (req: any) => {
      if (req.url().endsWith('.js')) {
        jsRequests.push(new URL(req.url()).pathname);
      }
    });

    await goto(page, '/');
    // Wait for page to fully load
    await expect(page.getByTestId('home-page')).toBeVisible();

    // There should be multiple JS files loaded (main chunk + page chunk at minimum)
    expect(jsRequests.length).toBeGreaterThanOrEqual(2);

    // Navigate to about — should trigger loading of another chunk
    const beforeAbout = jsRequests.length;
    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();

    // A new JS file should have been fetched for the about page chunk
    expect(jsRequests.length).toBeGreaterThan(beforeAbout);
  });
});
