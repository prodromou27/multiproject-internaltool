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

test('a grouped report is charted: bars, horizontal bars, line or pie, of a chosen measure', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/reports/custom/sources', () => ({ body: { sources, lookups: {}, templates: { as_of: '2026-10-07', rows: [] }, share_users: [], share_teams: [], preview_limit: 100, export_limit: 5000 } }));
  api.override('GET /api/reports/custom/saved', () => ({ body: { rows: [], total: 0, page: 1, page_size: 25 } }));
  api.override('POST /api/reports/custom/preview', () => ({ body: { columns: [{ key: 'status', label: 'Status' }, { key: 'metric_0', label: 'count *' }, { key: 'metric_1', label: 'count id' }],
    rows: [{ status: 'open', metric_0: 6, metric_1: 6 }, { status: 'in_progress', metric_0: 4, metric_1: 4 }, { status: 'completed', metric_0: 12, metric_1: 12 }], truncated: false, limit: 100 } }));
  await page.goto('/reports?view=builder');
  await page.getByLabel('Group and aggregate').check();
  await page.getByRole('checkbox', { name: 'Status' }).check();
  await page.getByRole('button', { name: 'Add aggregation' }).click();
  await page.getByRole('button', { name: 'Preview' }).click();
  const chart = page.getByRole('region', { name: 'Report chart' });
  await expect(chart).toContainText('count * by Status');
  await expect(chart.locator('.recharts-bar-rectangle')).toHaveCount(3);
  await chart.getByRole('button', { name: 'Pie' }).click();
  await expect(chart.locator('.recharts-pie-sector')).toHaveCount(3);
  await chart.getByRole('combobox', { name: 'Measure' }).selectOption('count id');
  await expect(chart).toContainText('count id by Status');
  await expect(page.getByRole('cell', { name: 'in_progress' })).toBeVisible();
});

test('the delivery schedule shows who the latest report reached and retries the rest', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/reports/custom/sources', () => ({ body: { sources, lookups: {}, templates: { as_of: '2026-10-07', rows: [] }, share_users: [], share_teams: [], preview_limit: 100, export_limit: 5000 } }));
  api.override('GET /api/reports/custom/saved', () => ({ body: { rows: [{ id: 5, name: 'Weekly tasks', visibility: 'shared' }], total: 1, page: 1, page_size: 25 } }));
  api.override('GET /api/reports/custom/saved/5', () => ({ body: { id: 5, name: 'Weekly tasks', visibility: 'shared', owner_id: 1, can_edit: true, version: 1, definition: { source: 'tasks', fields: ['id'] } } }));
  const slot = '2026-10-12T09:00:00.000Z';
  let deliveries = [
    { id: 1, slot, user_name: 'Ana Recipient', status: 'sent', attempts: 1 },
    { id: 2, slot, user_name: 'Ben Recipient', status: 'failed', attempts: 3, last_error: 'The mail server could not be reached. Gave up after 3 attempts.' },
    { id: 3, slot, user_name: 'Cy Recipient', status: 'uncertain', attempts: 1, last_error: 'The connection dropped while the email was being handed over; it may have arrived.' },
  ];
  api.override('GET /api/reports/custom/saved/5/schedule', () => ({ body: { schedule: { frequency: 'weekly', day: 1, hour: 9, minute: 0, enabled: true, recipient_ids: [], version: 2, last_run: slot, last_status: 'partial' }, recipients: [], visibility: 'shared', deliveries } }));
  let retried = 0;
  api.override('POST /api/reports/custom/saved/5/schedule/retry', () => { retried++; deliveries = deliveries.map(row => (row.status === 'sent' ? row : { ...row, status: 'pending', attempts: 0, last_error: null })); return { body: { retried: 2 } }; });

  await page.goto('/reports?view=builder');
  await page.getByRole('button', { name: /Weekly tasks/ }).click();
  await page.getByRole('button', { name: 'Delivery schedule' }).click();
  const recent = page.getByRole('region', { name: 'Recent deliveries' });
  await expect(recent.getByText('Ana Recipient: Sent')).toBeVisible();
  await expect(recent.getByText(/Ben Recipient: Failed \(The mail server could not be reached/)).toBeVisible();
  await expect(recent.getByText(/Cy Recipient: Uncertain: may have arrived/)).toBeVisible();
  await expect(recent.getByText(/retrying can send it twice/)).toBeVisible();
  await recent.getByRole('button', { name: 'Retry failed deliveries (2)' }).click();
  await expect(recent.getByRole('status')).toHaveText('2 deliveries queued; they go out within a minute.');
  expect(retried).toBe(1);
  await expect(recent.getByText('Ben Recipient: Queued')).toBeVisible();
  await expect(recent.getByRole('button', { name: /Retry failed deliveries/ })).toHaveCount(0);
});
