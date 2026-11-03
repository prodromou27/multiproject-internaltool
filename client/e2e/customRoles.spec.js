import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const definitions = [
  { key: 'tasks.access', group: 'Core Modules', label: 'Access tasks', description: 'Open task lists.', default_roles: ['manager', 'planner', 'pm', 'engineer'] },
  { key: 'service_activities.access', group: 'Core Modules', label: 'Access service activity tracking', description: 'Use the activity log.', eligible_roles: ['manager', 'pm', 'engineer'] },
  { key: 'reports.access', group: 'Core Modules', label: 'Access management reporting', description: 'Open reports.', eligible_roles: ['manager', 'planner', 'pm'] },
];
const defaults = {
  manager: { 'tasks.access': true, 'service_activities.access': true, 'reports.access': true },
  planner: { 'tasks.access': true, 'service_activities.access': false, 'reports.access': false },
  pm: { 'tasks.access': true, 'service_activities.access': true, 'reports.access': false },
  engineer: { 'tasks.access': true, 'service_activities.access': true, 'reports.access': false },
};

test('managers make a custom role on a base role, ticking only what that role may have, and give it to people', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let customRoles = [];
  const matrix = () => ({ body: { definitions, roles: ['manager', 'planner', 'pm', 'engineer'], defaults, role_rules: [], user_rules: [], users: [{ id: 7, name: 'Maria Lopez', role: 'engineer', active: 1 }], custom_roles: customRoles } });
  api.override('GET /api/permissions', matrix);
  api.override('POST /api/permissions/custom-roles', ({ body }) => {
    customRoles = [{ id: 3, version: 1, members: 0, ...body }];
    return { status: 201, body: customRoles[0] };
  });
  await page.goto('/settings/permissions');
  await page.getByRole('button', { name: 'New role' }).click();
  await page.getByLabel('Name').fill('Field lead');
  await page.getByLabel('Built on').selectOption('engineer');
  // Reporting is not something an engineer-based role can have, so it is not offered.
  await expect(page.getByRole('dialog').getByText('Access management reporting')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('checkbox', { name: /Access service activity tracking/ }).uncheck();
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect.poll(() => api.calls.find(call => call.method === 'POST' && call.path === '/api/permissions/custom-roles')?.body).toMatchObject({
    name: 'Field lead', base_role: 'engineer', permissions: { 'tasks.access': true, 'service_activities.access': false },
  });
  await expect(page.getByRole('cell', { name: 'Field lead', exact: true })).toBeVisible();

  // Settings → Users: the role picker offers it.
  api.override('GET /api/admin/users', () => ({ body: [{ id: 7, name: 'Maria Lopez', email: 'maria@example.com', role: 'engineer', active: 1 }] }));
  await page.goto('/settings/users');
  await page.getByRole('button', { name: /Edit/ }).first().click();
  await page.getByLabel('Role').selectOption({ label: 'Field lead (on Engineer)' });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect.poll(() => api.calls.find(call => call.method === 'PUT' && call.path === '/api/admin/users/7')?.body).toMatchObject({ custom_role_id: 3 });
});
