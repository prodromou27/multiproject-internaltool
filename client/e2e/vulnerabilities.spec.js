import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const list = { rows: [
  { id: 'CVE-2026-1001', published: '2026-09-01T10:00:00.000', severity: 'critical', cvss_score: 9.8, description: 'FortiOS lets an attacker run code.', products: ['fortinet:fortios'], kev: { date_added: '2026-09-02', due_date: '2026-09-23' }, affected_assets: 1, check_assets: 0, affected_customers: 1 },
  { id: 'CVE-2026-1002', published: '2026-08-01T10:00:00.000', severity: 'high', cvss_score: 7.5, description: 'FortiProxy issue.', products: ['fortinet:fortiproxy'], kev: null, affected_assets: 0, check_assets: 0, affected_customers: 0 },
], total: 2, page: 1, page_size: 25, counts: { all: 2, critical: 1, high: 1, kev: 1, affected: 1 }, sync: { at: '2026-10-06T05:30:00.000Z', running: false, result: { errors: 0 } } };

test('everyone can open the CVE portal, filter it and see which customer devices a CVE affects', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  api.override('GET /api/vulnerabilities', ({ request }) => {
    const kev = new URL(request.url()).searchParams.get('kev');
    return { body: kev ? { ...list, rows: list.rows.filter(row => row.kev), total: 1 } : list };
  });
  api.override('GET /api/vulnerabilities/CVE-2026-1001', () => ({ body: { id: 'CVE-2026-1001', published: '2026-09-01T10:00:00.000', description: 'FortiOS lets an attacker run code.', severity: 'critical', cvss_score: 9.8,
    cvss_vector: 'CVSS:3.1/AV:N', cvss_version: '3.1', references: [{ url: 'https://fortiguard.example/advisory', tags: ['Vendor Advisory'] }], entries: [{ vendor: 'fortinet', product: 'fortios', version: '*', si: '7.2.0', ee: '7.2.8' }],
    kev: { name: 'FortiOS bug', required_action: 'Apply updates', date_added: '2026-09-02', due_date: '2026-09-23' }, nvd_url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1001',
    affected: [{ asset_id: 1, asset_name: 'FW-HQ', version: '7.2.5', vendor: 'Fortinet', model: 'FortiGate 60F', customer_id: 12, customer_name: 'Northwind', verdict: 'yes' }] } }));
  await page.goto('/vulnerabilities');
  await expect(page.getByRole('heading', { name: 'Vulnerabilities' })).toBeVisible();
  await expect(page.getByText('1 device, 1 customer')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Watched products' })).toHaveCount(0); // managers only
  await page.getByLabel('Known exploited only').check();
  await expect(page.getByRole('button', { name: 'CVE-2026-1002' })).toHaveCount(0);
  await page.getByRole('button', { name: 'CVE-2026-1001' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Apply updates')).toBeVisible();
  await expect(dialog.getByText('FW-HQ')).toBeVisible();
  await expect(dialog.getByText('from 7.2.0 before 7.2.8')).toBeVisible();
});
