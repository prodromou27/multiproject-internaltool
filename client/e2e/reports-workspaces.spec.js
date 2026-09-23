import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('report sections are deep-linkable and overview metrics use the shared ledger', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/reports?view=projects');

  await expect(page.getByRole('button', { name: 'Projects' })).toHaveClass(/active/);
  await page.getByRole('button', { name: 'Overview' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.locator('.operations-metric-strip .operations-metric')).toHaveCount(4);

  await page.getByRole('button', { name: 'Report Builder' }).click();
  await expect(page).toHaveURL(/view=builder/);
});

test('service operations preserves the last report when refresh fails', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let calls = 0;
  api.override('GET /api/reports/service-activity/overview', () => {
    calls += 1;
    if (calls > 1) return { status: 503, body: { error: 'Service report temporarily unavailable' } };
    return { body: {
      total_activities: 5, total_hours: 12, customers_supported: 2,
      byBillable: [], byCustomer: [], byEngineer: [{ name: 'Alex Mercer', hours: 12 }],
      byCategory: [], byTeam: [], byTechnology: [],
    } };
  });
  await page.goto('/service-operations');

  await expect(page.getByText(/5 activities · 12h/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('alert')).toContainText('Showing the last loaded report');
  await expect(page.getByText(/5 activities · 12h/)).toBeVisible();
});
