import { expect, test } from '@playwright/test';

test('cart route renders nested whenElse/repeat path and switches to empty state', async ({ page }) => {
  await page.goto('/index.html');

  await expect(page.getByTestId('cart-app-title')).toHaveText('Cart E2E App');

  await expect(page.getByRole('heading', { name: 'Cart A' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cart B' })).toBeVisible();
  await expect(page.getByText('Price: R10.00')).toBeVisible();
  await expect(page.getByText('Price: R40.00')).toBeVisible();
  await expect(page.getByTestId('cart-total')).toHaveText('Total Items: 3');
  await expect(page.getByText('Your cart is empty.')).toHaveCount(0);

  await page.getByTestId('cart-remove-one').first().click();
  await expect(page.getByTestId('cart-total')).toHaveText('Total Items: 2');
  await expect(page.getByText('Your cart is empty.')).toHaveCount(0);
  await expect(page.getByTestId('cart-remove-one').first()).toBeVisible();

  await page.getByTestId('cart-clear').click();
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
  await expect(page.getByTestId('cart-total')).toHaveText('Total Items: 0');
});
