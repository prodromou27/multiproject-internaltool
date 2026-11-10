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

test('a KPI measured per engineer from recorded trainings shows each engineer on the scorecard', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager', permissions: { 'kpis.view': true, 'kpis.manage': true } });
  const people = ['organization', 'team', 'engineer'];
  api.override('GET /api/kpis/definitions/meta', () => ({ body: {
    data_sources: [
      { key: 'records', label: 'Recorded entries', description: 'Entries a manager records.', period: true, people: true, scopes: people },
      { key: 'tickets_resolved', label: 'Tickets resolved', description: 'Tickets resolved.', unit: 'tickets', period: true, people: true, scopes: [...people, 'customer'] },
    ],
    periods: [{ key: 'month', label: 'This month' }, { key: 'year', label: 'This year' }],
    scopes: ['organization', 'team', 'project', 'customer', 'engineer'], visualizations: ['number'],
    teams: [{ id: 1, name: 'Security Team' }], projects: [], customers: [{ id: 3, name: 'Northwind Logistics' }],
    engineers: [{ id: 7, name: 'Maria Security' }, { id: 8, name: 'Nick Network' }],
  } }));
  api.override('GET /api/kpis/definitions', () => ({ body: { rows: [], total: 0, page: 1, page_size: 25, counts: { total: 0, enabled: 0, disabled: 0, team_scoped: 0 } } }));
  const definition = { id: 5, name: 'Trainings completed', data_source: 'records', scope_type: 'team', team_id: 1, team_name: 'Security Team', direction: 'higher', target_value: 2, warning_threshold: 2, critical_threshold: 0,
    calculation_config: { period: 'year', per_engineer: true, aggregate: 'count', unit: 'trainings' } };
  let records = [];
  api.override('GET /api/kpis/scorecard', () => ({ body: { rows: [{ ...definition, value: 1.5, status: 'warning', period: { label: 'This year' }, facts: { engineers: 2, meeting_target: 1 },
    breakdown: [{ user_id: 7, name: 'Maria Security', value: 2, status: 'healthy' }, { user_id: 8, name: 'Nick Network', value: 1, status: 'warning' }] }] } }));
  api.override('GET /api/kpis/definitions/5/records', () => ({ body: { definition: { id: 5 }, rows: records } }));
  api.override('POST /api/kpis/definitions/5/records', ({ body }) => { records = [{ id: 1, ...body, engineer_name: 'Nick Network' }]; return { status: 201, body: { id: 1 } }; });
  let created = null;
  api.override('POST /api/kpis/definitions', ({ body }) => { created = body; return { status: 201, body: { id: 6, version: 1 } }; });

  await page.goto('/kpis');
  const card = page.getByRole('article', { name: 'Trainings completed' });
  await expect(card).toContainText('1 of 2 engineers on target');
  await expect(card.getByRole('row', { name: /Nick Network/ })).toContainText('Warning');
  await card.getByRole('button', { name: 'Records' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Engineer').selectOption({ label: 'Nick Network' });
  await dialog.getByLabel('What').fill('Fortinet NSE4');
  await dialog.getByRole('button', { name: 'Add record' }).click();
  await expect(dialog.getByRole('row', { name: /Fortinet NSE4/ })).toContainText('Nick Network');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'New KPI' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name').fill('Tickets per engineer');
  await form.getByLabel('Category').fill('Service');
  await form.getByLabel('Data source').selectOption('tickets_resolved');
  await form.getByLabel('Period').selectOption('month');
  await form.getByLabel('Measured for').selectOption('team');
  await form.getByRole('combobox', { name: 'Team', exact: true }).selectOption({ label: 'Security Team' });
  await form.getByLabel(/Measure each engineer/).check();
  await page.getByRole('button', { name: 'Save definition' }).click();
  await expect.poll(() => created).not.toBeNull();
  expect(created).toMatchObject({ data_source: 'tickets_resolved', scope_type: 'team', team_id: 1, calculation_config: { period: 'month', per_engineer: true } });
});
