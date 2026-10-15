import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const task = { id: 41, title: 'Rotate VPN keys', status: 'in_progress', priority: 'high', assigned_to: 1, assigned_to_name: 'Alex Mercer', customer_id: 4, customer_name: 'Acme Corp', deadline: '2026-10-20' };

test('Tasks opens on Open / In Progress, and more filters go into the request and the address', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/auth/users', () => ({ body: [{ id: 7, name: 'Maria Ioannou', role: 'engineer' }] }));
  api.override('GET /api/teams', () => ({ body: [{ id: 2, name: 'Network Team' }] }));
  await page.goto('/tasks');
  await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: /^Open \/ In Progress/ })).toHaveClass(/active/);
  const lastQuery = () => api.calls.filter(call => call.path === '/api/tasks').at(-1).query;
  await expect.poll(lastQuery).toContain('filter=open');

  await page.getByText('More filters').click();
  await page.getByLabel('Engineer').selectOption({ label: 'Maria Ioannou' });
  await page.getByLabel('Team').selectOption({ label: 'Network Team' });
  await page.getByLabel('Task status').selectOption('in_progress');
  await page.getByLabel('Due from').fill('2026-10-01');
  await page.getByLabel('Due to').fill('2026-10-31');
  await expect.poll(lastQuery).toContain('due_to=2026-10-31');
  const query = new URLSearchParams(lastQuery());
  expect([query.get('assigned_to'), query.get('team_id'), query.get('status'), query.get('due_from')]).toEqual(['7', '2', 'in_progress', '2026-10-01']);
  await expect(page).toHaveURL(/engineer=7/);
  await expect(page.getByText('More filters (5)')).toBeVisible();
  await page.getByRole('button', { name: 'Clear these filters' }).click();
  await expect(page).not.toHaveURL(/engineer=/);
});

test('an engineer logs hours on a task for an earlier day, then sees them by day in My time', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  let logged = null;
  api.override('GET /api/tasks', () => ({ body: { rows: [task], total: 1, counts: { all: 1, open: 1 } } }));
  api.override('GET /api/time-logs', () => ({ body: [] }));
  api.override('POST /api/time-logs', ({ body }) => { logged = body; return { body: { id: 9 } }; });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Log hours on Rotate VPN keys' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log hours' });
  await dialog.getByLabel('Day worked').fill('2026-10-13');
  await dialog.getByLabel('Hours').fill('2.5');
  await dialog.getByLabel('What you did (optional)').fill('Keys rotated on both gateways');
  await dialog.getByRole('button', { name: 'Log hours' }).click();
  await expect.poll(() => logged).toEqual({ task_id: 41, hours: 2.5, description: 'Keys rotated on both gateways', work_date: '2026-10-13' });

  api.override('GET /api/time-logs/mine', () => ({ body: [
    { id: 9, task_id: 41, hours: 2.5, work_date: '2026-10-13', task_title: 'Rotate VPN keys', customer_name: 'Acme Corp', ticket_reference: 'RT-77', description: 'Keys rotated on both gateways' },
    { id: 10, visit_id: 5, hours: 3, work_date: '2026-10-14', visit_title: 'Quarterly check', customer_name: 'Northwind' },
    { id: 11, task_id: 42, hours: 1, work_date: '2026-10-14', task_title: 'Docs', customer_name: null },
  ] }));
  await page.goto('/my-time');
  await expect(page.getByText(/^6\.5h from/)).toBeVisible();
  const tuesday = page.getByRole('region', { name: /14\/10\/2026|2026-10-14|Oct/ }).filter({ hasText: '4h' });
  await expect(tuesday.getByRole('row', { name: /3h Northwind Quarterly check/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /2.5h Acme Corp Rotate VPN keys .* RT-77 Keys rotated/ })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^my-time-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
});
