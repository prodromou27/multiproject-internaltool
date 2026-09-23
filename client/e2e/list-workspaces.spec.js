import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('project search reports visible results and can reset the complete view', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/projects', () => ({ body: [
    { id: 1, title: 'Firewall renewal', customer_name: 'Northwind Logistics', status: 'in_progress', priority: 'high', rag_status: 'amber', created_by_name: 'Alex Mercer', task_count: 4, completed_tasks: 2 },
    { id: 2, title: 'Branch rollout', customer_name: 'Contoso Retail', status: 'not_started', priority: 'medium', rag_status: 'green', created_by_name: 'Alex Mercer', task_count: 2, completed_tasks: 0 },
  ] }));
  await page.goto('/projects');

  await expect(page.getByText('2 of 2 projects')).toBeVisible();
  await page.getByLabel('Search projects').fill('Northwind');
  await expect(page.getByText('1 of 2 projects')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Firewall renewal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Branch rollout' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByLabel('Search projects')).toHaveValue('');
  await expect(page.getByText('2 of 2 projects')).toBeVisible();
});

test('task bulk actions use the shared high-contrast action bar', async ({ page }) => {
  await mockApi(page, { role: 'manager' });
  await page.goto('/tasks');

  await page.locator('tbody input[type="checkbox"]').first().check();
  const bulkBar = page.locator('.bulk-action-bar');
  await expect(bulkBar).toBeVisible();
  await expect(bulkBar.getByText('1 selected')).toBeVisible();
  await bulkBar.getByRole('button', { name: 'Deselect all' }).click();
  await expect(bulkBar).toHaveCount(0);
});
