import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('managers rename, add and remove contract types in Settings', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let sent = null;
  api.override('GET /api/settings/contract-types', () => ({ body: { types: [{ name: '24x7', contracts: 4 }, { name: '12x5', contracts: 0 }, { name: '8x5', contracts: 2 }], no_longer_offered: [] } }));
  api.override('PUT /api/settings/contract-types', ({ body }) => {
    sent = body;
    return { body: { types: body.types.map(name => ({ name, contracts: name === '8x5 NBD' ? 2 : 0 })), no_longer_offered: [] } };
  });
  await page.goto('/settings/contract_types');
  await expect(page.getByRole('button', { name: 'Save contract types' })).toBeDisabled();
  await page.getByLabel('Contract type 3').fill('8x5 NBD');
  await page.getByRole('button', { name: 'Remove 12x5' }).click();
  await page.getByLabel('New contract type').fill('24x5');
  await page.getByRole('button', { name: 'Add type' }).click();
  await page.getByRole('button', { name: 'Save contract types' }).click();
  await expect.poll(() => sent).toEqual({ types: ['24x7', '8x5 NBD', '24x5'], renames: { '8x5': '8x5 NBD' }, calendars: { '24x7': 'all_days', '8x5 NBD': 'business', '24x5': 'business' } });
  await expect(page.getByRole('button', { name: 'Save contract types' })).toBeDisabled();
});

test('the contract form offers the configured types, and keeps a type no longer offered', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
    visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: true, state: 'active', open_tickets: 0, closed_tickets: 0 } } }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  const contract = { id: 5, customer_id: 12, reference: 'MSP-1', service_level: '12x5', start_date: '2026-01-01', end_date: '2026-12-31', status: 'active', days_left: 80, assets: [], asset_count: 0 };
  api.override('GET /api/customers/12/contracts', () => ({ body: { contracts: [contract], is_managed: true, service_levels: ['24x7', 'Office hours'], can_manage: true, can_see_assets: false, uncovered_count: 0 } }));
  await page.goto('/customers/12/service-profile?section=contracts');
  await page.locator('.cc-card').filter({ hasText: 'MSP-1' }).getByRole('button', { name: /Edit/ }).click();
  const type = page.getByRole('dialog').getByLabel('Contract type');
  await expect(type).toHaveValue('12x5');
  await expect(type.locator('option')).toHaveText(['Not set', '24x7', 'Office hours', '12x5 (no longer offered)']);
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Change the contract types' })).toHaveAttribute('href', '/settings/contract_types');
});

test('managed customers are labelled in the customer list', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/customers', () => ({ body: { rows: [{ id: 12, name: 'Northwind Logistics', active: 1, is_managed: true }, { id: 14, name: 'Contoso Retail', active: 1, is_managed: false }],
    total: 2, counts: { all: 2, active: 2, managed: 1 } } }));
  await page.goto('/customers');
  await expect(page.getByRole('row', { name: /Northwind Logistics/ }).getByText('Managed', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Contoso Retail/ }).getByText('Managed', { exact: true })).toHaveCount(0);
});
