import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const idOps = ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'];
const sources = [
  { key: 'tasks', label: 'Tasks', grain: 'One row per task', fields: [
    { key: 'id', type: 'id', label: 'ID', operators: idOps, aggregations: ['count'], filterable: true, groupable: true },
    { key: 'title', type: 'text', label: 'Title', operators: ['eq', 'contains'], aggregations: ['count'], filterable: true, groupable: true },
    { key: 'status', type: 'text', label: 'Status', operators: ['eq'], aggregations: ['count'], filterable: true, groupable: true },
  ] },
  { key: 'tickets', label: 'Tickets', grain: 'One row per ticket', fields: [
    { key: 'ticket_number', type: 'text', label: 'Ticket', operators: ['eq', 'contains'], aggregations: ['count'], filterable: true, groupable: true },
    { key: 'subject', type: 'text', label: 'Subject', operators: ['eq', 'contains'], aggregations: ['count'], filterable: true, groupable: true },
    { key: 'customer_id', type: 'customer', label: 'Customer', lookup: true, operators: idOps, aggregations: ['count'], filterable: true, groupable: true },
  ] },
  { key: 'assets', label: 'Assets', grain: 'One row per asset', fields: [
    { key: 'name', type: 'text', label: 'Asset', operators: [], aggregations: ['count'], filterable: false, groupable: false },
    { key: 'criticality', type: 'text', label: 'Criticality', operators: ['eq'], aggregations: ['count'], filterable: true, groupable: true },
  ] },
];

test('the report builder reports on tickets, filters by customer name and exports PDF', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let previewed = null, exported = null;
  api.override('GET /api/reports/custom/sources', () => ({ body: { sources, lookups: { customer: [{ id: 4, name: 'Acme Corp' }, { id: 9, name: 'Northwind' }] }, templates: { as_of: '2026-10-07', rows: [] }, share_users: [], share_teams: [], preview_limit: 100, export_limit: 5000 } }));
  api.override('GET /api/reports/custom/saved', () => ({ body: { rows: [], total: 0, page: 1, page_size: 25 } }));
  api.override('POST /api/reports/custom/preview', ({ request }) => { previewed = request.postDataJSON(); return { body: { columns: [{ key: 'ticket_number', label: 'Ticket' }, { key: 'customer_id', label: 'Customer' }], rows: [{ ticket_number: '9001', customer_id: 'Acme Corp' }], truncated: false, limit: 100 } }; });
  api.override('POST /api/reports/custom/exports', ({ request }) => { exported = request.postDataJSON(); return { status: 202, body: { id: 77, status: 'queued' } }; });
  api.override('GET /api/reports/custom/exports/77', () => ({ body: { id: 77, status: 'completed', ready: true } }));
  api.override('GET /api/reports/custom/exports/77/download', () => ({ body: '%PDF-1.3', contentType: 'application/pdf' }));

  await page.goto('/reports?view=builder');
  await page.getByLabel('Source').selectOption('tickets');
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByLabel('Filter field 1').selectOption('customer_id');
  await page.getByLabel('Filter value 1').selectOption({ label: 'Acme Corp' });
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('cell', { name: 'Acme Corp' })).toBeVisible();
  expect(previewed.filters).toEqual([{ field: 'customer_id', operator: 'eq', value: 4 }]);
  expect(previewed.fields).toEqual(['ticket_number', 'subject', 'customer_id']);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  expect((await download).suggestedFilename()).toBe('custom-report.pdf');
  expect(exported.format).toBe('pdf');

  // Encrypted asset fields are shown but cannot be filtered.
  await page.getByLabel('Source').selectOption('assets');
  await page.getByRole('button', { name: 'Add filter' }).click();
  await expect(page.getByLabel('Filter field 1').locator('option')).toHaveText(['Criticality']);
});
