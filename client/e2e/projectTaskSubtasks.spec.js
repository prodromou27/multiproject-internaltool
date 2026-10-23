import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a project task has subtasks, each assigned to an engineer, and files', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const assigned = [];
  const task = { id: 41, project_id: 9, title: 'Migrate the firewall rules', status: 'open', priority: 'medium', assigned_to: 7, assigned_to_name: 'Maria Ioannou' };
  let subtasks = [{ id: 1, title: 'Export the old rules', done: false, assigned_to: null, owner_name: null, due_date: null }];
  api.override('GET /api/projects/9', () => ({ body: { id: 9, project_code: 'PRJ-9', title: 'Core refresh', status: 'in_progress', priority: 'medium', members: [], updates: [], created_by: 1, edit_version: 1 } }));
  api.override('GET /api/tasks', () => ({ body: [task] }));
  api.override('GET /api/auth/users', () => ({ body: [{ id: 7, name: 'Maria Ioannou', role: 'engineer', active: 1 }, { id: 8, name: 'Nick Network', role: 'engineer', active: 1 }] }));
  api.override('GET /api/tasks/41/subtasks', () => ({ body: { subtasks, task: { status: 'open' } } }));
  api.override('PUT /api/tasks/41/subtasks/1', ({ body }) => {
    assigned.push(body);
    subtasks = subtasks.map(item => ({ ...item, ...body, owner_name: body.assigned_to === 8 ? 'Nick Network' : null }));
    return { body: { subtasks, task: { status: 'open' } } };
  });
  api.override('GET /api/tasks/41/attachments', () => ({ body: [] }));
  await page.goto('/projects/9');
  await page.getByRole('cell', { name: 'Migrate the firewall rules' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Task Details' });
  const owner = dialog.getByLabel('Owner of Export the old rules');
  await expect(owner).toHaveValue('');
  await expect(owner.locator('option').first()).toHaveText('Assign an engineer…');
  await owner.selectOption({ label: 'Nick Network' });
  await expect.poll(() => assigned[0]).toEqual({ assigned_to: 8 });
  await expect(dialog.getByRole('region', { name: 'Files' })).toBeVisible();
});
