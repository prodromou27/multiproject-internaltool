import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('managers import customers from a CSV, marking managed ones and updating existing ones', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let upload = null;
  api.override('POST /api/customers/import', ({ request }) => {
    upload = request.postDataBuffer().toString('latin1');
    return { body: { imported: 2, updated: 1, managed: 2, skipped: 1, errors: [{ row: 5, error: 'Team "Ops" not found' }] } };
  });
  await page.goto('/customers');
  await page.getByRole('button', { name: /Import/ }).first().click();
  await expect(page.getByText('managed:', { exact: false })).toBeVisible();
  await expect(page.getByText('team', { exact: true }).first()).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from('name;managed;team\nAcme;yes;Security Team\n') });
  await page.getByLabel('Update customers that already exist').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();

  await expect.poll(() => upload).toContain('name="update_existing"');
  expect(upload).toContain('Acme;yes;Security Team');
  await expect(page.getByText('Updated')).toBeVisible();
  await expect(page.getByText('2 marked as managed.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Team "Ops" not found' })).toBeVisible();
});
