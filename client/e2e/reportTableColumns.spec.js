import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const catalogue = [{ key: 'assets', title: 'Assets and support status', columns: [
  { key: 'asset', label: 'Asset', default_document: true, default_spreadsheet: true },
  { key: 'version', label: 'Version', default_document: true, default_spreadsheet: true },
  { key: 'vendor', label: 'Vendor', default_document: false, default_spreadsheet: false },
] }];

test('a report template chooses the columns, sorting and row limit of its tables', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const template = { id: 3, name: 'Quarterly review', description: '', sections: ['executive_summary', 'assets'], default_narratives: {}, tables: {}, active: true, version: 1, has_word_template: false };
  let saved = null;
  api.override('GET /api/managed-report-templates', () => ({ body: { rows: [template], tables: catalogue } }));
  api.override('PUT /api/managed-report-templates/3', ({ request }) => { saved = request.postDataJSON(); return { body: { ...template, ...saved, version: 2 } }; });

  await page.goto('/settings/managed_report_templates');
  await page.getByRole('button', { name: 'Quarterly review' }).click();
  await page.locator('summary', { hasText: 'Assets and support status' }).click();
  await expect(page.getByText('Usual columns: Asset, Version.')).toBeVisible();
  await page.getByRole('button', { name: 'Choose columns' }).click();
  await page.getByRole('button', { name: 'Vendor' }).click();
  await page.getByRole('button', { name: 'Move Vendor earlier' }).click();
  await page.getByRole('button', { name: 'Move Vendor earlier' }).click();
  await page.getByRole('button', { name: 'Remove Version' }).click();
  await page.getByLabel('Sort by').selectOption('vendor');
  await page.getByLabel('Order').selectOption('desc');
  await page.getByLabel('Show at most').fill('20');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Report template saved.')).toBeVisible();
  expect(saved.tables).toEqual({ assets: { columns: ['vendor', 'asset'], sort: { column: 'vendor', direction: 'desc' }, limit: 20 } });
});
