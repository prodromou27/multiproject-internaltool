import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const settings = { base_url: 'http://grafana.internal:3000', datasource_uid: 'fe8guxq67er5sf', version_query: 'system_gaia_module_version{module="Firewall-1"}', model_query: 'hardware_model',
  take_map: { 996000077: 170 }, version_map: { jess_main: 'R82.10' }, auto_apply: false, token_set: true, last_sync_at: '2026-10-15T08:00:00Z', last_result: { ok: true, devices: 3, differs: 1, unmatched: 1, unknown_takes: 1, applied: 0 } };
const devices = [
  { host_name: 'EXTFW01', model: 'Check Point 6600', version_label: 'R81_20_jumbo_hf_main', build: '996000077', take: 170, proposed_version: 'R81.20 Take 170', status: 'differs',
    asset: { id: 11, name: 'Ext firewall 1', customer_name: 'Acme Corp' }, changes: [{ field: 'software_version', from: 'R81.20 Take 99', to: 'R81.20 Take 170' }] },
  { host_name: 'UNKNOWN-FW', model: null, version_label: 'R81_10_jumbo_hf_main', build: '996000055', take: null, proposed_version: 'R81.10', status: 'unmatched', asset: null, changes: [] },
];

test('managers review Grafana devices, apply the differences, and link the unmatched ones', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let applied = null, linked = null, imported = null;
  api.override('GET /api/grafana/settings', () => ({ body: settings }));
  api.override('GET /api/grafana/devices', () => ({ body: { rows: devices } }));
  api.override('POST /api/grafana/apply', ({ body }) => { applied = body; return { body: { applied: 1 } }; });
  api.override('GET /api/grafana/assets', () => ({ body: { rows: [{ id: 21, name: 'Old R81.10 box', hostname: 'old-box', customer_name: 'Northwind' }] } }));
  api.override('POST /api/grafana/link', ({ body }) => { linked = body; return { body: { ok: true } }; });
  api.override('POST /api/grafana/take-map/import', ({ body }) => { imported = body; return { body: { added: 2, found: 3, conflicts: { 998000035: [127, 126] }, take_map: { 996000077: 170, 997000046: 99 } } }; });

  await page.goto('/settings/grafana');
  await expect(page.getByText('Last sync')).toContainText('3 devices, 1 to review, 1 not matched, 1 builds without a take');
  await expect(page.getByLabel('Service-account token (Viewer)')).toHaveAttribute('placeholder', /Saved/);
  await expect(page.getByText('The token travels unencrypted over http')).toBeVisible();

  const review = page.getByRole('region', { name: 'Devices from Grafana' });
  await expect(review.getByRole('row', { name: /EXTFW01 .*Acme Corp: Ext firewall 1 Differs Version: R81.20 Take 99 → R81.20 Take 170/ })).toBeVisible();
  await review.getByLabel('Apply EXTFW01').check();
  await review.getByRole('button', { name: 'Apply 1 to assets' }).click();
  await expect.poll(() => applied).toEqual({ host_names: ['EXTFW01'] });

  await review.getByRole('button', { name: /Not matched \(1\)/ }).click();
  await expect(review.getByText('build 996000055 (take not listed)')).toBeVisible();
  await review.getByLabel('Find the asset for UNKNOWN-FW').fill('old');
  await review.getByLabel('Asset for UNKNOWN-FW', { exact: true }).selectOption({ label: 'Northwind: Old R81.10 box (old-box)' });
  await expect.poll(() => linked).toEqual({ host_name: 'UNKNOWN-FW', asset_id: 21 });

  await page.getByLabel("Or paste a dashboard's JSON to take its value mappings").fill('{"spec":{}}');
  await page.getByRole('button', { name: 'Import from dashboard' }).click();
  await expect(page.getByText('998000035 (Take 127 or 126)')).toBeVisible();
  expect(imported).toEqual({ dashboard: '{"spec":{}}' });
});
