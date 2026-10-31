import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the dashboard shows when it was updated and remembers visible widgets', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/');

  await expect(page.locator('.operations-page-header')).toContainText(/updated \d/);
  // The project counts repeat the attention figures, so they start hidden.
  await expect(page.locator('.dashboard-stat')).toHaveCount(0);

  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByRole('button', { name: 'Customize' }).click();
  const dialog = page.getByRole('dialog', { name: 'Arrange workspace' });
  const statsOption = dialog.locator('.dashboard-widget-option').filter({ hasText: 'Stats Overview' });
  await statsOption.getByRole('button', { name: 'Show' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(page.locator('.dashboard-stat')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('.dashboard-stat')).toHaveCount(4);
});

test('a layout saved before the simpler dashboard hides the repeated widgets once', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      for (const key of Object.keys(localStorage)) if (key.startsWith('dash_widgets_')) localStorage.removeItem(key);
      localStorage.setItem('dash_widgets_1_manager', JSON.stringify({ order: ['stat_cards', 'insights'], hidden: [] }));
    }
  });
  await page.goto('/');
  await expect(page.locator('.dashboard-stat')).toHaveCount(0);
});

test('dashboard widget order can be changed without drag and drop', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/');
  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByRole('button', { name: 'Customize' }).click();

  const dialog = page.getByRole('dialog', { name: 'Arrange workspace' });
  const health = dialog.locator('.dashboard-widget-option').filter({ hasText: 'Project Health' });
  await health.getByRole('button', { name: 'Move Project Health (RAG) up' }).click();
  await health.getByRole('button', { name: 'Move Project Health (RAG) up' }).click(); // past Insights, then Stats
  const labels = await dialog.locator('.dashboard-widget-option > span').allTextContents();
  expect(labels.slice(0, 2)).toEqual(['Project Health (RAG)', 'Stats Overview']);
});

test('a dashboard quick action that is refused says why', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/tasks', () => ({ body: [{ id: 9, title: 'Renew Fortinet licences', status: 'open', priority: 'high', assigned_to: 1 }] }));
  api.override('PUT /api/tasks/9', () => ({ status: 400, body: { error: 'Finish the open subtasks first' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Mark Renew Fortinet licences as done' }).click();
  await expect(page.getByText('Finish the open subtasks first')).toBeVisible();
});
