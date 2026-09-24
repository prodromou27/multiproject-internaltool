import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const meta = {
  data_sources: [
    { key: 'manual', label: 'Manual value', description: 'Use an authorized value entered in the definition.' },
    { key: 'project_completion', label: 'Project completion', description: 'Average completion percentage.' },
  ],
  scopes: ['organization', 'team', 'project'], visualizations: ['number', 'gauge', 'progress', 'trend', 'bar'],
  teams: [{ id: 1, name: 'Security Team' }], projects: [{ id: 1, title: 'Firewall refresh' }],
};

test('authorized managers can preview and create a KPI definition', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager', permissions: { 'kpis.view': true, 'kpis.manage': true } });
  api.override('GET /api/kpis/definitions/meta', () => ({ body: meta }));
  api.override('GET /api/kpis/definitions', () => ({ body: { rows: [], total: 0, page: 1, page_size: 25, counts: { total: 0, enabled: 0, disabled: 0, team_scoped: 0 } } }));
  api.override('POST /api/kpis/definitions/preview', () => ({ body: { value: 72, status: 'warning', facts: { source: 'manual' } } }));
  api.override('POST /api/kpis/definitions', () => ({ status: 201, body: { id: 4, version: 1 } }));

  await page.goto('/kpis');
  await expect(page.getByRole('heading', { name: 'KPI Management' })).toBeVisible();
  await page.getByRole('button', { name: 'New KPI' }).click();
  await page.getByLabel('Name').fill('Customer SLA compliance');
  await page.getByLabel('Category').fill('Service');
  await page.getByRole('spinbutton', { name: /Manual value/ }).fill('72');
  await page.getByRole('button', { name: 'Preview calculation' }).click();
  await expect(page.getByText('Calculated preview')).toBeVisible();
  await expect(page.getByText('72', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save definition' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(api.calls.some(call => call.method === 'POST' && call.path === '/api/kpis/definitions' && call.body.name === 'Customer SLA compliance')).toBe(true);
});

test('denied KPI management permission blocks the workspace route', async ({ page }) => {
  await mockApi(page, { role: 'manager', permissions: { 'kpis.view': false, 'kpis.manage': false } });
  await page.goto('/kpis');
  await expect(page.getByRole('heading', { name: 'Access unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'KPI Management' })).toHaveCount(0);
});
