import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockApi } from './support/mockApi.js';

const preview = {
  token: 'review-1',
  counts: { create: 2, update: 1, unchanged: 1, errors: 2, duplicates: 1, total: 6 },
  rows: [
    { row: 2, name: 'Acme', action: 'create' },
    { row: 3, name: 'Globex', action: 'create' },
    { row: 4, name: 'Initech', action: 'update', existing_id: 7, changes: [{ field: 'location', from: 'Limassol', to: 'Larnaca' }] },
    { row: 5, name: 'Umbrella', action: 'unchanged', existing_id: 8 },
    { row: 6, name: 'Hooli', action: 'error', kind: 'invalid', error: 'Team "Ops" not found', values: { name: 'Hooli', managed: 'yes', team: 'Ops' } },
    { row: 7, name: 'Acme', action: 'error', kind: 'duplicate', error: '"Acme" appears more than once in the file', values: { name: 'Acme', managed: '', team: '' } },
  ],
};

async function openImport(page) {
  await page.goto('/customers');
  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByRole('button', { name: 'Import customers' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from('name;managed;team\nAcme;yes;Security Team\n') });
}

test('an import is reviewed first: what is added, updated or refused, with a file of rows to correct', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let upload = null;
  api.override('POST /api/customers/import/preview', () => ({ body: preview }));
  api.override('POST /api/customers/import', ({ request }) => {
    upload = request.postDataBuffer().toString('latin1');
    return { body: { imported: 2, updated: 1, unchanged: 1, managed: 1, contracts: 0, skipped: 2, errors: [{ row: 6, error: 'Team "Ops" not found' }, { row: 7, error: '"Acme" appears more than once in the file' }] } };
  });
  await openImport(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Review import' }).click();

  const review = dialog.getByRole('region', { name: 'Import preview' });
  await expect(review.getByText('2 customers to add · 1 customer to update · 1 already up to date · 2 rows with problems (1 duplicate)')).toBeVisible();
  await expect(review.getByRole('row', { name: /Initech Update location: Limassol → Larnaca/ })).toBeVisible();
  await expect(review.getByRole('row', { name: /Hooli Not imported Team "Ops" not found/ })).toBeVisible();
  await expect(review.getByRole('row', { name: /Umbrella/ })).toHaveCount(0);

  const download = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Download rows to correct (.csv)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('customers-corrections.csv');
  const text = (await readFile(await file.path(), 'utf8')).replace(/^﻿/, '');
  expect(text.split('\r\n')).toEqual(['name,managed,team,error,file_row', 'Hooli,yes,Ops,"Team ""Ops"" not found",6', 'Acme,,,"""Acme"" appears more than once in the file",7']);

  // Updates are confirmed separately.
  await expect(dialog.getByRole('button', { name: 'Import 2 new' })).toBeVisible();
  await review.getByLabel(/Also update the 1 customer listed as Update/).check();
  await dialog.getByRole('button', { name: 'Import 2 new and 1 updated' }).click();
  await expect.poll(() => upload).toContain('name="update_existing"');
  expect(upload).toContain('name="preview_token"\r\n\r\nreview-1');
  await expect(dialog.getByText('Partly imported:')).toBeVisible();
  await expect(dialog.getByRole('cell', { name: 'Team "Ops" not found' })).toBeVisible();
});

test('a file or customer that changed after the review is reviewed again, not imported', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const imports = [];
  api.override('POST /api/customers/import/preview', () => ({ body: preview }));
  api.override('POST /api/customers/import', ({ request }) => {
    imports.push(request.postDataBuffer().toString('latin1'));
    return imports.length === 1
      ? { status: 409, body: { error: 'The file or the customers it matches changed since the preview. Review the import again.', code: 'IMPORT_CHANGED', preview: { ...preview, token: 'review-2', counts: { ...preview.counts, create: 1 }, rows: preview.rows.filter(r => r.name !== 'Globex') } } }
      : { body: { imported: 1, updated: 0, unchanged: 1, skipped: 3, errors: [] } };
  });
  await openImport(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Review import' }).click();
  await dialog.getByRole('button', { name: 'Import 2 new' }).click();
  await expect(dialog.getByText('changed since the preview. Review the import again.')).toBeVisible();
  await expect(dialog.getByText(/^1 customer to add/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 1 new' }).click();
  await expect.poll(() => imports.length).toBe(2);
  expect(imports[1]).toContain('review-2');
  expect(imports[1]).not.toContain('name="update_existing"');
});
