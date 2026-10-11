import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: true, state: 'active', open_tickets: 0, closed_tickets: 0 } };
const assets = [
  { id: 1, name: 'FW-HQ-01', asset_type: 'firewall', lifecycle_status: 'active' },
  { id: 2, name: 'FW-DR-01', asset_type: 'firewall', lifecycle_status: 'active' },
  { id: 3, name: 'SW-CORE', asset_type: 'switch', lifecycle_status: 'active' },
];

async function customer(page, role, contracts) {
  const api = await mockApi(page, { role });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/contracts', () => ({ body: contracts() }));
  return api;
}

test('managers add a contract with its reference, dates, contract type and assets, and renew it', async ({ page }) => {
  let list = [], sent = null, renewed = null;
  const view = () => ({ contracts: list, is_managed: true, service_levels: ['24x7', '12x5', '8x5'], can_manage: true, can_see_assets: true, assets,
    uncovered_assets: assets.filter(a => !list.some(c => ['active', 'ending_soon'].includes(c.status) && c.assets.some(x => x.id === a.id))) });
  const api = await customer(page, 'manager', view);
  api.override('POST /api/customers/12/contracts', ({ body }) => {
    sent = body;
    list = [{ id: 5, customer_id: 12, ...body, status: 'ending_soon', days_left: 12, renewed_from_id: null, asset_count: body.asset_ids.length, assets: assets.filter(a => body.asset_ids.includes(a.id)) }];
    return { status: 201, body: { id: 5 } };
  });
  api.override('POST /api/customers/12/contracts/5/renew', ({ body }) => { renewed = body; return { status: 201, body: { id: 6 } }; });

  await page.goto('/customers/12/service-profile?section=contracts');
  await expect(page.getByText('No contracts recorded yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Add contract' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add contract' });
  await dialog.getByLabel('Contract reference').fill('MSP-2026-014');
  await dialog.getByLabel('Contract type').selectOption('24x7');
  await dialog.getByLabel('Start date').fill('2025-10-24');
  await dialog.getByLabel('End date').fill('2026-10-23');
  await dialog.getByRole('checkbox', { name: /FW-HQ-01/ }).check();
  await dialog.getByRole('checkbox', { name: /FW-DR-01/ }).check();
  await dialog.getByRole('button', { name: 'Save contract' }).click();
  await expect.poll(() => sent).toMatchObject({ reference: 'MSP-2026-014', service_level: '24x7', start_date: '2025-10-24', end_date: '2026-10-23', asset_ids: [1, 2] });

  const card = page.locator('.cc-card').filter({ hasText: 'MSP-2026-014' });
  await expect(card).toContainText('Ending soon');
  await expect(card).toContainText('Ends in 12 days');
  await expect(card).toContainText('24x7');
  await expect(page.getByRole('status')).toContainText('1 active asset is not under a current contract: SW-CORE');

  // Renewing proposes the next period, starting the day after the end.
  await card.getByRole('button', { name: 'Renew' }).click();
  const renew = page.getByRole('dialog', { name: 'Renew MSP-2026-014' });
  await expect(renew.getByLabel('Start date')).toHaveValue('2026-10-24');
  await expect(renew.getByLabel('End date')).toHaveValue('2027-10-23');
  await expect(renew.getByRole('checkbox', { name: /FW-HQ-01/ })).toBeChecked();
  await renew.getByRole('button', { name: 'Renew contract' }).click();
  await expect.poll(() => renewed).toMatchObject({ reference: 'MSP-2026-014', start_date: '2026-10-24', end_date: '2027-10-23', service_level: '24x7', asset_ids: [1, 2] });
});

test('others see contracts without changing them, and history keeps expired and renewed ones', async ({ page }) => {
  const contracts = [
    { id: 6, reference: 'SUP-77', description: 'Firewall support', service_level: null, start_date: '2026-10-24', end_date: '2027-10-23', status: 'upcoming', days_left: 377, asset_count: 2 },
    { id: 5, reference: 'SUP-77', description: 'Firewall support', service_level: null, start_date: '2025-10-24', end_date: '2026-10-23', status: 'renewed', days_left: 12, asset_count: 2 },
  ];
  await customer(page, 'planner', () => ({ contracts, is_managed: false, service_levels: [], can_manage: false, can_see_assets: false, uncovered_count: 0 }));
  await page.goto('/customers/12/service-profile?section=contracts');
  const history = page.getByRole('region', { name: 'History' });
  await expect(history).toContainText('Renewed');
  await expect(page.locator('.cc-card').first()).toContainText('Starts later');
  await expect(page.locator('.cc-card').first()).toContainText('2 assets');
  await expect(page.getByRole('button', { name: 'Add contract' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Renew' })).toHaveCount(0);
});
