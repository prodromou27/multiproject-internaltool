import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const dashboard = days => ({
  period: { from: '2026-07-14', to: '2026-10-11', days, unit: 'week' },
  kpis: { open: 14, overdue: 3, due_this_week: 4, unassigned: 2, waiting: 2, created: 20, completed: 16, on_time_rate: 75, avg_days_to_complete: 4.5, open_subtasks: 9, overdue_subtasks: 1 },
  series: [{ key: '2026-09-28', start: '2026-09-28', created: 5, on_time: 3, late: 1 }, { key: '2026-10-05', start: '2026-10-05', created: 4, on_time: 2, late: 0 }],
  by_status: [{ status: 'open', count: 6 }, { status: 'in_progress', count: 6 }, { status: 'waiting_customer', count: 2 }, { status: 'waiting_vendor', count: 0 }, { status: 'pending_approval', count: 0 }],
  by_priority: [{ priority: 'critical', count: 1 }, { priority: 'high', count: 4 }, { priority: 'medium', count: 8 }, { priority: 'low', count: 1 }],
  people: [{ id: 7, name: 'Maria Ioannou', open: 6, overdue: 2, done: 9, on_time_rate: 78, open_subtasks: 4, overdue_subtasks: 1 }],
  by_customer: [{ id: 12, name: 'Northwind Logistics', open: 8, overdue: 2 }],
  overdue: [{ id: 61, title: 'Patch Cisco ISE', status: 'open', deadline: '2026-10-07', who: 'Maria Ioannou', customer_id: 12, customer_name: 'Northwind Logistics', days_overdue: 5 }],
  stuck: [{ id: 62, title: 'Configure the new Synology', status: 'waiting_customer', who: 'Paul Delivery', customer_id: 12, customer_name: 'Northwind Logistics', waiting_days: 12, reason: 'Rack space' }],
  stuck_days: 7,
});

test('Reports → Tasks: figures, charts, people and what needs a look, filtered', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const asked = [];
  api.override('GET /api/insights/tasks', ({ request }) => { const query = Object.fromEntries(new URL(request.url()).searchParams); asked.push(query); return { body: dashboard(Number(query.days)) }; });
  api.override('GET /api/customers', () => ({ body: [{ id: 12, name: 'Northwind Logistics', active: 1 }] }));
  api.override('GET /api/teams', () => ({ body: [{ id: 1, name: 'Security Team' }] }));
  api.override('GET /api/auth/users', () => ({ body: [{ id: 7, name: 'Maria Ioannou', role: 'engineer', active: 1 }] }));
  await page.goto('/reports');
  await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
  const board = page.getByRole('region', { name: 'Tasks dashboard' });
  await expect(board).toContainText('Overdue');
  await expect(board).toContainText('75%');
  await expect(board).toContainText('9 past their due date'.replace('9', '1'));
  for (const chart of ['Created and completed', 'Open work by status', 'Open work by priority', 'People', 'Open work by customer']) await expect(board.getByRole('region', { name: chart })).toBeVisible();
  await expect(board.getByRole('region', { name: 'People' }).getByRole('row', { name: /Maria Ioannou/ })).toContainText('78%');
  await expect(board.getByRole('region', { name: 'Overdue tasks' }).getByRole('link', { name: 'Patch Cisco ISE' })).toHaveAttribute('href', '/customers/12/service-profile?section=tasks&task=61');
  await expect(board.getByRole('region', { name: 'Waiting more than 7 days' })).toContainText('Waiting for: Rack space');
  await board.getByRole('combobox', { name: 'Engineer' }).selectOption('Maria Ioannou');
  await expect.poll(() => asked.at(-1)).toMatchObject({ engineer_id: '7', days: '90' });
  await board.getByRole('button', { name: '12 months' }).click();
  await expect.poll(() => asked.at(-1)).toMatchObject({ days: '365', engineer_id: '7' });
});
