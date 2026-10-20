import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a new project needs its Project ID, name, description, start date and engineers; the deadline is optional', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let sent = null;
  api.override('GET /api/auth/users', () => ({ body: [{ id: 7, name: 'Maria Ioannou', role: 'engineer', active: 1 }] }));
  api.override('POST /api/projects', ({ body }) => { sent = body; return { body: { id: 31 } }; });
  await page.goto('/projects');
  await page.getByRole('button', { name: /New Project/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New Project' });
  for (const label of ['Project ID *', 'Project name *', 'Description *', 'Start date *'])
    await expect(dialog.getByLabel(label, { exact: true }), label).toHaveAttribute('required', '');
  await expect(dialog.getByLabel('Deadline', { exact: true })).not.toHaveAttribute('required', '');

  await dialog.getByLabel('Project ID *').fill('PRJ-2026-014');
  await dialog.getByLabel('Project name *').fill('Core network refresh');
  await dialog.getByLabel('Description *').fill('Replace the core switches');
  await dialog.getByLabel('Start date *').fill('2026-11-02');
  // Engineers are required too.
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Assign at least one engineer before saving.')).toBeVisible();
  expect(sent).toBeNull();
  await dialog.getByLabel('Maria Ioannou').check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent).toMatchObject({ project_code: 'PRJ-2026-014', title: 'Core network refresh', description: 'Replace the core switches', start_date: '2026-11-02', deadline: '', member_ids: [7] });
});
