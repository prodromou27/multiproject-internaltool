import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const summary = { projects: { active: 0, delayed: 0 }, tasks: { visible: true, open: 1, overdue: 0 }, recommendations: { open: 0, high_risk: 0 },
  visits: { next: null, reports_pending: 0, this_year: 0 }, managed: { visible: false } };

test('managers set a team task every 3 days about one asset, and see how it went', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  let rows = [], sent = null;
  api.override('GET /api/customers/12', () => ({ body: { id: 12, name: 'Northwind Logistics', active: 1 } }));
  api.override('GET /api/customers/12/operations/summary', () => ({ body: summary }));
  api.override('GET /api/reminders/customer/12', () => ({ body: { team: { active: [] }, own: { active: [] } } }));
  api.override('GET /api/customers/12/operations/tasks', () => ({ body: { rows: [{ id: 90, title: 'Review firewall logs', status: 'open', priority: 'medium', deadline: '2026-10-11', assigned_to: null, assigned_to_name: null, team_name: 'Security Team', customer_id: 12 }], total: 1, page: 1, page_size: 25 } }));
  api.override('GET /api/customers/12/recurring-tasks', () => ({ body: { rows } }));
  api.override('GET /api/teams', () => ({ body: [{ id: 3, name: 'Security Team' }, { id: 4, name: 'Network Team' }] }));
  api.override('GET /api/technologies', () => ({ body: [{ id: 5, name: 'FortiGate' }] }));
  api.override('GET /api/customers/12/contracts', () => ({ body: { contracts: [], assets: [{ id: 8, name: 'FW-HQ-01', asset_type: 'firewall', lifecycle_status: 'active' }] } }));
  api.override('POST /api/customers/12/recurring-tasks', ({ body }) => {
    sent = body;
    rows = [{ id: 1, ...body, active: true, notify: false, next_due: '2026-10-14', team_name: 'Security Team', asset_name: 'FW-HQ-01', technology_name: 'FortiGate',
      history: { created: 4, completed: 3, on_time: 2, open: 1, overdue: 1 } }];
    return { status: 201, body: rows[0] };
  });

  await page.goto('/customers/12/service-profile?section=tasks');
  // A team task waiting to be taken shows the team.
  await expect(page.getByRole('cell', { name: 'Security Team (team)' })).toBeVisible();

  await page.getByRole('button', { name: 'Add recurring task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New recurring task' });
  await dialog.getByLabel('Task *', { exact: true }).fill('Review firewall logs');
  await dialog.getByLabel('Repeats').selectOption({ label: 'Custom…' });
  await dialog.getByLabel('Repeat every').fill('3');
  await dialog.getByLabel('Unit').selectOption('day');
  await dialog.getByLabel('A team').check();
  await dialog.getByLabel('Team', { exact: true }).selectOption({ label: 'Security Team' });
  await dialog.getByLabel('Asset').selectOption({ label: 'FW-HQ-01' });
  await dialog.getByLabel('Technology').selectOption({ label: 'FortiGate' });
  await expect(dialog.getByLabel(/Notify the engineer/)).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Add recurring task' }).click();
  await expect.poll(() => sent).toMatchObject({ title: 'Review firewall logs', frequency: 'custom', interval_count: 3, interval_unit: 'day', team_id: 3, assigned_to: null, asset_id: 8, technology_id: 5, notify: false });

  const row = page.getByRole('row', { name: /Review firewall logs.*Every 3 days/ });
  await expect(row).toContainText('FW-HQ-01 · FortiGate');
  await expect(row).toContainText('Security Team');
  await expect(row).toContainText('3 of 4 done, 2 on time');
  await expect(row).toContainText('1 overdue');
});
