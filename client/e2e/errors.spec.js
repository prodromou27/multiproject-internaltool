import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

// Only the Tasks page asks for a page of tasks; the dashboard asks for the plain list.
// A null row makes the tasks table throw while rendering.
const brokenWhenPaged = ({ request }) => new URL(request.url()).searchParams.has('page')
  ? { body: { total: 2, counts: {}, rows: [null, { id: 1, title: null }] } }
  : { body: [] };

test('a page that crashes shows a message and keeps the navigation working', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  // A row that is null makes the tasks table throw while rendering.
  api.override('GET /api/tasks', brokenWhenPaged);
  await page.goto('/tasks');

  await expect(page.getByRole('heading', { name: 'Something went wrong on this page' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Projects' }).first()).toBeVisible();

  await page.getByRole('link', { name: /Back to dashboard/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Something went wrong on this page' })).toHaveCount(0);
});

test('the error clears when the person moves to another page', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/tasks', brokenWhenPaged);
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Something went wrong on this page' })).toBeVisible();

  await page.getByRole('link', { name: 'Maintenance Visits' }).first().click();
  await expect(page).toHaveURL(/\/maintenance-visits$/);
  await expect(page.getByRole('heading', { name: 'Something went wrong on this page' })).toHaveCount(0);
  await expect(page.getByText('Quarterly firewall check')).toBeVisible();
});
