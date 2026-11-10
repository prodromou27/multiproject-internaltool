import { test, expect } from '@playwright/test';
import { mockApi } from './support/mockApi.js';

const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const visit = { customer_id: 1, customer_name: 'Northwind Logistics', engineer_ids: [1], engineer_names: 'Alex Mercer', report_sent: 0, report_sent_to_customer: 0 };
const visits = [
  { ...visit, id: 1, title: 'Missed firewall check', scheduled_date: day(-5), status: 'scheduled' },
  { ...visit, id: 2, title: 'Done switch upgrade', scheduled_date: day(-5), status: 'completed' },
  { ...visit, id: 3, title: 'Planned backup review', scheduled_date: day(5), status: 'scheduled' },
  { ...visit, id: 4, title: 'Week-long migration', scheduled_date: day(-3), end_date: day(3), status: 'in_progress' },
];

test('the dashboard\'s incomplete visits lead to the Overdue view, which lists the same visits', async ({ page }) => {
  const api = await mockApi(page, { role: 'manager' });
  api.override('GET /api/maintenance-visits', () => ({ body: visits }));
  await page.goto('/maintenance-visits?filter=overdue');

  await expect(page.getByRole('button', { name: 'Overdue (1)' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Missed firewall check/ })).toBeVisible();
  for (const title of ['Done switch upgrade', 'Planned backup review', 'Week-long migration']) {
    await expect(page.getByRole('row', { name: new RegExp(title) })).toHaveCount(0);
  }
});
