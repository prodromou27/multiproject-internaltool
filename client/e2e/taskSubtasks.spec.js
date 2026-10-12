import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 1, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: false } };
const assets = [{ id: 1, name: 'SRV-01', asset_type: 'Server', software_version: '2019' }, { id: 2, name: 'SRV-02', asset_type: 'Server', software_version: '2016' }];

async function customerPage(page, role) {
  const api = await mockApi(page, { role });
  let subtasks = [{ id: 1, title: 'Take a backup', done: true, done_by_name: 'Alex Mercer', done_at: '2026-10-12 08:00:00' }];
  const calls = [];
  const task = () => ({ id: 61, title: 'Servers upgrades', status: 'in_progress', priority: 'high', deadline: '2026-10-30', assigned_to_name: 'Alex Mercer', customer_id: 12,
    subtasks_total: subtasks.length, subtasks_done: subtasks.filter(s => s.done).length });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/recurring-tasks', () => ({ body: { rows: [] } }));
  api.override('GET /api/customers/12/operations/tasks', () => ({ body: { rows: [task()], total: 1, page: 1, page_size: 25 } }));
  api.override('GET /api/customers/12/assets/options', () => ({ body: assets }));
  api.override('GET /api/tasks/61/subtasks', () => ({ body: subtasks }));
  api.override('POST /api/tasks/61/subtasks', ({ body }) => {
    calls.push(['add', body]);
    subtasks = [...subtasks, ...body.items.map((item, index) => ({ id: 10 + subtasks.length + index, title: item.title, asset_id: item.asset_id || null,
      asset_name: assets.find(a => a.id === item.asset_id)?.name || null, asset_version: assets.find(a => a.id === item.asset_id)?.software_version || null, done: false }))];
    return { status: 201, body: subtasks };
  });
  for (let id = 1; id <= 20; id++) api.override(`PUT /api/tasks/61/subtasks/${id}`, ({ body }) => {
    calls.push(['tick', id, body]);
    subtasks = subtasks.map(s => s.id === id ? { ...s, ...body } : s);
    return { body: subtasks };
  });
  api.override('POST /api/tasks', ({ body }) => { calls.push(['create', body]); return { body: { id: 70 } }; });
  api.override('GET /api/teams/mine', () => ({ body: { teams: [], capabilities: {} } }));
  return calls;
}

test('a task has subtasks: added one per line or one per server, ticked off, and the task is done only when all are', async ({ page }) => {
  const calls = await customerPage(page, 'engineer');
  await page.goto('/customers/12/service-profile?section=tasks');
  const row = page.getByRole('row', { name: /Servers upgrades/ });
  await expect(row.getByRole('button', { name: 'Mark Servers upgrades done' })).toBeEnabled();
  await row.getByRole('button', { name: 'Subtasks: 1 of 1 subtasks done' }).click();
  const dialog = page.getByRole('dialog', { name: 'Subtasks: Servers upgrades' });
  await expect(dialog.getByRole('checkbox', { name: 'Take a backup' })).toBeChecked();
  await dialog.getByLabel('New subtasks').fill('Check monitoring\nNotify the customer');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => calls[0]).toEqual(['add', { items: [{ title: 'Check monitoring' }, { title: 'Notify the customer' }] }]);
  await dialog.getByRole('button', { name: 'From assets' }).click();
  await dialog.getByRole('checkbox', { name: /SRV-01/ }).check();
  await dialog.getByRole('checkbox', { name: /SRV-02/ }).check();
  await dialog.getByRole('button', { name: 'Add 2 as subtasks' }).click();
  await expect.poll(() => calls[1]).toEqual(['add', { items: [{ title: 'SRV-01', asset_id: 1 }, { title: 'SRV-02', asset_id: 2 }] }]);
  await expect(dialog).toContainText('1 of 5 done');
  await dialog.getByRole('checkbox', { name: 'SRV-01' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'SRV-01' })).toBeChecked();
  await expect.poll(() => calls[2]).toEqual(['tick', 13, { done: true }]);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Subtasks: 2 of 5 subtasks done' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Mark Servers upgrades done' })).toBeDisabled();
});

test('a new customer task can come with subtasks, typed or one per asset', async ({ page }) => {
  const calls = await customerPage(page, 'engineer');
  await page.goto('/customers/12/service-profile?section=tasks');
  await page.getByRole('button', { name: 'Add task' }).click();
  const form = page.getByRole('dialog', { name: 'Add task' });
  await form.getByLabel('Task *').fill('Servers upgrades');
  await form.getByLabel('Subtasks, one per line').fill('Take a backup');
  await form.getByRole('button', { name: /Add one per asset/ }).click();
  await form.getByRole('checkbox', { name: /SRV-02/ }).check();
  await form.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => calls.find(c => c[0] === 'create')?.[1]).toMatchObject({ title: 'Servers upgrades', subtasks: [{ title: 'SRV-02', asset_id: 2 }, { title: 'Take a backup' }] });
});

test('outdated devices become one upgrade task with a subtask per device', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager', permissions: { 'assets.access': true, 'customers.access': true } });
  let sent = null;
  const asset = (id, name, version) => ({ id, customer_id: 12, name, asset_type: 'Firewall', vendor: 'Fortinet', software_version: version, lifecycle_status: 'active', coverage_type: 'managed', environment: 'production', criticality: 'high', version: 1 });
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/assets', () => ({ body: { rows: [asset(1, 'FW-A', '7.4.3'), asset(2, 'FW-B', '7.4.5')], total: 2, page: 1, page_size: 25, technologies: [], expiry_summary: { active: 2, review_due: 2, review_days: 90 } } }));
  api.override('GET /api/customers/12/assets/software-status', () => ({ body: { products: 1, assets: [
    { id: 1, name: 'FW-A', software_version: '7.4.3', status: 'behind', latest: '7.4.8', line: '7.4' }, { id: 2, name: 'FW-B', software_version: '7.4.5', status: 'behind', latest: '7.4.8', line: '7.4' }] } }));
  api.override('GET /api/customers/12/assets/options', () => ({ body: [{ id: 1, name: 'FW-A' }, { id: 2, name: 'FW-B' }] }));
  api.override('GET /api/auth/users', () => ({ body: [] }));
  api.override('GET /api/teams', () => ({ body: [] }));
  api.override('POST /api/tasks', ({ body }) => { sent = body; return { body: { id: 80 } }; });
  await page.goto('/customers/12/service-profile?section=assets&view=attention');
  await page.getByRole('button', { name: 'Create upgrade task (2 devices)' }).click();
  const form = page.getByRole('dialog', { name: 'Add task' });
  await expect(form.getByLabel('Task *')).toHaveValue('Upgrade 2 outdated devices');
  await form.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => sent?.subtasks).toEqual([{ title: 'FW-A: 7.4.3 → 7.4.8', asset_id: 1 }, { title: 'FW-B: 7.4.5 → 7.4.8', asset_id: 2 }]);
});

test('the Tasks page shows subtask progress, creates tasks with subtasks and edits them', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let sent = null;
  api.override('GET /api/tasks', () => ({ body: { rows: [{ id: 61, title: 'Servers upgrades', status: 'open', priority: 'high', created_by_name: 'A', subtasks_total: 3, subtasks_done: 1 }],
    total: 1, counts: { all: 1, open: 1 }, page: 1, page_size: 50 } }));
  api.override('GET /api/tasks/61/subtasks', () => ({ body: [{ id: 1, title: 'SRV-01', done: true }, { id: 2, title: 'SRV-02', done: false }, { id: 3, title: 'SRV-03', done: false }] }));
  api.override('POST /api/tasks', ({ body }) => { sent = body; return { body: { id: 90 } }; });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Subtasks: 1 of 3 subtasks done' }).click();
  await expect(page.getByRole('dialog', { name: 'Subtasks: Servers upgrades' })).toContainText('1 of 3 done');
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: '+ New Task' }).click();
  const form = page.getByRole('dialog', { name: 'New Task' });
  await form.getByRole('textbox').first().fill('Patch round');
  await form.getByLabel('Subtasks (optional, one per line)').fill('Firewalls\n\nServers');
  await form.getByRole('button', { name: 'Create' }).click();
  await expect.poll(() => sent).toMatchObject({ title: 'Patch round', subtasks: ['Firewalls', 'Servers'] });
});

test('My Work shows subtask progress, and checklists kept only in this browser move to their tasks', async ({ page }) => {
  const api = await mockApi(page, { role: 'engineer' });
  const added = [], ticked = [];
  await page.addInitScript(() => localStorage.setItem('hub_checklists_1', JSON.stringify({ 61: [{ id: 1, title: 'Old step', done: true }, { id: 2, title: 'Second step', done: false }], 99: [{ id: 3, title: 'Gone task', done: false }] })));
  api.override('GET /api/tasks', () => ({ body: [{ id: 61, title: 'Servers upgrades', status: 'open', priority: 'high', assigned_to: 1, subtasks_total: 2, subtasks_done: 1 }] }));
  api.override('POST /api/tasks/61/subtasks', ({ body }) => { added.push(body); return { status: 201, body: [{ id: 5, title: 'Old step', done: false }, { id: 6, title: 'Second step', done: false }] }; });
  api.override('PUT /api/tasks/61/subtasks/5', ({ body }) => { ticked.push(body); return { body: [] }; });
  await page.goto('/my-day');
  await expect.poll(() => added[0]).toEqual({ items: [{ title: 'Old step' }, { title: 'Second step' }] });
  await expect.poll(() => ticked[0]).toEqual({ done: true });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hub_checklists_1'))).toBe(JSON.stringify({ 99: [{ id: 3, title: 'Gone task', done: false }] }));
  await expect(page.getByRole('button', { name: 'Subtasks: 1 of 2 subtasks done' })).toBeVisible();
});
