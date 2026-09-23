import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the dashboard exposes snapshot freshness and remembers visible widgets', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/');

  await expect(page.getByText('Current snapshot')).toBeVisible();
  await expect(page.getByText(/widgets visible/)).toHaveText('9 of 9 widgets visible');
  await expect(page.locator('.dashboard-stat')).toHaveCount(4);

  await page.getByRole('button', { name: 'Customize' }).click();
  const dialog = page.getByRole('dialog', { name: 'Arrange workspace' });
  const statsOption = dialog.locator('.dashboard-widget-option').filter({ hasText: 'Stats Overview' });
  await statsOption.getByRole('button', { name: 'Hide' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.locator('.dashboard-stat')).toHaveCount(0);
  await expect(page.getByText(/widgets visible/)).toHaveText('8 of 9 widgets visible');
  await page.reload();
  await expect(page.locator('.dashboard-stat')).toHaveCount(0);
});

test('dashboard widget order can be changed without drag and drop', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Customize' }).click();

  const dialog = page.getByRole('dialog', { name: 'Arrange workspace' });
  const health = dialog.locator('.dashboard-widget-option').filter({ hasText: 'Project Health' });
  await health.getByRole('button', { name: 'Move Project Health (RAG) up' }).click();
  const labels = await dialog.locator('.dashboard-widget-option > span').allTextContents();
  expect(labels.slice(0, 2)).toEqual(['Project Health (RAG)', 'Stats Overview']);
});
