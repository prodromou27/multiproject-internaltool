import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the calendar subscription address ends in .ics and comes with Outlook steps', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  api.override('GET /api/auth/ical-token', () => ({ body: { enabled: false } }));
  api.override('POST /api/auth/ical-token', () => ({ body: { token: 'feedtoken123' } }));
  await page.goto('/calendar');
  await page.getByRole('button', { name: /Generate subscription URL/ }).click();
  await expect(page.locator('input[readonly]')).toHaveValue(/\/api\/calendar\/ical\/feedtoken123\.ics$/);
  await page.getByText('Adding it to Outlook').click();
  await expect(page.getByText(/Add calendar → Subscribe from web/)).toBeVisible();
  await expect(page.getByText(/can be reached from the internet over https/)).toBeVisible();
});
