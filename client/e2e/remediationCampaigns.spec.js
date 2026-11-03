import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const cve = { id: 'CVE-2026-1001', published: '2026-09-01T10:00:00.000', description: 'FortiOS lets an attacker run code.', severity: 'critical', cvss_score: 9.8, references: [], entries: [], kev: null, nvd_url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1001',
  affected: [{ asset_id: 11, asset_name: 'fw-acme-1', version: '7.4.1', vendor: 'Fortinet', model: 'FG-100F', customer_id: 4, customer_name: 'Acme Corp', verdict: 'yes' }] };
const preview = { title: 'CVE-2026-1001', customers: [
  { customer_id: 4, customer_name: 'Acme Corp', devices: [{ asset_id: 11, asset_name: 'fw-acme-1', version: '7.4.1', detail: 'Affected', open_task: null, in_campaign: null }, { asset_id: 12, asset_name: 'fw-acme-2', version: '7.4.1', detail: 'Affected', open_task: { id: 3, title: 'Upgrade soon' }, in_campaign: null }] },
  { customer_id: 9, customer_name: 'Northwind', devices: [{ asset_id: 21, asset_name: 'fw-nw', version: '7.2.0', detail: 'Affected', open_task: null, in_campaign: { id: 2, name: 'Earlier push' } }] },
] };

test('a CVE becomes upgrade tasks per customer, then devices are followed to a verified fix', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let created = null, exception = null;
  api.override('GET /api/vulnerabilities', () => ({ body: { rows: [], total: 0, counts: {}, page: 1, page_size: 25, last_sync: {} } }));
  api.override('GET /api/vulnerabilities/CVE-2026-1001', () => ({ body: cve }));
  api.override('GET /api/auth/users', () => ({ body: [{ id: 7, name: 'Maria Ioannou', role: 'engineer' }] }));
  api.override('POST /api/remediation-campaigns/preview', () => ({ body: preview }));
  api.override('POST /api/remediation-campaigns', ({ body }) => { created = body; return { status: 201, body: { id: 5 } }; });
  api.override('GET /api/remediation-campaigns', () => ({ body: { rows: [{ id: 5, name: 'Patch CVE-2026-1001', source_type: 'cve', source_ref: 'CVE-2026-1001', target_date: '2026-11-30', status: 'active', counts: { planned: 1, upgraded: 1, verified: 0, exception: 0 } }] } }));
  api.override('GET /api/remediation-campaigns/5', () => ({ body: { id: 5, name: 'Patch CVE-2026-1001', source_type: 'cve', source_ref: 'CVE-2026-1001', target_date: '2026-11-30', status: 'active', counts: { planned: 1, upgraded: 1, verified: 0, exception: 0 },
    items: [{ asset_id: 11, asset_name: 'fw-acme-1', customer_id: 4, customer_name: 'Acme Corp', task_title: 'Patch CVE-2026-1001: upgrade 2 devices', owner_name: 'Maria Ioannou', status: 'upgraded', needs_review: true },
      { asset_id: 12, asset_name: 'fw-acme-2', customer_id: 4, customer_name: 'Acme Corp', task_title: 'Patch CVE-2026-1001: upgrade 2 devices', owner_name: 'Maria Ioannou', status: 'planned', needs_review: false }] } }));
  api.override('PUT /api/remediation-campaigns/5/items/12', ({ body }) => { exception = body; return { body: { ok: true } }; });

  await page.goto('/vulnerabilities?cve=CVE-2026-1001');
  await page.getByRole('button', { name: 'Start remediation campaign' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a remediation campaign' });
  await expect(dialog.getByText('· open task: Upgrade soon')).toBeVisible();
  await expect(dialog.getByText('· already in “Earlier push”')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Northwind', exact: true })).toBeDisabled();
  await dialog.getByLabel('Campaign').fill('Patch CVE-2026-1001');
  await dialog.getByLabel('Target date *').fill('2026-11-30');
  await dialog.getByLabel('Owner for Acme Corp').selectOption({ label: 'Maria Ioannou' });
  await dialog.getByRole('button', { name: 'Create 1 task for 2 devices' }).click();
  expect(created).toEqual({ source_type: 'cve', source_ref: 'CVE-2026-1001', name: 'Patch CVE-2026-1001', target_date: '2026-11-30', customers: [{ customer_id: 4, asset_ids: [11, 12], assigned_to: 7 }] });

  await expect(page).toHaveURL(/tab=campaigns&campaign=5/);
  const detail = page.getByRole('dialog', { name: 'Patch CVE-2026-1001' });
  await expect(detail.getByRole('row', { name: /fw-acme-1 Upgraded, to review Review the device to confirm the fix/ })).toBeVisible();
  await detail.getByRole('row', { name: /fw-acme-2/ }).getByRole('button', { name: 'Exception…' }).click();
  await detail.getByLabel('Why fw-acme-2 is an exception').fill('Being replaced in Q1');
  await detail.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => exception).toEqual({ exception_reason: 'Being replaced in Q1' });
});
