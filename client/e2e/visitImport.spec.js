import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a visit import is reviewed first: visits already planned are skipped, a holiday is flagged', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('POST /api/maintenance-visits/import/preview', () => ({ body: { token: 'visit-review-1', counts: { create: 2, update: 0, unchanged: 1, errors: 1, duplicates: 0, total: 4 }, rows: [
    { row: 2, name: 'Firewall upgrade', action: 'create' },
    { row: 3, name: 'Holiday visit', action: 'create', error: 'Public holiday: Independence Day' },
    { row: 4, name: 'Quarterly check', action: 'unchanged', error: 'Already there: Acme Corp, 2027-03-08' },
    { row: 5, name: 'Bad date', action: 'error', error: 'scheduled_date must be a date (YYYY-MM-DD or DD/MM/YYYY), not "next week"', values: { title: 'Bad date', scheduled_date: 'next week' } },
  ] } }));
  let upload = null;
  api.override('POST /api/maintenance-visits/import', ({ request }) => { upload = request.postDataBuffer().toString('latin1'); return { body: { imported: 2, skipped: 2, errors: [] } }; });
  await page.goto('/maintenance-visits');
  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByRole('button', { name: 'Import visits' }).click();
  const dialog = page.getByRole('dialog');
  await page.locator('input[type="file"]').setInputFiles({ name: 'visits.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK fake') });
  await dialog.getByRole('button', { name: 'Review import' }).click();
  const review = dialog.getByRole('region', { name: 'Import preview' });
  await expect(review.getByText('2 visits to add · 1 already planned (skipped) · 1 row with problems')).toBeVisible();
  await expect(review.getByRole('row', { name: /Holiday visit New Public holiday: Independence Day/ })).toBeVisible();
  await expect(review.getByRole('row', { name: /Quarterly check Already there/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2 new' }).click();
  await expect.poll(() => upload).toContain('visit-review-1');
});
