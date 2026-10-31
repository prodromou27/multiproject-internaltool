import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

async function nonManagedCustomer(page) {
  const api = await mockApi(page, { role: 'manager' });
  const customer = { id: 12, name: 'Northwind Logistics', active: 1, service_activity_enabled: false, hidden_sections: [], version: 0 };
  let configuration = { managed_services_enabled: false, service_activity_tracking_enabled: false, responsible_team_id: null, version: 0 };
  let assigned = [2];
  const teams = [{ id: 1, name: 'Security Team' }, { id: 2, name: 'Delivery Team' }];
  api.override('GET /api/customers/12', () => ({ body: customer }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: {
    projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 },
    recommendations: { open: 0, high_risk: 0 }, visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: false },
  } }));
  api.override('GET /api/teams', () => ({ body: teams }));
  api.override('GET /api/teams/1', () => ({ body: { ...teams[0], members: [] } }));
  api.override('GET /api/customers/12/teams', () => ({ body: teams.filter(team => assigned.includes(team.id)) }));
  api.override('PUT /api/customers/12/teams', ({ body }) => { assigned = body.team_ids; return { body: { ok: true } }; });
  api.override('GET /api/customers/12/managed-services', () => ({ body: configuration }));
  api.override('PUT /api/customers/12/managed-services', ({ body }) => {
    configuration = { ...body, version: configuration.version + 1 };
    return { body: configuration };
  });
  return { api, configuration: () => configuration, assigned: () => assigned };
}

test('a non-managed customer can have a responsible team without enabling managed services or activity tracking', async ({ page }) => {
  const fixture = await nonManagedCustomer(page);
  await page.goto('/customers/12/service-profile?section=service-configuration');
  await page.getByLabel('Responsible team', { exact: false }).selectOption('1');
  await expect.poll(fixture.assigned).toEqual([2, 1]);
  await expect.poll(() => fixture.configuration().responsible_team_id).toBe(1);
  expect(fixture.configuration().managed_services_enabled).toBe(false);
  expect(fixture.configuration().service_activity_tracking_enabled).toBe(false);
  await page.reload();
  await expect(page.getByLabel('Responsible team', { exact: false })).toHaveValue('1');
  await expect(page.getByRole('tab', { name: 'Maintenance Visits', exact: true })).toBeVisible();
});

test('a failed customer team assignment can be retried without skipping the assignment request', async ({ page }) => {
  const fixture = await nonManagedCustomer(page);
  let attempts = 0;
  fixture.api.override('PUT /api/customers/12/teams', () => ++attempts === 1
    ? { status: 500, body: { error: 'Assignment unavailable' } }
    : { body: { ok: true } });
  await page.goto('/customers/12/service-profile?section=service-configuration');
  const team = page.getByLabel('Responsible team', { exact: false });
  await team.selectOption('1');
  await expect(page.getByRole('alert').filter({ hasText: 'Assignment unavailable' })).toBeVisible();
  expect(fixture.configuration().responsible_team_id).toBeNull();
  await team.selectOption('1');
  await expect.poll(() => fixture.configuration().responsible_team_id).toBe(1);
  expect(attempts).toBe(2);
});

test('customer edit shows team assignment while activity settings remain collapsed', async ({ page }) => {
  const fixture = await nonManagedCustomer(page);
  await page.goto('/customers/12/service-profile?section=service-configuration');
  await page.getByRole('button', { name: 'Edit details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Customer', exact: true });
  await expect(dialog.getByText('Service Activity Tracking Enabled', { exact: true })).not.toBeVisible();
  await dialog.getByLabel('Assigned Team(s)', { exact: true }).selectOption('1');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(fixture.assigned).toEqual([2, 1]);
  expect(fixture.configuration().managed_services_enabled).toBe(false);
  const update = fixture.api.calls.find(call => call.method === 'PUT' && call.path === '/api/customers/12');
  expect(update.body.service_activity_enabled).toBe(false);
});
