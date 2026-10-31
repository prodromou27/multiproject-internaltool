import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function customer360(page, role, logo = null) {
  const api = await mockApi(page, { role });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Met', active: 1, logo_updated_at: logo } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 1, high_risk: 0 }, visits: { next: null, reports_pending: 0, this_year: 0 } } }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  await page.route('**/api/customers/12/logo?**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  return api;
}

test('managers add a customer logo from Customer 360; it replaces the initials', async ({ page }) => {
  const api = await customer360(page, 'manager');
  api.override('POST /api/customers/12/logo', () => ({ body: { logo_updated_at: '2026-10-14T09:00:00.000Z' } }));
  await page.goto('/customers/12/service-profile');
  await page.getByRole('button', { name: 'Add a customer logo' }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'met.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: 'Change the customer logo' }).locator('img')).toHaveAttribute('src', /\/api\/customers\/12\/logo\?v=2026-10-14/);
});

test('others see the logo but cannot change it', async ({ page }) => {
  await customer360(page, 'engineer', '2026-10-14T09:00:00.000Z');
  await page.goto('/customers/12/service-profile');
  await expect(page.locator('.cs-customer-header img.cs-logo-image')).toBeVisible();
  await expect(page.getByRole('button', { name: /customer logo/ })).toHaveCount(0);
});
