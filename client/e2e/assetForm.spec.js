import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: false } };

async function assetsTab(page) {
  const api = await mockApi(page, { role: 'manager', permissions: { 'assets.access': true, 'customers.access': true } });
  const created = [];
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/assets', () => ({ body: { rows: [], total: 0, page: 1, page_size: 25, technologies: [], expiry_summary: { expired: 0, due_30: 0, review_due: 0, active: 0, review_days: 90 } } }));
  api.override('GET /api/customers/12/assets/software-status', () => ({ body: { products: 0, assets: [] } }));
  api.override('POST /api/customers/12/assets', ({ body }) => { created.push(body); return { status: 201, body: { id: 1, ...body } }; });
  await page.goto('/customers/12/service-profile?section=assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  return { created, dialog: page.getByRole('dialog', { name: 'Add customer asset' }) };
}

test('adding an asset starts with the essentials; a cloud service has no device fields', async ({ page }) => {
  const { created, dialog } = await assetsTab(page);
  await expect(dialog.getByLabel('Hostname')).toBeHidden();               // under More details, closed
  await dialog.getByLabel('Asset name').fill('Microsoft 365');
  await dialog.getByLabel('Asset type').fill('Cloud service');
  await dialog.getByLabel('Vendor').fill('Microsoft');
  await dialog.getByLabel('Plan or edition').fill('Business Premium');
  await dialog.getByText('More details').click();
  await expect(dialog.getByLabel('Location')).toBeVisible();
  for (const field of ['Hostname', 'IP address', 'MAC address', 'Serial number', 'Software / firmware version']) await expect(dialog.getByLabel(field)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save asset' }).click();
  await expect.poll(() => created[0]).toMatchObject({ name: 'Microsoft 365', asset_type: 'Cloud service', vendor: 'Microsoft', model: 'Business Premium' });
  expect(created[0].quantity).toBeUndefined();
});

test('five identical access points are added in one go, with their serial numbers', async ({ page }) => {
  const { created, dialog } = await assetsTab(page);
  await dialog.getByLabel('Asset name').fill('Access point');
  await dialog.getByLabel('Asset type').fill('Access point');
  await dialog.getByLabel('How many').fill('5');
  await expect(dialog.getByText('Adds 5 assets: Access point 1 … 5.')).toBeVisible();
  await dialog.getByLabel(/Serial numbers/).fill('SN-1\nSN-2\n\nSN-3');
  await expect(dialog.getByText(/^3 of 5\./)).toBeVisible();
  await dialog.getByRole('button', { name: 'Add 5 assets' }).click();
  await expect.poll(() => created[0]).toMatchObject({ name: 'Access point', quantity: 5, serials: ['SN-1', 'SN-2', 'SN-3'], hostname: '', serial_number: '' });
});
