import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('managers add a customer response that everyone can copy', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let rows = [{ id: 'closing', title: 'Closing Ticket', tone: 'success', body: 'We will close this ticket.' }];
  api.override('GET /api/customer-responses', () => ({ body: { rows, can_edit: true } }));
  api.override('POST /api/customer-responses', ({ body }) => { rows = [...rows, { id: 'new', ...body }]; return { status: 201, body: rows.at(-1) }; });
  await page.goto('/customer-responses');
  await expect(page.getByText('We will close this ticket.')).toBeVisible();
  await page.getByRole('button', { name: 'New response' }).click();
  await page.getByLabel('Title').fill('Maintenance window');
  await page.getByLabel('Text').fill('Dear customer, we will update the firewall tonight.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Dear customer, we will update the firewall tonight.')).toBeVisible();
  expect(api.calls.find(call => call.method === 'POST' && call.path === '/api/customer-responses').body).toMatchObject({ title: 'Maintenance window', tone: 'neutral' });
});

test('engineers copy responses but cannot change them', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  api.override('GET /api/customer-responses', () => ({ body: { rows: [{ id: 'late', title: 'Late Response', tone: 'danger', body: 'No reply yet.' }], can_edit: false } }));
  await page.goto('/customer-responses');
  await expect(page.getByText('No reply yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New response' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete Late Response' })).toHaveCount(0);
});
