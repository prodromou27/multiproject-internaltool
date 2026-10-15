import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 2, overdue: 0 }, recommendations: { open: 1, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 1 }, managed: { visible: false }, assets: 3, assets_access: 'team' };

test('engineers open the customers they work with: overview, tasks, visits, recommendations, assets and active contracts', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  api.override('GET /api/customers', () => ({ body: { rows: [{ id: 12, name: 'Northwind Logistics', active: 1, is_managed: true }], total: 1, counts: { all: 1, active: 1, managed: 1 } } }));
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/contracts', () => ({ body: { contracts: [{ id: 5, customer_id: 12, reference: 'MSP-1', status: 'active', start_date: '2026-01-01', end_date: '2026-12-31', days_left: 80, asset_count: 0 }],
    active_only: true, is_managed: true, service_levels: [], can_manage: false, can_see_assets: true, assets: [], uncovered_assets: [] } }));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Customers', exact: true }).click();
  await page.getByRole('link', { name: 'Northwind Logistics' }).click();
  const tabs = page.getByRole('tablist', { name: 'Customer 360 sections' });
  for (const name of ['Overview', 'Tasks', 'Maintenance Visits', 'Recommendations', 'Assets', 'Contracts']) await expect(tabs.getByRole('tab', { name, exact: true })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'Contracts' }).click();
  await expect(page.getByRole('heading', { name: 'Active contracts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add contract' })).toHaveCount(0);
});

test('a managed customer shows no maintenance visits', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager', permissions: { 'managed_customers.view': true, 'customers.access': true } });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: { ...summary, managed: { visible: true, state: 'active', open_tickets: 0, closed_tickets: 0 } } }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  await page.goto('/customers/12/service-profile');
  const tabs = page.getByRole('tablist', { name: 'Customer 360 sections' });
  await expect(tabs.getByRole('tab', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Maintenance Visits' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Maintenance visits' })).toHaveCount(0);
  await page.getByText('Add', { exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Schedule Maintenance Visit' })).toHaveCount(0);
  await expect(page.getByText('Schedule Maintenance Visit')).toHaveCount(0);
});

test('engineers see no maintenance visits on a managed customer either', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: { ...summary, is_managed: true } }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  await page.goto('/customers/12/service-profile');
  const tabs = page.getByRole('tablist', { name: 'Customer 360 sections' });
  await expect(tabs.getByRole('tab', { name: 'Assets', exact: true })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Maintenance Visits' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Maintenance visits' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Maintenance Visits/ })).toHaveCount(0);
});
