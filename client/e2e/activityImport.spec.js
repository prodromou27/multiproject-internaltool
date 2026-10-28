import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const preview = { token: 'activities-review-1', counts: { create: 2, update: 0, unchanged: 1, errors: 1, duplicates: 0, total: 4 }, rows: [
  { row: 2, name: 'Northwind Logistics – Firewall rule review', action: 'create' },
  { row: 3, name: 'Northwind Logistics – Patch window', action: 'create' },
  { row: 4, name: 'Northwind Logistics – Logged by hand', action: 'unchanged', error: 'Already logged: Northwind Logistics, 2026-10-20', values: { customer: 'Northwind Logistics' } },
  { row: 5, name: 'Other Corp – Not mine', action: 'error', error: 'You cannot log activity for "Other Corp" (not one of your customers, or not tracked)', values: { customer: 'Other Corp', activity_date: '2026-10-20', category: 'Support' } },
] };

test('an engineer imports their activities from Excel: reviewed first, already-logged ones skipped', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  let upload = null;
  api.override('POST /api/service-activities/import/preview', () => ({ body: preview }));
  api.override('POST /api/service-activities/import', ({ request }) => {
    upload = request.postDataBuffer().toString('latin1');
    return { body: { imported: 2, skipped: 2, errors: [{ row: 4, error: preview.rows[2].error }, { row: 5, error: preview.rows[3].error }] } };
  });
  await page.goto('/activity-log');
  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByRole('button', { name: 'Import from Excel' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Download template (.xlsx)' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: 'my-week.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK') });
  await dialog.getByRole('button', { name: 'Review import' }).click();

  const review = dialog.getByRole('region', { name: 'Import preview' });
  await expect(review.getByText('2 activities to add · 1 already logged (skipped) · 1 row with problems')).toBeVisible();
  await expect(review.getByRole('row', { name: /Logged by hand Already there Already logged/ })).toBeVisible();
  await expect(review.getByRole('row', { name: /Other Corp – Not mine Not imported/ })).toBeVisible();

  await dialog.getByRole('button', { name: 'Import 2 new' }).click();
  await expect.poll(() => upload).toContain('name="preview_token"\r\n\r\nactivities-review-1');
  await expect(dialog.getByText('Partly imported:')).toBeVisible();
});
