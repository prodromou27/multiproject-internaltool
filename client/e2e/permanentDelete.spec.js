import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('a manager deletes a project for good after typing its Project ID', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let deleted = false;
  api.override('GET /api/projects/9', () => ({ body: { id: 9, project_code: 'PRJ-2026-009', title: 'Core refresh', description: 'x', status: 'in_progress', priority: 'medium', members: [], updates: [], created_by: 1, edit_version: 1 } }));
  api.override('DELETE /api/projects/9', () => { deleted = true; return { body: { ok: true } }; });
  await page.goto('/projects/9');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete project permanently' });
  const button = dialog.getByRole('button', { name: 'Delete permanently' });
  await expect(button).toBeDisabled();
  await dialog.getByLabel(/Type PRJ-2026-009 to confirm/).fill('PRJ-2026-00');
  await expect(button).toBeDisabled();
  await dialog.getByLabel(/Type PRJ-2026-009 to confirm/).fill('PRJ-2026-009');
  await button.click();
  await expect.poll(() => deleted).toBe(true);
  await expect(page).toHaveURL(/\/projects$/);
});
