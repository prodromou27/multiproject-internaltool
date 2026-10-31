import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('customers are archived instead of deleted, restored, and only archived ones can be deleted', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const rows = [{ id: 12, name: 'Northwind Logistics', active: 1 }, { id: 14, name: 'Contoso Retail', active: 0 }];
  const calls = [];
  api.override('GET /api/customers', ({ request }) => {
    const view = new URL(request.url()).searchParams.get('view');
    const shown = rows.filter(r => view === 'inactive' ? !r.active : view === 'active' ? r.active : true);
    return { body: { rows: shown, total: shown.length, counts: { all: rows.length, active: rows.filter(r => r.active).length, inactive: rows.filter(r => !r.active).length } } };
  });
  api.override('POST /api/customers/12/archive', () => { calls.push('archive 12'); rows[0].active = 0; return { body: { ok: true } }; });
  api.override('POST /api/customers/14/restore', () => { calls.push('restore 14'); rows[1].active = 1; return { body: { ok: true } }; });

  await page.goto('/customers');
  await expect(page.getByRole('button', { name: 'Delete Northwind Logistics permanently' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive Northwind Logistics' }).click();
  await page.getByRole('dialog', { name: 'Archive customer' }).getByRole('button', { name: 'Archive' }).click();
  await expect.poll(() => calls).toEqual(['archive 12']);

  await page.getByRole('button', { name: /^Archived/ }).click();
  await expect(page.getByRole('button', { name: 'Delete Contoso Retail permanently' })).toBeVisible();
  await page.getByRole('row', { name: /Contoso Retail/ }).getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => calls).toEqual(['archive 12', 'restore 14']);
});

test('planners archive but cannot delete', async ({ page }) => {
  const api = await mockApi(page, { role: 'planner', permissions: { 'customers.access': true } });
  api.override('GET /api/customers', () => ({ body: { rows: [{ id: 14, name: 'Contoso Retail', active: 0 }], total: 1, counts: { all: 1, inactive: 1 } } }));
  await page.goto('/customers');
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Contoso Retail permanently' })).toHaveCount(0);
});
