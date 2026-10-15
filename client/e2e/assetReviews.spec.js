import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = extra => ({ projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: false }, ...extra });
const asset = (id, name, version, extra = {}) => ({ id, customer_id: 12, name, asset_type: 'Firewall', vendor: 'Fortinet', model: 'FortiGate 100F', software_version: version,
  lifecycle_status: 'active', coverage_type: 'managed', environment: 'production', criticality: 'high', version: 3, attachment_count: 0, reviewed_at: null, ...extra });

async function assets(page, role, { restricted = false } = {}) {
  const api = await mockApi(page, { role, ...(restricted ? {} : { permissions: { 'assets.access': true, 'customers.access': true } }) });
  const asked = [], reviews = [], tasks = [];
  let rows = [asset(1, 'FW-HQ-01', '7.4.3', { support_end_date: '2020-01-01' }), asset(2, 'FW-DR-01', '7.6.7', { reviewed_at: '2099-01-01 10:00:00', reviewed_by_name: 'Maria Ioannou' })];
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary(restricted ? { assets_access: 'team' } : {}) }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/assets', ({ request }) => {
    const query = Object.fromEntries(new URL(request.url()).searchParams); asked.push(query);
    const shown = query.software === 'attention' ? rows.filter(r => r.id === 1) : query.review === 'due' ? rows.filter(r => !r.reviewed_at) : rows;
    return { body: { rows: shown, total: shown.length, page: 1, page_size: 25, technologies: [], expiry_summary: { expired: 1, due_30: 0, review_due: 1, active: 2, review_days: 90 } } };
  });
  api.override('GET /api/customers/12/assets/software-status', () => ({ body: { products: 1, assets: [
    { id: 1, status: 'behind', behind: 5, behind_unit: 'patch', latest: '7.4.8', line: '7.4' }, { id: 2, status: 'current', latest: '7.6.7', line: '7.6' }] } }));
  api.override('GET /api/customers/12/assets/1/versions', () => ({ body: [{ id: 9, kind: 'reviewed', from_version: '7.4.1', to_version: '7.4.3', note: 'Upgraded in May', user_name: 'Maria Ioannou', created_at: '2026-05-02 09:00:00' }] }));
  api.override('POST /api/customers/12/assets/1/review', ({ body }) => { reviews.push(body); rows = rows.map(r => r.id === 1 ? { ...r, software_version: body.software_version, reviewed_at: '2099-01-02 09:00:00', reviewed_by_name: 'Alex Mercer' } : r); return { body: rows[0] }; });
  api.override('POST /api/tasks', ({ body }) => { tasks.push(body); return { body: { id: 70 } }; });
  api.override('GET /api/auth/users', () => ({ body: [] }));
  api.override('GET /api/teams', () => ({ body: [] }));
  return { asked, reviews, tasks };
}

test('the asset list shows versions, how they compare with the latest, support and reviews, with views to narrow it', async ({ page }) => {
  const { asked } = await assets(page, 'manager');
  await page.goto('/customers/12/service-profile?section=assets');
  const hq = page.getByRole('row', { name: /FW-HQ-01/ });
  await expect(hq).toContainText('7.4.3');
  await expect(hq).toContainText('5 patches behind · latest 7.4.8');
  await expect(hq).toContainText('Support ended');
  await expect(hq).toContainText('Never');
  await expect(hq).toContainText('Review due');
  await expect(page.getByRole('row', { name: /FW-DR-01/ })).toContainText('Maria Ioannou');
  await expect(page.getByRole('button', { name: /^Needs update \(1\)/ })).toBeVisible();
  await page.getByRole('button', { name: /^Needs update/ }).click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ software: 'attention' });
  await expect(page.getByRole('row', { name: /FW-DR-01/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Review due/ }).click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ review: 'due' });
});

test('a review records the version now running, one click to the latest, and shows the version history', async ({ page }) => {
  const { reviews } = await assets(page, 'manager');
  await page.goto('/customers/12/service-profile?section=assets&view=attention');
  await page.getByRole('button', { name: 'Review FW-HQ-01' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review FW-HQ-01' });
  await expect(dialog).toContainText('Upgraded in May');
  await expect(dialog).toContainText('7.4.1 → 7.4.3');
  await expect(dialog.getByRole('button', { name: 'Confirm review' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Use latest 7.4.8' }).click();
  await dialog.getByLabel('Note (optional)').fill('Upgraded tonight');
  await dialog.getByRole('button', { name: 'Save new version' }).click();
  await expect.poll(() => reviews[0]).toEqual({ version: 3, software_version: '7.4.8', note: 'Upgraded tonight' });
  await expect(page.getByText('FW-HQ-01: version updated to 7.4.8')).toBeVisible();
});

test('an outdated asset becomes an upgrade task from its review; engineers on the team review but do not edit', async ({ page }) => {
  const { tasks, reviews } = await assets(page, 'engineer', { restricted: true });
  await page.goto('/customers/12/service-profile?section=assets');
  await expect(page.getByRole('button', { name: 'Edit FW-HQ-01' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete FW-HQ-01' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review FW-HQ-01' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create upgrade task' }).click();
  const form = page.getByRole('dialog', { name: 'Add task' });
  await expect(form).toContainText('About asset FW-HQ-01');
  await expect(form.getByLabel('Task *')).toHaveValue('Upgrade FW-HQ-01 to 7.4.8');
  await form.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => tasks[0]).toMatchObject({ title: 'Upgrade FW-HQ-01 to 7.4.8', customer_id: 12, asset_id: 1, priority: 'medium' });
  await page.getByRole('button', { name: 'Review FW-HQ-01' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm review' }).click();
  await expect.poll(() => reviews[0]).toEqual({ version: 3, software_version: '7.4.3', note: null });
});

test('an asset import is reviewed first: new rows, ones already there, and ones that cannot go in', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager', permissions: { 'assets.access': true, 'customers.access': true } });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary() }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/assets', () => ({ body: { rows: [], total: 0, page: 1, page_size: 25, technologies: [], expiry_summary: { expired: 0, due_30: 0, review_due: 0, active: 0, review_days: 90 } } }));
  api.override('POST /api/customers/12/assets/import/preview', () => ({ body: { token: 'asset-review-1', counts: { create: 1, exists: 1, unchanged: 1, update: 0, errors: 1, duplicates: 0, total: 3 }, rows: [
    { row: 2, name: 'New switch', action: 'create' },
    { row: 3, name: 'FW-HQ-01', action: 'unchanged', error: 'Already there: FW-HQ-01', existing_id: 1 },
    { row: 4, name: 'No type', action: 'error', error: 'Asset type must contain 1 to 100 characters', values: { name: 'No type', asset_type: '' } },
  ] } }));
  let upload = null;
  api.override('POST /api/customers/12/assets/import', ({ request }) => { upload = request.postDataBuffer().toString('latin1'); return { status: 201, body: { imported: 1, skipped: 2, errors: [{ row: 3, error: 'Already there: FW-HQ-01' }, { row: 4, error: 'Asset type must contain 1 to 100 characters' }] } }; });

  await page.goto('/customers/12/service-profile?section=assets');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await page.locator('input[type="file"]').setInputFiles({ name: 'assets.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK fake') });
  await dialog.getByRole('button', { name: 'Review import' }).click();
  const review = dialog.getByRole('region', { name: 'Import preview' });
  await expect(review.getByText('1 asset to add · 1 already there (skipped) · 1 row with problems')).toBeVisible();
  await expect(review.getByRole('row', { name: /FW-HQ-01 Already there Already there: FW-HQ-01/ })).toBeVisible();
  await expect(review.getByRole('row', { name: /No type Not imported Asset type must contain/ })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Download rows to correct (.csv)' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 1 new' }).click();
  await expect.poll(() => upload).toContain('asset-review-1');
  await expect(dialog.getByText('Partly imported:')).toBeVisible();
});
