import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 1, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: true, state: 'active', open_tickets: 6, closed_tickets: 0 } };
const met = { id: 12, name: 'Met', project_name: 'Project Atlas', active: 1, is_managed: true, edit_version: 1 };

test('a customer\'s project name is entered in the form and shown in the list', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let saved = null, rows = [{ ...met, project_name: null }];
  api.override('GET /api/customers', ({ request }) => ({ body: new URL(request.url()).searchParams.get('paged') ? { rows, total: rows.length, counts: { all: rows.length, active: rows.length } } : rows }));
  api.override('PUT /api/customers/12', ({ body }) => { saved = body; rows = [{ ...met, ...body }]; return { body: { ok: true } }; });
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByLabel('Project name').fill('Project Atlas');
  await page.getByRole('button', { name: /^Save|Update/ }).first().click();
  await expect.poll(() => saved?.project_name).toBe('Project Atlas');
  await expect(page.locator('.customer-project-name').first()).toHaveText('Project Atlas');
});

test('the Customer 360 banner shows the project name beside the customer name', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/customers/12', () => ({ body: met }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  await page.goto('/customers/12/service-profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Met' })).toBeVisible();
  const title = page.locator('.cs-customer-title');
  await expect(title.locator('.cs-project-name')).toHaveText('Project name: Project Atlas');
  await expect(title.locator('.cs-project-name')).toBeVisible();
});
