import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('the task view is in the address: refresh keeps it and a shared link opens it', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  await page.goto('/tasks');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: /^Overdue/ }).click();
  await expect(page).toHaveURL(/\/tasks\?filter=overdue$/);
  await page.reload();
  await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: /^Overdue/ })).toHaveClass(/active/);
  expect(api.calls.filter(call => call.path === '/api/tasks').at(-1).query).toContain('filter=overdue');

  // An edited or old link with a value that is not a view is ignored.
  await page.goto('/tasks?filter=<script>');
  await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: /^Overdue/ })).toHaveClass(/active/);
});

test('saved filters and columns follow the person to another browser, and stay theirs', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const saved = {};
  api.override('GET /api/auth/preferences', () => ({ body: { 'tasks.presets': [{ name: 'Mine overdue', filter: 'overdue', priorityFilter: 'all', myTasksOnly: true, search: '' }] } }));
  api.override('PUT /api/auth/preferences/tasks.columns', ({ body }) => { saved.columns = body.value; return { body: { ok: true } }; });
  // Another person used this browser before: their filter must not apply.
  await page.addInitScript(() => {
    localStorage.setItem('hub:2:filter.tasks', JSON.stringify('done'));
    localStorage.setItem('hub_task_filter_presets', JSON.stringify([{ name: 'Someone else' }]));
  });
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/tasks$/);
  await page.locator('summary', { hasText: 'Saved filters' }).click();
  await expect(page.getByRole('button', { name: 'Mine overdue', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Someone else' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hub_task_filter_presets'))).toBeNull();

  await page.locator('summary', { hasText: 'Columns' }).click();
  await page.locator('.column-picker-menu input[type="checkbox"]').first().uncheck();
  await expect.poll(() => saved.columns?.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hub:1:tasks.columns')))).toEqual(saved.columns);
});

test('a project tab is in the address', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/projects/1', () => ({ body: { id: 1, title: 'Network refresh', status: 'in_progress', priority: 'high', members: [], updates: [], created_by: 1 } }));
  await page.goto('/projects/1?tab=members');
  await expect(page.getByRole('tab', { name: 'Members', exact: true })).toHaveClass(/active/);
  await page.getByRole('tab', { name: 'Updates', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/1\?tab=updates$/);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Updates', exact: true })).toHaveClass(/active/);
});
