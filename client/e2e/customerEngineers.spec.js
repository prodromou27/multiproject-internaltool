import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a manager adds an engineer from another team to a customer, beside its teams', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let saved = null;
  const rows = [{ id: 12, name: 'Northwind Logistics', active: 1, service_activity_enabled: 1 }];
  api.override('GET /api/customers', () => ({ body: { rows, total: 1, page: 1, page_size: 25, counts: { all: 1, active: 1, inactive: 0, tracked: 1 } } }));
  api.override('GET /api/teams', () => ({ body: [{ id: 1, name: 'Security Team' }, { id: 2, name: 'Network Team' }] }));
  api.override('GET /api/customers/12/teams', () => ({ body: [{ id: 1, name: 'Security Team' }] }));
  api.override('GET /api/auth/users', () => ({ body: [{ id: 7, name: 'Maria Ioannou', role: 'engineer', active: 1 }, { id: 8, name: 'Nick Network', role: 'engineer', active: 1 }, { id: 1, name: 'Alex Mercer', role: 'manager', active: 1 }] }));
  api.override('GET /api/customers/12/engineers', () => ({ body: [] }));
  api.override('PUT /api/customers/12', () => ({ body: { ok: true } }));
  api.override('PUT /api/customers/12/engineers', ({ body }) => { saved = body; return { body: { ok: true } }; });
  await page.goto('/customers');
  await page.getByRole('row', { name: /Northwind Logistics/ }).getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Customer' });
  const picker = dialog.getByLabel('Engineers from other teams');
  await expect(picker.locator('option', { hasText: 'Alex Mercer' })).toHaveCount(0);
  await picker.selectOption({ label: 'Nick Network' });
  await expect(dialog.getByRole('button', { name: 'Remove Nick Network' })).toBeVisible();
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect.poll(() => saved).toEqual({ user_ids: [8] });
});
