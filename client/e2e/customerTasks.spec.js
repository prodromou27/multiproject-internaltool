import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 0, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: false } };

async function customerTasks(page, role) {
  const api = await mockApi(page, { role });
  const rows = [], sent = [];
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/recurring-tasks', () => ({ body: { rows: [] } }));
  api.override('GET /api/customers/12/operations/tasks', () => ({ body: { rows, total: rows.length, page: 1, page_size: 25 } }));
  api.override('GET /api/teams', () => ({ body: [{ id: 1, name: 'Security Team' }, { id: 2, name: 'Network Team' }] }));
  api.override('GET /api/auth/users', () => ({ body: [{ id: 7, name: 'Maria Ioannou', role: 'engineer', active: 1 }] }));
  api.override('POST /api/tasks', ({ body }) => {
    sent.push(body);
    rows.push({ id: 50 + rows.length, title: body.title, status: 'open', priority: body.priority, deadline: body.deadline, assigned_to_name: body.team_id ? null : 'Alex Mercer',
      team_name: body.team_id ? 'Security Team' : null, customer_id: 12 });
    return { body: { id: 50 } };
  });
  return sent;
}

test('engineers add a task for a customer, for themselves or their team', async ({ page }) => {
  const sent = await customerTasks(page, 'engineer');
  await page.goto('/customers/12/service-profile?section=tasks');
  await page.getByRole('button', { name: 'Add task' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add task' });
  await dialog.getByLabel('Task *').fill('Replace failed disk on NAS-01');
  await dialog.getByLabel('Due date').fill('2026-10-20');
  await dialog.getByLabel('Priority').selectOption('high');
  await expect(dialog.getByRole('radio', { name: 'Me' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => sent[0]).toEqual({ title: 'Replace failed disk on NAS-01', description: null, priority: 'high', deadline: '2026-10-20', customer_id: 12 });
  await expect(page.getByRole('cell', { name: 'Replace failed disk on NAS-01' })).toBeVisible();

  await page.getByRole('button', { name: 'Add task' }).click();
  dialog = page.getByRole('dialog', { name: 'Add task' });
  await dialog.getByLabel('Task *').fill('Renew the SSL certificate');
  await dialog.getByRole('radio', { name: 'My team' }).check();
  await expect(dialog.getByRole('combobox', { name: 'Team', exact: true })).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => sent[1]).toMatchObject({ title: 'Renew the SSL certificate', customer_id: 12, team_id: 1 });
  await expect(page.getByRole('cell', { name: 'Security Team (team)' })).toBeVisible();
});

test('managers give a customer task to an engineer or any team; the quick action opens the form', async ({ page }) => {
  const sent = await customerTasks(page, 'manager');
  await page.goto('/customers/12/service-profile?section=tasks&create=1');
  let dialog = page.getByRole('dialog', { name: 'Add task' });
  await dialog.getByLabel('Task *').fill('Patch the core switch');
  await dialog.getByRole('combobox', { name: 'Engineer', exact: true }).selectOption('Maria Ioannou');
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => sent[0]).toMatchObject({ title: 'Patch the core switch', assigned_to: 7, customer_id: 12 });

  await page.getByRole('button', { name: 'Add task' }).click();
  dialog = page.getByRole('dialog', { name: 'Add task' });
  await dialog.getByLabel('Task *').fill('Network review');
  await dialog.getByRole('radio', { name: 'A team' }).check();
  await dialog.getByRole('combobox', { name: 'Team', exact: true }).selectOption('Network Team');
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => sent[1]).toMatchObject({ title: 'Network review', team_id: 2 });
});
