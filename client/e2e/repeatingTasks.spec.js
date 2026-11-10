import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

test('managers set up repeating internal work (no customer) from the Tasks page', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let rows = [];
  api.override('GET /api/recurring-tasks', () => ({ body: { rows } }));
  api.override('POST /api/recurring-tasks', ({ body }) => {
    rows = [{ id: 1, ...body, active: true, next_due: body.start_date, lead_days: body.lead_days ?? 7, history: { created: 0 }, subtasks: [] }];
    return { status: 201, body: rows[0] };
  });
  await page.goto('/tasks');
  await page.getByTitle('More actions').click();
  await page.getByRole('button', { name: 'Repeating tasks' }).click();
  await expect(page.getByText('Nothing repeats yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add recurring task' }).click();
  await page.getByLabel('Task *').fill('Renew our SSL certificate');
  await page.getByLabel('Repeats').selectOption('annual');
  await expect(page.getByLabel('Asset')).toHaveCount(0); // no customer, so no customer asset
  await page.getByRole('button', { name: /^Save|Add recurring task$/ }).last().click();
  await expect.poll(() => api.calls.find(call => call.method === 'POST' && call.path === '/api/recurring-tasks')?.body).toMatchObject({ title: 'Renew our SSL certificate', frequency: 'annual' });
  await expect(page.getByRole('cell', { name: /Renew our SSL certificate/ }).first()).toBeVisible();
});

test('engineers do not see the repeating tasks setup', async ({ page }) => {
  await mockApi(page, { role: 'engineer' });
  await page.goto('/tasks');
  await page.getByTitle('More actions').click();
  await expect(page.getByText('Repeating tasks')).toHaveCount(0);
});
