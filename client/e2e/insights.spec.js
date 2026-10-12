import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const week = (key, extra) => ({ key, start: key, hours: 0, activities: 0, tasks_on_time: 0, tasks_late: 0, tasks_created: 0, tickets_created: 0, tickets_resolved: 0, visits: 0, ...extra });
const insights = days => ({
  period: { from: '2026-07-14', to: '2026-10-11', days, unit: days > 90 ? 'month' : 'week' },
  kpis: { hours: 42.5, activities: 31, tasks_done: 20, on_time_rate: 75, open_tasks: 14, overdue_tasks: 3, team_tasks_waiting: 2, visits_done: 6, tickets_created: 40, tickets_resolved: 36, open_tickets: 9,
    reports_owed: 2, reports_overdue: 1, contracts_ending: 1, devices_behind: 4, devices_eol: 1, skill_gaps: 2 },
  series: [week('2026-09-28', { hours: 12, activities: 9, tasks_on_time: 4, tasks_late: 1, tasks_created: 6, tickets_created: 10, tickets_resolved: 9 }), week('2026-10-05', { hours: 8.5, activities: 6, tasks_on_time: 3, tasks_created: 2, tickets_created: 7, tickets_resolved: 8 })],
  hours_by_customer: [{ id: 12, name: 'Northwind Logistics', hours: 30, activities: 20 }, { id: 14, name: 'Contoso Retail', hours: 12.5, activities: 11 }],
  hours_by_category: [{ id: 1, name: 'Support', hours: 25, activities: 18 }],
  engineers: [{ id: 7, name: 'Maria Ioannou', open_tasks: 8, overdue_tasks: 2, done_tasks: 12, hours: 30, activities: 20 }],
  attention: {
    reports_owed: [{ customer_id: 12, customer_name: 'Northwind Logistics', label: 'September 2026', due_date: '2026-10-10', status: 'draft', overdue: true }],
    contracts_ending: [{ id: 3, customer_id: 14, customer_name: 'Contoso Retail', reference: 'SUP-77', end_date: '2026-10-30', status: 'ending_soon', days_left: 19 }],
    devices: [{ id: 5, customer_id: 12, customer_name: 'Northwind Logistics', name: 'FW-HQ-01', product_name: 'FortiOS', software_version: '7.4.3', status: 'behind', behind: 5 }],
    skills: [{ technology_id: 2, name: 'Check Point', skilled: 0, target: 2, status: 'gap', single_point: false }],
  },
});

test('managers see the whole operation on the dashboard: figures, charts and what needs attention', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const asked = [];
  api.override('GET /api/insights', ({ request }) => { const days = Number(new URL(request.url()).searchParams.get('days')); asked.push(days); return { body: insights(days) }; });
  await page.goto('/');
  const section = page.getByRole('region', { name: 'Insights' });
  await expect(section.getByRole('link', { name: /Hours logged\s*42.5/ })).toHaveAttribute('href', '/service-operations');
  await expect(section).toContainText('75% on time');
  await expect(section.getByRole('link', { name: /Overdue tasks\s*3/ })).toBeVisible();
  await expect(section).toContainText('36 / 40');
  // On the dashboard the charts open on request, and stay open next time.
  await expect(section.getByRole('region', { name: 'Work logged' })).toHaveCount(0);
  await section.getByRole('button', { name: 'Show charts' }).click();
  for (const chart of ['Work logged', 'Tasks finished', 'Tickets', 'Hours by customer', 'Engineers']) await expect(section.getByRole('region', { name: chart })).toBeVisible();
  await page.reload();
  await expect(section.getByRole('button', { name: 'Hide charts' })).toHaveAttribute('aria-expanded', 'true');
  await expect(section.getByRole('region', { name: 'Hours by customer' }).getByRole('link', { name: 'Northwind Logistics' })).toHaveAttribute('href', '/customers/12/service-profile');
  await expect(section.getByRole('region', { name: 'Customer reports owed' })).toContainText('Overdue');
  await expect(section.getByRole('region', { name: 'Contracts ending' })).toContainText('19 days');
  await expect(section.getByRole('region', { name: 'Devices on old software' })).toContainText('5 behind');
  await expect(section.getByRole('region', { name: 'Knowledge gaps' })).toContainText('Gap');
  await section.getByRole('button', { name: '12 months' }).click();
  await expect.poll(() => asked.at(-1)).toBe(365);
  await expect(section.getByRole('button', { name: '12 months' })).toHaveAttribute('aria-pressed', 'true');
});

test('engineers do not get the insights', async ({ page }) => {
  await mockApi(page, { role: 'engineer' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My work' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Insights' })).toHaveCount(0);
});

test('Reports → Overview narrows the insights to one customer, team or engineer', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  const asked = [];
  api.override('GET /api/insights', ({ request }) => { const params = new URL(request.url()).searchParams; asked.push(Object.fromEntries(params)); return { body: insights(Number(params.get('days'))) }; });
  api.override('GET /api/customers', () => ({ body: [{ id: 12, name: 'Northwind Logistics', active: 1 }, { id: 15, name: 'Old Customer', active: 0 }] }));
  api.override('GET /api/auth/users', () => ({ body: [{ id: 7, name: 'Maria Ioannou', role: 'engineer', active: 1 }, { id: 2, name: 'Pat Manager', role: 'manager', active: 1 }] }));
  api.override('GET /api/teams', () => ({ body: [{ id: 1, name: 'Security Team' }] }));
  await page.goto('/reports');
  const section = page.getByRole('region', { name: 'Insights' });
  await expect(section.getByRole('link', { name: /Hours logged\s*42.5/ })).toBeVisible();
  await expect(section.getByRole('combobox', { name: 'Customer' }).locator('option')).toHaveText(['All customers', 'Northwind Logistics']);
  await expect(section.getByRole('combobox', { name: 'Engineer' }).locator('option')).toHaveText(['All engineers', 'Maria Ioannou']);
  await section.getByRole('combobox', { name: 'Customer' }).selectOption('Northwind Logistics');
  await expect.poll(() => asked.at(-1)).toMatchObject({ customer_id: '12' });
  await section.getByRole('combobox', { name: 'Team' }).selectOption('Security Team');
  await section.getByRole('combobox', { name: 'Engineer' }).selectOption('Maria Ioannou');
  await expect.poll(() => asked.at(-1)).toEqual({ days: '90', customer_id: '12', team_id: '1', engineer_id: '7' });
});
