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
  await expect(page.getByRole('row', { name: /Replace failed disk on NAS-01/ })).toBeVisible();

  await page.getByRole('button', { name: 'Add task' }).click();
  dialog = page.getByRole('dialog', { name: 'Add task' });
  await dialog.getByLabel('Task *').fill('Renew the SSL certificate');
  await dialog.getByRole('radio', { name: 'My team' }).check();
  await expect(dialog.getByRole('combobox', { name: 'Team', exact: true })).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => sent[1]).toMatchObject({ title: 'Renew the SSL certificate', customer_id: 12, team_id: 1 });
  await expect(page.getByRole('cell', { name: 'Security Team (team)', exact: true })).toBeVisible();
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

test('tasks are started and finished from the customer page, open ones first', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  const asked = [], updates = [];
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/recurring-tasks', () => ({ body: { rows: [] } }));
  api.override('GET /api/customers/12/operations/tasks', ({ request }) => {
    asked.push(new URL(request.url()).searchParams.get('filter'));
    return { body: { rows: [
      { id: 61, title: 'Monthly backup check', status: 'open', priority: 'medium', deadline: '2026-10-15', team_name: 'Security Team', recurring_task_id: 4, customer_id: 12 },
      { id: 62, title: 'Upgrade FW-HQ-01 to 7.4.8', status: 'in_progress', priority: 'high', deadline: null, assigned_to_name: 'Alex Mercer', asset_name: 'FW-HQ-01', customer_id: 12 },
    ], total: 2, page: 1, page_size: 25 } };
  });
  api.override('PUT /api/tasks/61', ({ body }) => { updates.push(['61', body]); return { body: { ok: true } }; });
  api.override('PUT /api/tasks/62', ({ body }) => { updates.push(['62', body]); return { body: { ok: true } }; });
  await page.goto('/customers/12/service-profile?section=tasks');
  await expect.poll(() => asked[0]).toBe('open');
  await expect(page.getByRole('row', { name: /Monthly backup check/ })).toContainText('Repeats');
  await expect(page.getByRole('row', { name: /Upgrade FW-HQ-01/ })).toContainText('Asset: FW-HQ-01');
  await expect(page.getByRole('button', { name: 'Start Upgrade FW-HQ-01 to 7.4.8' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start Monthly backup check' }).click();
  await page.getByRole('button', { name: 'Mark Upgrade FW-HQ-01 to 7.4.8 done' }).click();
  await expect.poll(() => updates).toEqual([['61', { status: 'in_progress' }], ['62', { status: 'completed' }]]);
});

test('engineers take an unassigned customer task, or take one over from a colleague after confirming', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  const taken = [], asked = [];
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/recurring-tasks', () => ({ body: { rows: [] } }));
  api.override('GET /api/customers/12/operations/tasks', ({ request }) => {
    asked.push(new URL(request.url()).searchParams.get('mine'));
    return { body: { rows: [
      { id: 71, title: 'Imperva upgrade', status: 'open', priority: 'high', assigned_to: null, customer_id: 12, can_update: false },
      { id: 72, title: 'Patch Cisco ISE', status: 'open', priority: 'medium', assigned_to: 9, assigned_to_name: 'Paul Delivery', customer_id: 12, can_update: false },
      { id: 73, title: 'Meraki replacements', status: 'in_progress', priority: 'medium', assigned_to: 1, assigned_to_name: 'Alex Mercer', customer_id: 12, can_update: true },
    ], total: 3, page: 1, page_size: 25 } };
  });
  for (const id of [71, 72]) api.override(`POST /api/tasks/${id}/take`, ({ body }) => { taken.push([id, body]); return { body: { ok: true } }; });
  await page.goto('/customers/12/service-profile?section=tasks');
  await expect(page.getByRole('button', { name: 'Start Imperva upgrade' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark Meraki replacements done' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Take.*Meraki/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Take Imperva upgrade' }).click();
  await expect.poll(() => taken[0]).toEqual([71, {}]);
  await page.getByRole('button', { name: 'Take over Patch Cisco ISE' }).click();
  const dialog = page.getByRole('dialog', { name: 'Take over this task' });
  await expect(dialog).toContainText('Paul Delivery will be told');
  await dialog.getByRole('button', { name: 'Take over' }).click();
  await expect.poll(() => taken[1]).toEqual([72, { take_over: true }]);

  await page.getByLabel('Mine only').check();
  await expect.poll(() => asked.at(-1)).toBe('1');
});
